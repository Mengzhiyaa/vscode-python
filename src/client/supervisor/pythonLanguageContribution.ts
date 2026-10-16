import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Commands } from '../common/constants';
import { IInterpreterService, type PythonEnvironmentsChangedEvent } from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';
import { PythonConsoleExecutionService } from './pythonConsoleExecutionService';
import { PythonConsoleRuntimeRouter } from './pythonConsoleRuntimeRouter';
import { PythonForegroundSessionManager } from './pythonForegroundSessionManager';
import { PythonSupervisorNotebookController } from './pythonNotebookController';
import { PythonRuntimeProvider, PythonRuntimeInstallation, PYTHON_LANGUAGE_ID } from './runtimeProvider';
import { PythonRuntimeSessionManager } from './runtimeSessionManager';
import { PythonSessionRegistry } from './pythonSessionRegistry';
import type {
    ILanguageContributionServices,
    ILanguageOptionalCapabilityDescriptor,
    ISupervisorFrameworkApi,
} from './types/supervisor-api';
import { IInterpreterHelper } from '../interpreter/contracts';
import { IPythonPathUpdaterServiceManager } from '../interpreter/configuration/types';
import { PythonPackageManagerProvider } from './packages/packageManagerProvider';

export const PYTHON_START_SUPERVISOR_CONSOLE_COMMAND = 'python.startSupervisorConsole';
export const PYTHON_SELECT_SUPERVISOR_RUNTIME_COMMAND = 'python.selectSupervisorRuntime';
export const PYTHON_RESTART_SUPERVISOR_CONSOLE_COMMAND = 'python.restartSupervisorConsole';
export const PYTHON_STOP_SUPERVISOR_CONSOLE_COMMAND = 'python.stopSupervisorConsole';
export const PYTHON_EXECUTE_IN_SUPERVISOR_COMMAND = 'python.executeSelectionInSupervisor';
export const PYTHON_EXECUTE_IN_SUPERVISOR_WITHOUT_ADVANCING_COMMAND =
    'python.executeSelectionInSupervisorWithoutAdvancing';

