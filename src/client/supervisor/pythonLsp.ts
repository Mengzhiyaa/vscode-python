import { Socket } from 'net';
import * as vscode from 'vscode';
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

const PYTHON_INMEMORY_SELECTOR: DocumentSelector = [{ language: PYTHON_LANGUAGE, scheme: 'inmemory' }];

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

function timeout(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Timeout: ${message}`)), ms);
    });
}

let lspOutputChannel: vscode.OutputChannel | undefined;
function getLspOutputChannel(): vscode.OutputChannel {
    if (!lspOutputChannel) {
        lspOutputChannel = vscode.window.createOutputChannel('Python Supervisor Language Server');
    }
    return lspOutputChannel;
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
            `Python language client (${_version}) for session ` +
            `${_dynState.sessionName} - '${_metadata.sessionId}'`;
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
            documentSelector: PYTHON_INMEMORY_SELECTOR,
            outputChannel: getLspOutputChannel(),
            revealOutputChannelOn: RevealOutputChannelOn.Never,
        };

        const clientId = 'positron.python';
        const message =
            `Creating language client ${this._dynState.sessionName} ` +
            `for session ${this._metadata.sessionId} on port ${port}`;

        this.log(message);
        getLspOutputChannel().appendLine(message);

        this.client = new LanguageClient(clientId, this._languageClientName, serverOptions, clientOptions);

        const out = new PromiseHandles<void>();
        this._initializing = out.promise;

        this.activationDisposables.push(this.client.onDidChangeState((event) => {
            const oldState = this._state;
            switch (event.newState) {
                case State.Starting:
                    this.setState(LANGUAGE_LSP_STATE.Starting);
                    break;
                case State.Running:
                    if (this._initializing) {
                        this._initializing = undefined;
                        if (this.client) {
                            this.registerPositronLspExtensions(this.client);
                        }
                        out.resolve();
                    }
                    this.setState(LANGUAGE_LSP_STATE.Running);
                    break;
                case State.Stopped:
                    if (this._initializing) {
                        out.reject(new Error('Python language client stopped before initialization'));
                    }
                    this.setState(LANGUAGE_LSP_STATE.Stopped);
                    break;
                default:
                    break;
            }

            this.log(
                `${this._languageClientName} state changed ${oldState} => ${this._state}`,
                vscode.LogLevel.Debug,
            );
        }));

        this.client.start();
        await out.promise;
    }

    async deactivate(): Promise<void> {
        if (!this.client || !this.client.needsStop()) {
            return;
        }

        await this._initializing;

        const stopped = new Promise<void>((resolve) => {
            const disposable = this.client!.onDidChangeState((event) => {
                if (event.newState === State.Stopped) {
                    disposable.dispose();
                    resolve();
                }
            });
        });

        this.client.stop();
        await Promise.race([stopped, timeout(2000, 'waiting for Python LSP client to stop')]);
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

    async requestCompletion(
        code: string,
        position: { line: number; character: number },
    ): Promise<any[]> {
        const result = await this.requestForVirtualDocument<any>('textDocument/completion', code, position);
        if (Array.isArray(result)) {
            return result;
        }

        if (result && typeof result === 'object' && 'items' in result) {
            return (result as any).items || [];
        }

        return [];
    }

    async requestHover(
        code: string,
        position: { line: number; character: number },
    ): Promise<any | null> {
        return this.requestForVirtualDocument('textDocument/hover', code, position);
    }

    async requestSignatureHelp(
        code: string,
        position: { line: number; character: number },
    ): Promise<any | null> {
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
