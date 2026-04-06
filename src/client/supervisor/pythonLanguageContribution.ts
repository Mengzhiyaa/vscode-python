import * as vscode from 'vscode';
import { Commands } from '../common/constants';
import { IInterpreterService } from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { PythonConsoleExecutionService } from './pythonConsoleExecutionService';
import { PythonConsoleRuntimeRouter } from './pythonConsoleRuntimeRouter';
import { PythonForegroundSessionManager } from './pythonForegroundSessionManager';
import { PythonRuntimeProvider, PythonRuntimeInstallation, PYTHON_LANGUAGE_ID } from './runtimeProvider';
import { PythonRuntimeSessionManager } from './runtimeSessionManager';
import { PythonRuntimeStartupManager } from './runtimeStartupManager';
import { PythonSessionRegistry } from './pythonSessionRegistry';
import type {
    ILanguageContributionServices,
    ILanguageExtensionContribution,
    ISupervisorFrameworkApi,
} from './types/supervisor-api';
import { IInterpreterHelper } from '../interpreter/contracts';
import { IPythonPathUpdaterServiceManager } from '../interpreter/configuration/types';

export const PYTHON_START_SUPERVISOR_CONSOLE_COMMAND = 'python.startSupervisorConsole';
export const PYTHON_SELECT_SUPERVISOR_RUNTIME_COMMAND = 'python.selectSupervisorRuntime';
export const PYTHON_RESTART_SUPERVISOR_CONSOLE_COMMAND = 'python.restartSupervisorConsole';
export const PYTHON_STOP_SUPERVISOR_CONSOLE_COMMAND = 'python.stopSupervisorConsole';
export const PYTHON_EXECUTE_IN_SUPERVISOR_COMMAND = 'python.executeSelectionInSupervisor';
export const PYTHON_EXECUTE_IN_SUPERVISOR_WITHOUT_ADVANCING_COMMAND =
    'python.executeSelectionInSupervisorWithoutAdvancing';

export class PythonLanguageContribution implements ILanguageExtensionContribution {
    readonly runtimeProvider: PythonRuntimeProvider;

    constructor(
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _api: ISupervisorFrameworkApi,
        private readonly _interpreterService: IInterpreterService,
        private readonly _serviceContainer: IServiceContainer,
    ) {
        this.runtimeProvider = new PythonRuntimeProvider(_extensionContext, _interpreterService);
    }

    async registerContributions(
        services: ILanguageContributionServices,
    ): Promise<vscode.Disposable[]> {
        const runtimeStartupManager = new PythonRuntimeStartupManager(
            this._extensionContext,
            this.runtimeProvider,
            services.runtimeManager,
            services.runtimeStartupService,
            services.logChannel,
        );
        const runtimeSessionManager = new PythonRuntimeSessionManager(
            this._extensionContext,
            this._api,
            this.runtimeProvider,
            services.logChannel,
        );
        const runtimeRouter = new PythonConsoleRuntimeRouter(
            this._extensionContext,
            this._api,
            this.runtimeProvider,
            services,
        );
        const consoleExecutionService = new PythonConsoleExecutionService(
            runtimeRouter,
            this._serviceContainer,
            services.positronConsoleService,
        );
        const sessionRegistry = new PythonSessionRegistry();
        const foregroundSessionManager = new PythonForegroundSessionManager(
            this._extensionContext,
            services.runtimeSessionService,
            sessionRegistry,
            this._serviceContainer.get<IPythonPathUpdaterServiceManager>(IPythonPathUpdaterServiceManager),
            this._serviceContainer.get<IInterpreterHelper>(IInterpreterHelper),
            this._interpreterService,
            services.logChannel,
        );
        const controller = new PythonSupervisorController(
            runtimeRouter,
            this.runtimeProvider,
            this._interpreterService,
            services,
            consoleExecutionService,
        );
        await controller.initialize();

        return [
            services.runtimeManager.registerExternalDiscoveryManager?.(this.runtimeProvider.languageId) ??
                new vscode.Disposable(() => undefined),
            services.runtimeStartupService.registerRuntimeManager(runtimeStartupManager),
            services.runtimeSessionService.registerSessionManager(runtimeSessionManager),
            runtimeStartupManager,
            foregroundSessionManager,
            controller,
        ];
    }
}

class PythonSupervisorController implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(
        private readonly _runtimeRouter: PythonConsoleRuntimeRouter,
        private readonly _runtimeProvider: PythonRuntimeProvider,
        interpreterService: IInterpreterService,
        private readonly _services: ILanguageContributionServices,
        private readonly _consoleExecutionService: PythonConsoleExecutionService,
    ) {
        this._disposables.push(
            interpreterService.onDidChangeInterpreter((workspaceUri) => {
                void this._runtimeRouter.syncActiveInterpreter('Python interpreter changed', workspaceUri);
            }),
            interpreterService.onDidChangeInterpreterConfiguration((workspaceUri) => {
                void this._runtimeRouter.syncActiveInterpreter(
                    'Python interpreter configuration changed',
                    workspaceUri,
                );
            }),
            interpreterService.onDidChangeInterpreters((event) => {
                if (!event.new) {
                    return;
                }

                void this.registerInterpreter(event.new, 'Python interpreter discovered');
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
                this._consoleExecutionService.executeFile(Commands.Exec_In_Console, this.getExecutionResource(resource)),
            ),
        );
    }

    async initialize(): Promise<void> {
        await this._runtimeProvider.refreshInterpreters(this._services.logChannel);
        await this._runtimeRouter.syncActiveInterpreter('Python supervisor activation');
    }

    dispose(): void {
        this._disposables.forEach((disposable) => disposable.dispose());
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
            const installation = await this._services.runtimeSessionService.selectInstallation<PythonRuntimeInstallation>(
                PYTHON_LANGUAGE_ID,
                {
                    allowBrowse: true,
                    forcePick: true,
                    persistSelection: true,
                    preselectRuntimePath: activeInstallation?.pythonPath,
                    placeHolder: 'Select a Python interpreter for the Supervisor console',
                    title: 'Python Supervisor Runtime',
                },
            );
            if (installation) {
                runtimeMetadata = this._runtimeRouter.registerInstallation(installation);
            }
        }

        if (!runtimeMetadata) {
            void vscode.window.showWarningMessage(
                'No Python interpreter is available for the Supervisor console.',
            );
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

    private async registerInterpreter(interpreter: PythonEnvironment, source: string): Promise<void> {
        const installation = this._runtimeRouter.installationFromInterpreter(interpreter);
        this._runtimeRouter.registerInstallation(installation);
        if (this._runtimeRouter.isActiveInstallation(installation)) {
            await this._runtimeRouter.syncActiveInterpreter(source);
        }
    }

    private getExecutionResource(resource?: vscode.Uri): vscode.Uri | undefined {
        if (resource instanceof vscode.Uri) {
            return resource;
        }

        const activeEditor = vscode.window.activeTextEditor;
        return activeEditor?.document.languageId === PYTHON_LANGUAGE_ID ? activeEditor.document.uri : undefined;
    }

    private registerCommand(
        command: string,
        callback: (...args: any[]) => Promise<unknown>,
    ): vscode.Disposable {
        return vscode.commands.registerCommand(command, async (...args: any[]) => {
            try {
                await callback(...args);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this._services.logChannel.error(
                    `[Python Supervisor] Command '${command}' failed: ${message}`,
                );
                void vscode.window.showErrorMessage(`Python Supervisor command failed: ${message}`);
            }
        });
    }
}
