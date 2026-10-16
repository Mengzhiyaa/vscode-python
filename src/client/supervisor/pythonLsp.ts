import { Socket } from 'net';
import * as vscode from 'vscode';
import { RedactingOutputChannel } from '../logging/redactingLogOutputChannel';
import {
    DocumentSelector,
    LanguageClient,
    LanguageClientOptions,
    RevealOutputChannelOn,
    State,
    MessageTransports,
} from 'vscode-languageclient/node';
import { PYTHON_LANGUAGE } from '../common/constants';
import { PythonHelpTopicProvider } from './pythonHelpTopicProvider';
import { PythonStatementRangeProvider } from './pythonStatementRangeProvider';
import { HostConsoleLspBridge } from './consoleLsp';
import type {
    ILanguageLsp,
    ILanguageConsoleLspConfiguration,
    ILanguageLspFactory,
    ILanguageLspStateChangeEvent,
    IRuntimeSessionMetadata,
    LanguageLspState,
    LanguageRuntimeDynState,
    LanguageRuntimeMetadata,
} from './types/supervisor-api';

const LANGUAGE_LSP_STATE = {
    Uninitialized: 'uninitialized' as LanguageLspState,
    Starting: 'starting' as LanguageLspState,
    Stopped: 'stopped' as LanguageLspState,
    Running: 'running' as LanguageLspState,
} as const;

const PYTHON_VDOC_SELECTOR = { language: PYTHON_LANGUAGE, pattern: '**/.vdoc.*.{py,PY}' };

/**
 * Select the documents owned by a session's language client.
 *
 * The foreground console session is the main Python language client, so it
 * owns regular editor documents as well as console inputs. Notebook sessions
 * are scoped to their notebook and related virtual documents so they do not
 * compete with the foreground session for ordinary Python files.
 */
export function getDocumentSelectorForSession(notebookUri?: vscode.Uri): DocumentSelector {
    if (notebookUri) {
        return [
            { language: PYTHON_LANGUAGE, pattern: notebookUri.fsPath },
            PYTHON_VDOC_SELECTOR,
            { language: PYTHON_LANGUAGE, scheme: 'inmemory' },
        ];
    }

    return [
        { language: PYTHON_LANGUAGE, scheme: 'untitled' },
        { language: PYTHON_LANGUAGE, scheme: 'inmemory' },
        { language: PYTHON_LANGUAGE, scheme: 'assistant-code-confirmation-widget' },
        { language: PYTHON_LANGUAGE, pattern: '**/*.py' },
        PYTHON_VDOC_SELECTOR,
    ];
}

class PromiseHandles<T> {
    resolve!: (value: T | PromiseLike<T>) => void;
    reject!: (reason?: any) => void;
    promise: Promise<T>;

