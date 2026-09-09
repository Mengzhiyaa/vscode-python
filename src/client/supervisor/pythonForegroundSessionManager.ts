import * as path from 'path';
import * as vscode from 'vscode';
import { IInterpreterHelper, IInterpreterService } from '../interpreter/contracts';
import { IPythonPathUpdaterServiceManager } from '../interpreter/configuration/types';
import { PythonSessionRegistry } from './pythonSessionRegistry';
import type { ILanguageContributionServices, ILanguageRuntimeSession, RuntimeState } from './types/supervisor-api';

const LAST_FOREGROUND_SESSION_ID_KEY = 'pythonSupervisor.lastForegroundSessionId';
const RUNTIME_STATE_READY = 'ready';
const RUNTIME_STATE_IDLE = 'idle';
const RUNTIME_STATE_BUSY = 'busy';
const RUNTIME_STATE_UNINITIALIZED = 'uninitialized';
const RUNTIME_STATE_EXITED = 'exited';
const APK_DAP_TARGET_NAME = 'apk_dap';
const APK_DEBUG_TYPE = 'apk';
const APK_DEBUG_NAME = 'APK Positron Python';

type DapSessionState = {
    started: boolean;
    autoAttachDisabled: boolean;
};

function comparePaths(left: string, right: string): boolean {
    const normalizedLeft = process.platform === 'win32' ? path.normalize(left).toLowerCase() : path.normalize(left);
    const normalizedRight = process.platform === 'win32' ? path.normalize(right).toLowerCase() : path.normalize(right);
    return normalizedLeft === normalizedRight;
}