class PythonSupervisorController implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private _interpreterChangeQueue: Promise<void> = Promise.resolve();
    private _selectionQueue: Promise<void> = Promise.resolve();
    private readonly _pendingShutdowns = new Map<string, Promise<void>>();
    private _disposed = false;

    constructor(
        private readonly _runtimeRouter: PythonConsoleRuntimeRouter,
        private readonly _runtimeProvider: PythonRuntimeProvider,
        private readonly interpreterService: IInterpreterService,
        private readonly _services: ILanguageContributionServices,
        private readonly _consoleExecutionService: PythonConsoleExecutionService,
    ) {
        this._disposables.push(
            interpreterService.onDidChangeInterpreterForSession?.(event => {
                this._selectionQueue = this._selectionQueue.then(async () => {
                    if (!this._disposed) {
                        await this._runtimeRouter.syncActiveInterpreter(event.source, event.resource, event.startSession);
                    }
                }).catch(error => this._services.logChannel.warn(`Failed to synchronize Python interpreter: ${error}`));
            }) ?? interpreterService.onDidChangeInterpreter(resource => {
                // Compatibility with older interpreter services: an unclassified
                // event updates discovery, without implying session intent.
                void this._runtimeRouter.syncActiveInterpreter('Python interpreter refresh', resource, false)
                    .catch(error => this._services.logChannel.warn(String(error)));
            }),
            interpreterService.onDidChangeInterpreters((event) => {
                this._interpreterChangeQueue = this._interpreterChangeQueue.then(async () => {
                    if (!this._disposed) { await this.handleInterpreterChange(event); }
                }).catch(error => this._services.logChannel.warn(`Failed to update Python runtimes: ${error}`));
            }),
            this.registerCommand(PYTHON_START_SUPERVISOR_CONSOLE_COMMAND, () => this.startConsole()),
            this.registerCommand(PYTHON_SELECT_SUPERVISOR_RUNTIME_COMMAND, () => this.selectRuntime()),
            this.registerCommand(PYTHON_RESTART_SUPERVISOR_CONSOLE_COMMAND, () => this.restartConsole()),
            this.registerCommand(PYTHON_STOP_SUPERVISOR_CONSOLE_COMMAND, () => this.stopConsole()),
            this.registerCommand(PYTHON_EXECUTE_IN_SUPERVISOR_COMMAND, (resource?: vscode.Uri) => {
                return this._consoleExecutionService.executeSelectionCommand(
                    PYTHON_EXECUTE_IN_SUPERVISOR_COMMAND,
                    'supervisor.console.executeCode',
                    this.getExecutionResource(resource),
                );
            }),
            this.registerCommand(PYTHON_EXECUTE_IN_SUPERVISOR_WITHOUT_ADVANCING_COMMAND, (resource?: vscode.Uri) => {
                return this._consoleExecutionService.executeSelectionCommand(
                    PYTHON_EXECUTE_IN_SUPERVISOR_WITHOUT_ADVANCING_COMMAND,
                    'supervisor.console.executeCodeWithoutAdvancing',
                    this.getExecutionResource(resource),
                );
            }),
            this.registerCommand(Commands.Exec_In_Console, (resource?: vscode.Uri) =>
                this._consoleExecutionService.executeFile(
                    Commands.Exec_In_Console,
                    this.getExecutionResource(resource),
                ),
            ),
        );
    }

    async initialize(): Promise<void> {
        await this._runtimeProvider.triggerInterpreterRefresh(this._services.logChannel);
        await this._runtimeRouter.syncActiveInterpreter('Python supervisor activation', undefined, false);
    }

    dispose(): void {
        this._disposed = true;
        this._disposables.forEach((disposable) => disposable.dispose());
        this._consoleExecutionService.dispose();
    }

    private async startConsole(): Promise<void> {
        await this._services.positronConsoleService.revealConsole(true);

        const existingSession = this._runtimeRouter.getLiveConsoleSession();
        if (existingSession) {
            this._services.runtimeSessionService.focusSession(existingSession.sessionId);
            return;
        }

        const executionResource = this.getExecutionResource();
        let runtimeMetadata = await this._runtimeRouter.resolveRuntimeMetadata(
            PYTHON_START_SUPERVISOR_CONSOLE_COMMAND,
            executionResource,
        );
        if (!runtimeMetadata) {
            const activeInstallation = await this._runtimeRouter.resolveActiveInstallation(executionResource);
            const installation = await this._services.runtimeSessionService.selectInstallation<
                PythonRuntimeInstallation
            >(PYTHON_LANGUAGE_ID, {
                allowBrowse: true,
                forcePick: true,
                persistSelection: true,
                preselectRuntimePath: activeInstallation?.pythonPath,
                placeHolder: 'Select a Python interpreter for the Supervisor console',
                title: 'Python Supervisor Runtime',
            });
            if (installation) {
                runtimeMetadata = this._runtimeRouter.registerInstallation(installation);
            }
        }

        if (!runtimeMetadata) {
            void vscode.window.showWarningMessage('No Python interpreter is available for the Supervisor console.');
            return;
        }

        await this._runtimeRouter.ensureConsoleSession(
            PYTHON_START_SUPERVISOR_CONSOLE_COMMAND,
            executionResource,
            true,
            runtimeMetadata,
        );
    }

    private async selectRuntime(): Promise<void> {
        const executionResource = this.getExecutionResource();
        const currentSession = this._runtimeRouter.getLiveConsoleSession();
        const activeInstallation = await this._runtimeRouter.resolveActiveInstallation(executionResource);
        const preferredRuntime = this._services.runtimeStartupService.getPreferredRuntime(PYTHON_LANGUAGE_ID);
        const installation = await this._services.runtimeSessionService.selectInstallation<PythonRuntimeInstallation>(
            PYTHON_LANGUAGE_ID,
            {
                allowBrowse: true,
                forcePick: true,
                persistSelection: true,
                preselectRuntimePath:
                    activeInstallation?.pythonPath ??
                    currentSession?.runtimeMetadata.runtimePath ??
                    preferredRuntime?.runtimePath,
                placeHolder: 'Select a Python interpreter for the Supervisor console',
                title: 'Select Python Supervisor Runtime',
            },
        );
        if (!installation) {
            return;
        }

        const runtimeMetadata = this._runtimeRouter.registerInstallation(installation);
        await this._services.positronConsoleService.revealConsole(true);

        if (currentSession) {
            if (currentSession.runtimeMetadata.runtimeId === runtimeMetadata.runtimeId) {
                this._services.runtimeSessionService.focusSession(currentSession.sessionId);
                return;
            }
        }

        await this._runtimeRouter.ensureConsoleSession(
            PYTHON_SELECT_SUPERVISOR_RUNTIME_COMMAND,
            executionResource,
            true,
            runtimeMetadata,
        );
    }

    private async restartConsole(): Promise<void> {
        const session = this._runtimeRouter.getLiveConsoleSession();
        if (!session) {
            void vscode.window.showWarningMessage('No active Python Supervisor console session.');
            return;
        }

        await this._services.runtimeSessionService.restartSession(
            session.sessionId,
            PYTHON_RESTART_SUPERVISOR_CONSOLE_COMMAND,
        );
    }

    private async stopConsole(): Promise<void> {
        const session = this._runtimeRouter.getLiveConsoleSession();
        if (!session) {
            void vscode.window.showWarningMessage('No active Python Supervisor console session.');
            return;
        }

        await this._services.runtimeSessionService.deleteSession(session.sessionId);
    }

    private async handleInterpreterChange(event: PythonEnvironmentsChangedEvent): Promise<void> {
        const samePath = (left: string, right: string) => process.platform === 'win32'
            ? path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase()
            : path.normalize(left) === path.normalize(right);
        if (event.old && !event.new) {
            const current = fs.existsSync(event.old.path)
                ? await this.interpreterService.getInterpreterDetails(event.old.path) : undefined;
            if (this._disposed) { return; }
            if (current) {
                const installation = this._runtimeRouter.installationFromInterpreter(current);
                const metadata = this._runtimeRouter.registerInstallation(installation);
                await this.shutdownSessionsForPath(event.old.path, metadata.runtimeId);
            } else {
                this._runtimeProvider.removeRuntimeForPath(event.old.path);
                await this.shutdownSessionsForPath(event.old.path);
            }
            return;
        }
        if (!event.new) { return; }
        if (event.old && !samePath(event.old.path, event.new.path)) {
            this._runtimeProvider.removeRuntimeForPath(event.old.path);
        } else if (event.old && event.old.version?.major === event.new.version?.major &&
            event.old.version?.minor === event.new.version?.minor) {
            return;
        }
        // Discovery may report a version from pyvenv.cfg. Resolve the executable
        // again so a replacement is registered with its current runtime metadata.
        const interpreter = await this.interpreterService.getInterpreterDetails(event.new.path);
        if (!interpreter || this._disposed) { return; }
        const installation = this._runtimeRouter.installationFromInterpreter(interpreter);
        const metadata = this._runtimeRouter.registerInstallation(installation);
        if (event.old && samePath(event.old.path, event.new.path)) {
            await this.shutdownSessionsForPath(event.old.path, metadata.runtimeId);
        }
    }

    private async shutdownSessionsForPath(pythonPath: string, keepRuntimeId?: string): Promise<void> {
        const normalize = (value: string) => process.platform === 'win32' ? path.normalize(value).toLowerCase() : path.normalize(value);
        await Promise.all(this._services.runtimeSessionService.activeSessions.filter(session =>
            session.runtimeMetadata.languageId === 'python' && session.metadata.sessionMode === 'console' &&
            normalize(session.runtimeMetadata.runtimePath) === normalize(pythonPath) &&
            session.runtimeMetadata.runtimeId !== keepRuntimeId && String(session.state) !== 'exited',
        ).map(session => {
            const pending = this._pendingShutdowns.get(session.sessionId);
            if (pending) { return pending; }
            const ended = session.onDidEndSession(() => {
                ended.dispose();
                this._pendingShutdowns.delete(session.sessionId);
            });
            this._disposables.push(ended);
            const request = Promise.resolve().then(() => session.shutdown()).catch(error => {
                ended.dispose();
                this._pendingShutdowns.delete(session.sessionId);
                throw error;
            });
            this._pendingShutdowns.set(session.sessionId, request);
            return request;
        }));
    }

    private getExecutionResource(resource?: vscode.Uri): vscode.Uri | undefined {
        if (resource instanceof vscode.Uri) {
            return resource;
        }

        const activeEditor = vscode.window.activeTextEditor;
        return activeEditor?.document.languageId === PYTHON_LANGUAGE_ID ? activeEditor.document.uri : undefined;
    }

    private registerCommand(command: string, callback: (...args: any[]) => Promise<unknown>): vscode.Disposable {
        return vscode.commands.registerCommand(command, async (...args: any[]) => {
            try {
                await callback(...args);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this._services.logChannel.error(`[Python Supervisor] Command '${command}' failed: ${message}`);
                void vscode.window.showErrorMessage(`Python Supervisor command failed: ${message}`);
                throw error;
            }
        });
    }
}

