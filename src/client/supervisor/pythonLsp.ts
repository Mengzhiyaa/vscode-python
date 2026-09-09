import { Socket } from 'net';
import * as vscode from 'vscode';
import { RedactingOutputChannel } from '../logging/redactingLogOutputChannel';
import {
    DocumentSelector,
    LanguageClient,
    LanguageClientOptions,
    RevealOutputChannelOn,
    State,
    StreamInfo,
} from 'vscode-languageclient/node';
import { PYTHON_LANGUAGE } from '../common/constants';
import { PythonHelpTopicProvider } from './pythonHelpTopicProvider';
import { PythonStatementRangeProvider } from './pythonStatementRangeProvider';
import type {
    ILanguageLsp,
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

    get statementRangeProvider(): PythonStatementRangeProvider | undefined {
        return this._statementRangeProvider;
    }

    get helpTopicProvider(): PythonHelpTopicProvider | undefined {
        return this._helpTopicProvider;
    }

    async activate(port: number): Promise<void> {
        this.activationDisposables.forEach((disposable) => disposable.dispose());
        this.activationDisposables = [];

        const serverOptions = async (): Promise<StreamInfo> => {
            const out = new PromiseHandles<StreamInfo>();
            const socket = new Socket();
            socket.on('ready', () => {
                out.resolve({ reader: socket, writer: socket });
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
        if (!this.client || !this.client.needsStop()) {
            return;
        }

        await this._initializing;

        await this.client.stop();
        this._statementRangeProvider = undefined;
        this._helpTopicProvider = undefined;
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

    async requestCompletion(code: string, position: { line: number; character: number }): Promise<any[]> {
        // Console completion is an explicit user invocation (Tab / trigger
        // suggest), matching the context sent by Positron's editor client.
        const result = await this.requestForVirtualDocument<any>('textDocument/completion', code, position, {
            triggerKind: 1,
        });
        if (Array.isArray(result)) {
            return result;
        }

        if (result && typeof result === 'object' && 'items' in result) {
            return (result as any).items || [];
        }

        return [];
    }

    async requestHover(code: string, position: { line: number; character: number }): Promise<any | null> {
        return this.requestForVirtualDocument('textDocument/hover', code, position);
    }

    async requestSignatureHelp(code: string, position: { line: number; character: number }): Promise<any | null> {
        return this.requestForVirtualDocument('textDocument/signatureHelp', code, position);
    }

    async dispose(): Promise<void> {
        this.activationDisposables.forEach((disposable) => disposable.dispose());
        await this.deactivate();
    }

    private async requestForVirtualDocument<T>(
        method: string,
        code: string,
        position: { line: number; character: number },
        completionContext?: { triggerKind: number },
    ): Promise<T | null> {
        if (!this.client || this._state !== LANGUAGE_LSP_STATE.Running) {
            this.log(`LSP not ready for ${method} request`, vscode.LogLevel.Debug);
            return null;
        }

        const uri = this.createRequestTextDocumentUri();
        const textDocument = {
            uri,
            languageId: PYTHON_LANGUAGE,
            version: 1,
            text: code,
        };

        this.client.sendNotification('textDocument/didOpen', { textDocument });
        try {
            return await this.client.sendRequest(method, {
                textDocument: { uri },
                position,
                ...(completionContext ? { context: completionContext } : {}),
            });
        } catch (error) {
            this.log(`${method} request failed: ${error}`, vscode.LogLevel.Error);
            return null;
        } finally {
            this.client.sendNotification('textDocument/didClose', {
                textDocument: { uri },
            });
        }
    }

    private createRequestTextDocumentUri(): string {
        const requestPath = this._metadata.notebookUri
            ? `/notebook-repl-python-${this._metadata.sessionId}/input-${Date.now()}.py`
            : `/console/input-${Date.now()}.py`;
        return vscode.Uri.from({ scheme: 'inmemory', path: requestPath }).toString();
    }

    private registerPositronLspExtensions(client: LanguageClient): void {
        this._statementRangeProvider = new PythonStatementRangeProvider(client);
        this._helpTopicProvider = new PythonHelpTopicProvider(client);
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