export class PythonForegroundSessionManager implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _dapSessionStates = new Map<string, DapSessionState>();
    private _activationQueue: Promise<void> = Promise.resolve();
    private readonly _dapQueues = new Map<string, Promise<void>>();
    private _activeConsoleSessionId?: string;
    private _disposed = false;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _runtimeSessionService: ILanguageContributionServices['runtimeSessionService'],
        private readonly _registry: PythonSessionRegistry,
        private readonly _pythonPathUpdaterService: IPythonPathUpdaterServiceManager,
        private readonly _interpreterHelper: IInterpreterHelper,
        private readonly _interpreterService: IInterpreterService,
        private readonly _logChannel: vscode.LogOutputChannel,
        private readonly _dapEnabled = true,
    ) {
        const existingSessions = Array.from(this._runtimeSessionService.activeSessions);
        const existingForegroundSession = this._runtimeSessionService.foregroundSession;
        for (const session of existingSessions) {
            this.addSession(session);
        }

        this._disposables.push(
            this._runtimeSessionService.onDidCreateSession((session) => {
                this.addSession(session);
            }),
            this._runtimeSessionService.onDidDeleteRuntimeSession((sessionId) => {
                if (this.getLastForegroundSessionId() === sessionId) {
                    void this.setLastForegroundSessionId(null);
                }
                if (this._activeConsoleSessionId === sessionId) {
                    this._activeConsoleSessionId = undefined;
                }
                this._dapSessionStates.delete(sessionId);
                this._registry.deleteSession(sessionId);
            }),
            this._runtimeSessionService.onDidChangeForegroundSession((session) => {
                void this.enqueueActivation(() => this.didChangeForegroundSession(session));
            }),
        );

        void this.enqueueActivation(() => this.initializeExistingSessions(existingSessions, existingForegroundSession));
    }

    dispose(): void {
        this._disposed = true;
        this._registry.dispose();
        this._dapSessionStates.clear();
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

    private async initializeExistingSessions(
        existingSessions: readonly ILanguageRuntimeSession[],
        existingForegroundSession: ILanguageRuntimeSession | undefined,
    ): Promise<void> {
        for (const session of existingSessions) {
            if (!this.canActivateServices(session.state)) {
                continue;
            }

            if (session.metadata.sessionMode === 'console') {
                this.scheduleDap(session, false);
            } else if (session.metadata.sessionMode === 'notebook') {
                await this.activateSession(session, 'notebook session restored');
            }
        }

        if (existingForegroundSession?.runtimeMetadata.languageId === 'python') {
            const foregroundSession = this._registry.get(existingForegroundSession.sessionId);
            if (foregroundSession?.metadata.sessionMode !== 'console') {
                return;
            }

            await this.restoreForegroundConsoleSession(
                foregroundSession,
                'restored foreground console session detected during startup',
            );
            return;
        }

        // Language contributions can be registered after Supervisor has already
        // restored sessions and emitted its foreground-session event. In that case
        // there is no event to replay and persisted workspace state can be stale.
        // Match vscode-ark by falling back to the newest live console session.
        const fallbackConsoleSession = existingSessions
            .filter(
                (session) =>
                    session.runtimeMetadata.languageId === 'python' && session.metadata.sessionMode === 'console',
            )
            .sort((left, right) => right.created - left.created)
            .find((session) => session.state !== RUNTIME_STATE_UNINITIALIZED && session.state !== RUNTIME_STATE_EXITED);
        if (!fallbackConsoleSession) {
            return;
        }

        await this.restoreForegroundConsoleSession(
            fallbackConsoleSession,
            'restored console session fallback detected during startup',
        );
    }

    private async restoreForegroundConsoleSession(session: ILanguageRuntimeSession, reason: string): Promise<void> {
        if (this.getLastForegroundSessionId() !== session.sessionId) {
            await this.setLastForegroundSessionId(session.sessionId);
        }

        await this.syncForegroundPythonPath(session);
        if (this.canActivateServices(session.state)) {
            await this.activateConsoleSession(session, reason);
        }
    }

    private async didChangeSessionRuntimeState(session: ILanguageRuntimeSession, state: RuntimeState): Promise<void> {
        if (state === RUNTIME_STATE_EXITED) {
            await this.deactivateSession(session, 'session exited');
            this.enqueueDap(session, async () => {
                this._dapSessionStates.delete(session.sessionId);
            });
            return;
        }

        if (state !== RUNTIME_STATE_READY) {
            return;
        }

        if (session.metadata.sessionMode === 'notebook') {
            await this.activateSession(session, 'notebook session is ready');
            return;
        }

        if (session.metadata.sessionMode === 'console') {
            if (this.getLastForegroundSessionId() === session.sessionId) {
                await this.activateConsoleSession(session, 'foreground session is ready');
            } else {
                this.scheduleDap(session, false);
            }
        }
    }

    private async didChangeForegroundSession(session: ILanguageRuntimeSession | undefined): Promise<void> {
        if (!session || session.runtimeMetadata.languageId !== 'python') {
            return;
        }

        if (session.metadata.sessionMode !== 'console') {
            return;
        }

        if (
            this.getLastForegroundSessionId() === session.sessionId &&
            this._activeConsoleSessionId === session.sessionId
        ) {
            return;
        }

        await this.setLastForegroundSessionId(session.sessionId);
        await this.syncForegroundPythonPath(session);
        await this.activateConsoleSession(session, 'foreground session changed');
    }

    private async activateConsoleSession(session: ILanguageRuntimeSession, reason: string): Promise<void> {
        await Promise.all(
            this._registry
                .getConsoleSessions()
                .filter((candidate) => candidate.sessionId !== session.sessionId)
                .map((candidate) => this.deactivateSession(candidate, reason)),
        );

        await this.activateSession(session, reason);
        if (this.canActivateServices(session.state)) {
            this._activeConsoleSessionId = session.sessionId;
        }
    }

    private async activateSession(session: ILanguageRuntimeSession, reason: string): Promise<void> {
        if (!this.canActivateServices(session.state)) {
            this.logSession(
                session,
                `Skipping LSP activation for ${session.sessionId} (${reason}): session state is '${session.state}'`,
                vscode.LogLevel.Debug,
            );
            return;
        }

        this.logSession(session, `Activating LSP. Reason: ${reason}`, vscode.LogLevel.Debug);
        await session.activateLsp();
        if (session.metadata.sessionMode === 'console') {
            this.scheduleDap(session, true);
        }
    }

    private async deactivateSession(session: ILanguageRuntimeSession, reason: string): Promise<void> {
        this.logSession(session, `Deactivating LSP. Reason: ${reason}`, vscode.LogLevel.Debug);
        await session.deactivateLsp();
        if (this._activeConsoleSessionId === session.sessionId) {
            this._activeConsoleSessionId = undefined;
        }
        if (session.metadata.sessionMode === 'console') {
            this.enqueueDap(session, async () => {
                if (this._dapSessionStates.get(session.sessionId)?.started) {
                    await session.disconnectDap();
                }
            });
        }
    }

    private scheduleDap(session: ILanguageRuntimeSession, connect: boolean): void {
        this.enqueueDap(session, async () => {
            if (!this.canActivateServices(session.state) || !(await this.ensureDapStarted(session))) {
                return;
            }
            if (connect && !this._disposed && this._activeConsoleSessionId === session.sessionId) {
                await this.connectDap(session);
            }
        });
    }

    private enqueueDap(session: ILanguageRuntimeSession, task: () => Promise<void>): void {
        const previous = this._dapQueues.get(session.sessionId) ?? Promise.resolve();
        const run = previous
            .then(async () => {
                if (!this._disposed) {
                    await task();
                }
            })
            .catch((error) => {
                this.logSession(session, `DAP operation failed: ${this.formatError(error)}`, vscode.LogLevel.Warning);
            });
        this._dapQueues.set(session.sessionId, run);
        void run.then(() => {
            if (this._dapQueues.get(session.sessionId) === run) {
                this._dapQueues.delete(session.sessionId);
            }
        });
    }

    private async ensureDapStarted(session: ILanguageRuntimeSession): Promise<boolean> {
        if (!this._dapEnabled) {
            return false;
        }

        const state = this.getDapSessionState(session.sessionId);
        if (state.started) {
            return true;
        }

        this.logSession(session, `Starting DAP target '${APK_DAP_TARGET_NAME}'`, vscode.LogLevel.Debug);
        try {
            await session.startDap(APK_DAP_TARGET_NAME, APK_DEBUG_TYPE, APK_DEBUG_NAME);
            state.started = true;
            state.autoAttachDisabled = false;
            return true;
        } catch (error) {
            this.logSession(
                session,
                `Failed to start DAP target '${APK_DAP_TARGET_NAME}': ${this.formatError(error)}`,
                vscode.LogLevel.Warning,
            );
            return false;
        }
    }

    private async connectDap(session: ILanguageRuntimeSession): Promise<void> {
        const state = this.getDapSessionState(session.sessionId);
        if (!state.started || state.autoAttachDisabled) {
            return;
        }

        const connected = await session.connectDap();
        if (!connected) {
            state.autoAttachDisabled = true;
            this.logSession(
                session,
                `DAP auto-attach disabled for session ${session.sessionId}`,
                vscode.LogLevel.Debug,
            );
        }
    }

    private getDapSessionState(sessionId: string): DapSessionState {
        let state = this._dapSessionStates.get(sessionId);
        if (!state) {
            state = { started: false, autoAttachDisabled: false };
            this._dapSessionStates.set(sessionId, state);
        }
        return state;
    }

    private formatError(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
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

        this.logSession(session, `Updating active Python path to ${pythonPath}`, vscode.LogLevel.Debug);
        await this._pythonPathUpdaterService.updatePythonPath(
            pythonPath,
            workspaceSelection.configTarget,
            'load',
            workspaceSelection.folderUri,
        );
    }

    private enqueueActivation(task: () => Promise<void>): Promise<void> {
        const run = this._activationQueue.then(async () => {
            if (!this._disposed) {
                await task();
            }
        });
        this._activationQueue = run.catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this._logChannel.error(`[Python Supervisor] Foreground session manager failed: ${message}`);
        });
        return this._activationQueue;
    }

    private logSession(
        session: ILanguageRuntimeSession,
        message: string,
        level: vscode.LogLevel = vscode.LogLevel.Info,
    ): void {
        if (session.emitLog) {
            session.emitLog(message, level);
            return;
        }
        const formatted = `[Python Supervisor] [session=${session.sessionId}] ${message}`;
        switch (level) {
            case vscode.LogLevel.Error:
                this._logChannel.error(formatted);
                break;
            case vscode.LogLevel.Warning:
                this._logChannel.warn(formatted);
                break;
            case vscode.LogLevel.Debug:
                this._logChannel.debug(formatted);
                break;
            default:
                this._logChannel.info(formatted);
                break;
        }
    }
}