    constructor() {
        this.promise = new Promise<T>((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
}

let lspOutputChannel: vscode.OutputChannel | undefined;
function getLspOutputChannel(): vscode.OutputChannel {
    if (!lspOutputChannel) {
        lspOutputChannel = new RedactingOutputChannel(
            vscode.window.createOutputChannel('Python Supervisor Language Server'),
        );
    }
    return lspOutputChannel;
}

export function disposePythonLspOutputChannel(): void {
    lspOutputChannel?.dispose();
    lspOutputChannel = undefined;
}

export class PythonLanguageLsp implements ILanguageLsp {
    private client?: LanguageClient;
    readonly consoleLspBridge = new HostConsoleLspBridge(() => this.client);
    private _state: LanguageLspState = LANGUAGE_LSP_STATE.Uninitialized;
    private _stateEmitter = new vscode.EventEmitter<ILanguageLspStateChangeEvent>();
    private _initializing?: Promise<void>;
    private activationDisposables: vscode.Disposable[] = [];
    private _statementRangeProvider?: PythonStatementRangeProvider;
    private _helpTopicProvider?: PythonHelpTopicProvider;
    private readonly _languageClientName: string;

    readonly onDidChangeState = this._stateEmitter.event;

    constructor(
        _version: string,
        private readonly _metadata: IRuntimeSessionMetadata,
        private readonly _dynState: LanguageRuntimeDynState,
        private readonly _logChannel: vscode.LogOutputChannel,
    ) {
        this._languageClientName =
            `Python language client (${_version}) for session ` + `${_dynState.sessionName} - '${_metadata.sessionId}'`;
    }

    get state(): LanguageLspState {
        return this._state;
    }

    get consoleLspConfiguration(): ILanguageConsoleLspConfiguration | undefined {
        if (this._metadata.sessionMode !== 'console') {
            return undefined;
        }

        const workingDirectory = this._dynState.currentWorkingDirectory ?? this._metadata.workingDirectory;
        const folder = workingDirectory
            ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(workingDirectory))
            : undefined;
        const root = folder ?? vscode.workspace.workspaceFolders?.[0];
        const configuration = vscode.workspace.getConfiguration(undefined, root?.uri);
        // APK requests the section selected by its compiled analysis backend.
        const settings = {
            ty: configuration.get<Record<string, unknown>>('ty', {}),
            pyrefly: configuration.get<Record<string, unknown>>('pyrefly', {}),
        };
        const folders = vscode.workspace.workspaceFolders ?? [];

        return {
            rootUri: root?.uri.toString(),
            workspaceFolders: (root ? [root, ...folders.filter(folder => folder !== root)] : folders).map(folder => ({
                uri: folder.uri.toString(), name: folder.name,
            })),
            initializationOptions: {
                ...settings,
                positron: { working_directory: workingDirectory },
            },
            settings,
            allowedCommands: [],
            kernelCompletionFallback: true,
        };
    }

    get statementRangeProvider(): PythonStatementRangeProvider | undefined {
        return this._statementRangeProvider;
    }

    get helpTopicProvider(): PythonHelpTopicProvider | undefined {
        return this._helpTopicProvider;
    }

    async activate(port: number): Promise<void> {
        this.activationDisposables.forEach((disposable) => disposable.dispose());
        this.activationDisposables = [];

        const consoleBridge = this.consoleLspBridge;
        const serverOptions = async (): Promise<MessageTransports> => {
            const out = new PromiseHandles<MessageTransports>();
            const socket = new Socket();
            socket.on('ready', () => {
                out.resolve(consoleBridge.createTransports(socket));
            });
            socket.on('error', (error) => {
                out.reject(error);
            });
            socket.connect(port);
            return out.promise;
        };

        const clientOptions: LanguageClientOptions = {
            documentSelector: getDocumentSelectorForSession(this._metadata.notebookUri),
            outputChannel: getLspOutputChannel(),
            revealOutputChannelOn: RevealOutputChannelOn.Never,
            initializationOptions: this.consoleLspConfiguration?.initializationOptions,
            synchronize: { configurationSection: ['ty', 'pyrefly'] },
            middleware: {
                ...consoleBridge.middleware,
                handleDiagnostics(uri, diagnostics, next) {
                    if (!(uri.scheme === 'inmemory' && uri.authority === 'console')) { next(uri, diagnostics); }
                },
            },
        };

        const clientId = 'positron.python';
        const message =
            `Creating language client ${this._dynState.sessionName} ` +
            `for session ${this._metadata.sessionId} on port ${port}`;

        this.log(message);
        getLspOutputChannel().appendLine(
            `** Begin Python LSP log for session ${this._dynState.sessionName} ` +
                `(${this._metadata.sessionId}) on port ${port} at ${new Date().toISOString()} **`,
        );

        this.client = new LanguageClient(clientId, this._languageClientName, serverOptions, clientOptions);

        this.activationDisposables.push(
            this.client.onDidChangeState((event) => {
                const oldState = this._state;
                switch (event.newState) {
                    case State.Starting:
                        this.setState(LANGUAGE_LSP_STATE.Starting);
                        break;
                    case State.Running:
                        if (!this._initializing && this.client) {
                            void this.startClient(this.client).catch((error) => {
                                this.log(`LSP restart failed: ${error}`, vscode.LogLevel.Error);
                            });
                        }
                        break;
                    case State.Stopped:
                        this.clearPositronLspExtensions();
                        this.setState(LANGUAGE_LSP_STATE.Stopped);
                        break;
                    default:
                        break;
                }

                this.log(
                    `${this._languageClientName} state changed ${oldState} => ${this._state}`,
                    vscode.LogLevel.Debug,
                );
            }),
        );

        await this.startClient(this.client);
    }

    private startClient(client: LanguageClient): Promise<void> {
        const initializing = Promise.resolve()
            .then(() => client.start())
            .then(() => {
                this.registerPositronLspExtensions(client);
                this.setState(LANGUAGE_LSP_STATE.Running);
            });
        const settled = initializing
            .catch((error) => {
                this.setState(LANGUAGE_LSP_STATE.Stopped);
                throw error;
            })
            .finally(() => {
                if (this._initializing === settled) {
                    this._initializing = undefined;
                }
            });
        this._initializing = settled;
        return settled;
    }

    async deactivate(): Promise<void> {
        this.clearPositronLspExtensions();
        const client = this.client;
        if (!client || !client.needsStop()) {
            return;
        }

        try {
            await this._initializing;
        } finally {
            // Initialization may install fresh providers while we wait.
            this.clearPositronLspExtensions();
        }
        if (!client.needsStop()) {
            return;
        }

        let listener: vscode.Disposable | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            // As in Positron, wait for Stopped rather than stop(): its Promise
            // may never settle when the server has disconnected.
            await new Promise<void>((resolve, reject) => {
                listener = client.onDidChangeState((event) => {
                    if (event.newState === State.Stopped) {
                        resolve();
                    }
                });
                timer = setTimeout(() => {
                    reject(new Error('Timed out after 2 seconds waiting for Python LSP client to stop.'));
                }, 2000);
                void client.stop().catch(reject);
            });
        } finally {
            if (timer !== undefined) {
                clearTimeout(timer);
            }
            listener?.dispose();
        }
    }

    async wait(): Promise<boolean> {
        switch (this.state) {
            case LANGUAGE_LSP_STATE.Running:
                return true;
            case LANGUAGE_LSP_STATE.Stopped:
                return false;
            case LANGUAGE_LSP_STATE.Starting:
                await this._initializing;
                return true;
            case LANGUAGE_LSP_STATE.Uninitialized: {
                const handles = new PromiseHandles<boolean>();
                const disposable = this.onDidChangeState(() => {
                    if (this.state === LANGUAGE_LSP_STATE.Running) {
                        disposable.dispose();
                        handles.resolve(true);
                        return;
                    }

                    if (this.state === LANGUAGE_LSP_STATE.Stopped) {
                        disposable.dispose();
                        handles.resolve(false);
                    }
                });

                return handles.promise;
            }
            default:
                throw new Error(`Unexpected Python LSP state: ${this.state}`);
        }
    }

    showOutput(): void {
        getLspOutputChannel().show();
    }

    async dispose(): Promise<void> {
        this.activationDisposables.forEach((disposable) => disposable.dispose());
        await this.deactivate();
        this.consoleLspBridge.dispose();
    }

    private registerPositronLspExtensions(client: LanguageClient): void {
        this._statementRangeProvider = new PythonStatementRangeProvider(client);
        this._helpTopicProvider = new PythonHelpTopicProvider(client);
    }

    private clearPositronLspExtensions(): void {
        this._statementRangeProvider = undefined;
        this._helpTopicProvider = undefined;
    }

    private setState(state: LanguageLspState): void {
        const oldState = this._state;
        this._state = state;
        this._stateEmitter.fire({ oldState, newState: state });
    }

    private log(message: string, level: vscode.LogLevel = vscode.LogLevel.Info): void {
        const formatted = `[Python Supervisor LSP] ${message}`;
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

export class PythonLanguageLspFactory implements ILanguageLspFactory {
    readonly languageId = PYTHON_LANGUAGE;

    create(
        runtimeMetadata: LanguageRuntimeMetadata,
        sessionMetadata: IRuntimeSessionMetadata,
        dynState: LanguageRuntimeDynState,
        logChannel: vscode.LogOutputChannel,
    ): ILanguageLsp {
        return new PythonLanguageLsp(runtimeMetadata.languageVersion, sessionMetadata, dynState, logChannel);
    }
}
