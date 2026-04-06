import * as path from 'path';
import * as vscode from 'vscode';
import { IInterpreterHelper, IInterpreterService } from '../interpreter/contracts';
import { IPythonPathUpdaterServiceManager } from '../interpreter/configuration/types';
import { PythonSessionRegistry } from './pythonSessionRegistry';
import type { ILanguageRuntimeSession, IRuntimeSessionService, RuntimeState } from './types/supervisor-api';

const LAST_FOREGROUND_SESSION_ID_KEY = 'pythonSupervisor.lastForegroundSessionId';
const RUNTIME_STATE_READY = 'ready';
const RUNTIME_STATE_IDLE = 'idle';
const RUNTIME_STATE_BUSY = 'busy';

function comparePaths(left: string, right: string): boolean {
    const normalizedLeft = process.platform === 'win32' ? path.normalize(left).toLowerCase() : path.normalize(left);
    const normalizedRight = process.platform === 'win32' ? path.normalize(right).toLowerCase() : path.normalize(right);
    return normalizedLeft === normalizedRight;
}

export class PythonForegroundSessionManager implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private _activationQueue: Promise<void> = Promise.resolve();
    private _activeConsoleSessionId: string | null = null;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        _runtimeSessionService: IRuntimeSessionService,
        private readonly _registry: PythonSessionRegistry,
        private readonly _pythonPathUpdaterService: IPythonPathUpdaterServiceManager,
        private readonly _interpreterHelper: IInterpreterHelper,
        private readonly _interpreterService: IInterpreterService,
        private readonly _logChannel: vscode.LogOutputChannel,
    ) {
        const existingSessions = Array.from(_runtimeSessionService.activeSessions);
        for (const session of existingSessions) {
            this.addSession(session);
        }

        this._disposables.push(
            _runtimeSessionService.onDidCreateSession((session) => {
                this.addSession(session);
            }),
            _runtimeSessionService.onDidDeleteRuntimeSession((sessionId) => {
                if (this.getLastForegroundSessionId() === sessionId) {
                    void this.setLastForegroundSessionId(null);
                }
                if (this._activeConsoleSessionId === sessionId) {
                    this._activeConsoleSessionId = null;
                }
                this._registry.deleteSession(sessionId);
            }),
            _runtimeSessionService.onDidChangeForegroundSession((session) => {
                void this.enqueueActivation(() => this.didChangeForegroundSession(session));
            }),
        );

        void this.enqueueActivation(() => this.initializeExistingSessions(existingSessions));
    }

    dispose(): void {
        this._registry.dispose();
        this._disposables.forEach((disposable) => disposable.dispose());
    }

    private addSession(session: ILanguageRuntimeSession): void {
        if (!this._registry.addSession(session)) {
            return;
        }

        this._registry.registerDisposable(
            session.sessionId,
            session.onDidChangeRuntimeState((state) => {
                void this.enqueueActivation(() => this.didChangeSessionRuntimeState(session, state));
            }),
        );
    }

    private async initializeExistingSessions(existingSessions: readonly ILanguageRuntimeSession[]): Promise<void> {
        for (const session of existingSessions) {
            if (session.metadata.sessionMode !== 'notebook') {
                continue;
            }

            if (this.canActivateServices(session.state)) {
                await this.activateSession(session, 'notebook session restored');
            }
        }

        const lastForegroundSessionId = this.getLastForegroundSessionId();
        if (!lastForegroundSessionId) {
            return;
        }

        const foregroundSession = this._registry.get(lastForegroundSessionId);
        if (
            foregroundSession &&
            foregroundSession.metadata.sessionMode === 'console' &&
            this.canActivateServices(foregroundSession.state)
        ) {
            await this.activateConsoleSession(foregroundSession, 'foreground session restored');
        }
    }

    private async didChangeSessionRuntimeState(
        session: ILanguageRuntimeSession,
        state: RuntimeState,
    ): Promise<void> {
        if (state !== RUNTIME_STATE_READY) {
            return;
        }

        if (session.metadata.sessionMode === 'notebook') {
            await this.activateSession(session, 'notebook session is ready');
            return;
        }

        if (
            session.metadata.sessionMode === 'console' &&
            this.getLastForegroundSessionId() === session.sessionId
        ) {
            await this.activateConsoleSession(session, 'foreground session is ready');
        }
    }

    private async didChangeForegroundSession(session: ILanguageRuntimeSession | undefined): Promise<void> {
        if (!session || session.runtimeMetadata.languageId !== 'python') {
            return;
        }

        if (session.metadata.sessionMode !== 'console') {
            return;
        }

        if (this.getLastForegroundSessionId() === session.sessionId) {
            return;
        }

        const previousForegroundSessionId = this._activeConsoleSessionId;
        await this.setLastForegroundSessionId(session.sessionId);
        await this.syncForegroundPythonPath(session);
        await this.activateConsoleSession(session, 'foreground session changed', previousForegroundSessionId);
    }

    private async activateConsoleSession(
        session: ILanguageRuntimeSession,
        reason: string,
        previousForegroundSessionId: string | null = this._activeConsoleSessionId,
    ): Promise<void> {
        if (previousForegroundSessionId && previousForegroundSessionId !== session.sessionId) {
            const previousForegroundSession = this._registry.get(previousForegroundSessionId);
            if (previousForegroundSession?.metadata.sessionMode === 'console') {
                await this.deactivateSession(previousForegroundSession, reason);
            }
        }

        await this.activateSession(session, reason);
        this._activeConsoleSessionId = session.sessionId;
    }

    private async activateSession(session: ILanguageRuntimeSession, reason: string): Promise<void> {
        if (!this.canActivateServices(session.state)) {
            this.log(
                `Skipping LSP activation for ${session.sessionId} (${reason}): session state is '${session.state}'`,
                vscode.LogLevel.Debug,
            );
            return;
        }

        this.log(`Activating LSP for ${session.sessionId}. Reason: ${reason}`, vscode.LogLevel.Debug);
        await session.activateLsp();
    }

    private async deactivateSession(session: ILanguageRuntimeSession, reason: string): Promise<void> {
        this.log(`Deactivating LSP for ${session.sessionId}. Reason: ${reason}`, vscode.LogLevel.Debug);
        await session.deactivateLsp();
    }

    private canActivateServices(state: RuntimeState): boolean {
        return state === RUNTIME_STATE_READY || state === RUNTIME_STATE_IDLE || state === RUNTIME_STATE_BUSY;
    }

    private getLastForegroundSessionId(): string | null {
        return this._context.workspaceState.get<string>(LAST_FOREGROUND_SESSION_ID_KEY) ?? null;
    }

    private async setLastForegroundSessionId(sessionId: string | null): Promise<void> {
        await this._context.workspaceState.update(LAST_FOREGROUND_SESSION_ID_KEY, sessionId);
    }

    private async syncForegroundPythonPath(session: ILanguageRuntimeSession): Promise<void> {
        const pythonPath = session.runtimeMetadata.runtimePath;
        if (!pythonPath) {
            return;
        }

        const activeDocument = vscode.window.activeTextEditor?.document;
        const activeEditorResource = activeDocument?.languageId === 'python' ? activeDocument.uri : undefined;
        const workspaceSelection = this._interpreterHelper.getActiveWorkspaceUri(
            session.metadata.notebookUri ?? activeEditorResource,
        );
        if (!workspaceSelection) {
            return;
        }

        const currentInterpreter = await this._interpreterService.getActiveInterpreter(workspaceSelection.folderUri);
        if (currentInterpreter?.path && comparePaths(currentInterpreter.path, pythonPath)) {
            return;
        }

        this.log(
            `Updating active Python path for foreground session ${session.sessionId} to ${pythonPath}`,
            vscode.LogLevel.Debug,
        );
        await this._pythonPathUpdaterService.updatePythonPath(
            pythonPath,
            workspaceSelection.configTarget,
            'load',
            workspaceSelection.folderUri,
        );
    }

    private enqueueActivation(task: () => Promise<void>): Promise<void> {
        const run = this._activationQueue.then(task, task);
        this._activationQueue = run.catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this._logChannel.error(`[Python Supervisor] Foreground session manager failed: ${message}`);
        });
        return run;
    }

    private log(message: string, level: vscode.LogLevel = vscode.LogLevel.Info): void {
        switch (level) {
            case vscode.LogLevel.Error:
                this._logChannel.error(`[Python Supervisor] ${message}`);
                break;
            case vscode.LogLevel.Warning:
                this._logChannel.warn(`[Python Supervisor] ${message}`);
                break;
            case vscode.LogLevel.Debug:
                this._logChannel.debug(`[Python Supervisor] ${message}`);
                break;
            default:
                this._logChannel.info(`[Python Supervisor] ${message}`);
                break;
        }
    }
}