export class PythonLanguageContribution {
    readonly runtimeProvider: PythonRuntimeProvider;
    private _runtimeSessionManager: PythonRuntimeSessionManager | undefined;
    private _runtimeRouter: PythonConsoleRuntimeRouter | undefined;
    private _notebookController: PythonSupervisorNotebookController | undefined;

    constructor(
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _api: ISupervisorFrameworkApi,
        private readonly _interpreterService: IInterpreterService,
        private readonly _serviceContainer: IServiceContainer,
        private readonly _dapEnabled = true,
    ) {
        this.runtimeProvider = new PythonRuntimeProvider(_extensionContext, _interpreterService);
    }

    getRuntimeSessionManager(logChannel: vscode.LogOutputChannel): PythonRuntimeSessionManager {
        this._runtimeSessionManager ??= new PythonRuntimeSessionManager(
            this._extensionContext,
            this._api,
            this.runtimeProvider,
            logChannel,
        );
        return this._runtimeSessionManager;
    }

    getNotebookController(
        services: ILanguageContributionServices,
    ): PythonSupervisorNotebookController {
        this._notebookController ??= new PythonSupervisorNotebookController(
            this.getRuntimeRouter(services),
            services,
        );
        return this._notebookController;
    }

    getOptionalCapabilities(): readonly ILanguageOptionalCapabilityDescriptor[] {
        const services = (value: unknown) => value as ILanguageContributionServices;
        return [
            {
                id: 'python.foregroundSessionManager',
                revision: 1,
                kind: 'commands',
                activate: ({ services: value }) => this.createForegroundSessionManager(services(value)),
            },
            {
                id: 'python.consoleController',
                revision: 1,
                kind: 'commands',
                dependencies: ['python.foregroundSessionManager'],
                activate: ({ services: value }) => this.createConsoleController(services(value)),
            },
            {
                id: 'python.packages',
                revision: 1,
                kind: 'packageManager',
                activate: ({ services: value }) => this.registerPackageManager(services(value)),
            },
        ];
    }

    private registerPackageManager(services: ILanguageContributionServices): vscode.Disposable {
        return services.positronPackagesService.registerPackageManagerProvider(
            new PythonPackageManagerProvider(this.runtimeProvider, this._serviceContainer, services.logChannel),
        );
    }

    private createForegroundSessionManager(services: ILanguageContributionServices): PythonForegroundSessionManager {
        const sessionRegistry = new PythonSessionRegistry();
        return new PythonForegroundSessionManager(
            this._extensionContext,
            services.runtimeSessionService,
            sessionRegistry,
            this._serviceContainer.get<IPythonPathUpdaterServiceManager>(IPythonPathUpdaterServiceManager),
            this._serviceContainer.get<IInterpreterHelper>(IInterpreterHelper),
            this._interpreterService,
            services.logChannel,
            this._dapEnabled,
        );
    }

    private async createConsoleController(services: ILanguageContributionServices): Promise<vscode.Disposable> {
        const runtimeRouter = this.getRuntimeRouter(services);
        const consoleExecutionService = new PythonConsoleExecutionService(
            runtimeRouter,
            services.positronConsoleService,
        );
        const controller = new PythonSupervisorController(
            runtimeRouter,
            this.runtimeProvider,
            this._interpreterService,
            services,
            consoleExecutionService,
        );
        try {
            await controller.initialize();
            return controller;
        } catch (error) {
            controller.dispose();
            throw error;
        }
    }

    private getRuntimeRouter(services: ILanguageContributionServices): PythonConsoleRuntimeRouter {
        this._runtimeRouter ??= new PythonConsoleRuntimeRouter(
            this._extensionContext,
            this._api,
            this.runtimeProvider,
            services,
        );
        return this._runtimeRouter;
    }
}
