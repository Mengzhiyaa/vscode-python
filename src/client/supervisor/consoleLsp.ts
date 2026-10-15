import type { Socket } from 'net';
import * as vscode from 'vscode';
import {
    CancellationToken, State, StreamMessageReader, StreamMessageWriter,
    type LanguageClient, type Message, type MessageTransports, type Middleware,
} from 'vscode-languageclient/node';
import type {
    ILanguageConsoleLspBridge, ILanguageConsoleLspNotification, ILanguageConsoleLspRegistration,
} from './types/supervisor-api';

type RequestHandler = (params: unknown, token: vscode.CancellationToken) => Promise<unknown>;

/** Observes public LanguageClient transports without taking ownership of its protocol handlers. */
export class HostConsoleLspBridge implements ILanguageConsoleLspBridge, vscode.Disposable {
    private readonly notifications = new vscode.EventEmitter<ILanguageConsoleLspNotification>();
    readonly onDidReceiveNotification = this.notifications.event;
    private readonly dynamicRegistrations = new Map<string, ILanguageConsoleLspRegistration>();
    private readonly consoleDocuments = new Set<string>();
    private readonly requestHandlers = new Map<string, RequestHandler>();
    private synchronization: Promise<void> = Promise.resolve();
    private connectionGeneration = 0;
    private consoleCommands = 0;

    constructor(private readonly getClient: () => LanguageClient | undefined) {}

    get capabilities(): Readonly<Record<string, unknown>> | undefined {
        const client = this.getClient();
        return client?.state === State.Running && client.initializeResult
            ? { ...client.initializeResult.capabilities } : undefined;
    }

    get registrations(): readonly ILanguageConsoleLspRegistration[] {
        return [...this.dynamicRegistrations.values()];
    }

    readonly middleware: Middleware = {
        handleRegisterCapability: async (params, next) => {
            await next(params, CancellationToken.None);
            for (const registration of params.registrations) {
                this.dynamicRegistrations.set(registration.id, registration);
            }
            this.notifications.fire({ method: 'client/registerCapability', params });
        },
        handleUnregisterCapability: async (params, next) => {
            await next(params, CancellationToken.None);
            for (const registration of params.unregisterations) {
                this.dynamicRegistrations.delete(registration.id);
            }
            this.notifications.fire({ method: 'client/unregisterCapability', params });
        },
        workspace: {
            handleApplyEdit: async (params, next) => {
                const uris = [
                    ...Object.keys(params.edit.changes ?? {}),
                    ...(params.edit.documentChanges ?? []).flatMap(change =>
                        'textDocument' in change ? [change.textDocument.uri] : []),
                ];
                if (!this.consoleCommands && !uris.some(uri => uri.startsWith('inmemory://console/'))) { return next(params, CancellationToken.None); }
                const handler = this.requestHandlers.get('workspace/applyEdit');
                if (!handler) { return { applied: false, failureReason: 'Console document is closed' }; }
                const result = await handler(params, CancellationToken.None);
                const response = result as { applied?: unknown; failureReason?: unknown } | null;
                return response && typeof response.applied === 'boolean'
                    ? { applied: response.applied, failureReason: typeof response.failureReason === 'string' ? response.failureReason : undefined }
                    : { applied: false, failureReason: 'Invalid Console edit response' };
            },
        },
    };

    ownsDocument(uri: string): boolean { return this.consoleDocuments.has(vscode.Uri.parse(uri).toString(true)); }

    createTransports(socket: Socket): MessageTransports {
        const generation = ++this.connectionGeneration;
        this.dynamicRegistrations.clear();
        this.consoleDocuments.clear();
        const reader = new StreamMessageReader(socket);
        return {
            reader: {
                onError: reader.onError, onClose: reader.onClose, onPartialMessage: reader.onPartialMessage,
                listen: callback => reader.listen(message => {
                    if (generation === this.connectionGeneration) { this.observe(message); }
                    callback(message);
                }),
                dispose: () => reader.dispose(),
            },
            writer: new StreamMessageWriter(socket),
        };
    }

    private observe(message: Message): void {
        const value = message as Message & { method?: string; params?: { uri?: string } };
        if (value.method === 'textDocument/publishDiagnostics' && value.params?.uri &&
            this.ownsDocument(value.params.uri)) {
            // Preserve the server's wire diagnostics, including document versions.
            this.notifications.fire({ method: value.method, params: value.params });
        } else if (value.method === 'workspace/diagnostic/refresh' || value.method === 'workspace/semanticTokens/refresh') {
            // The Host still handles and acknowledges these real server requests.
            this.notifications.fire({ method: value.method, params: value.params });
        }
    }

    async sendRequest(method: string, params: unknown, token: vscode.CancellationToken): Promise<unknown> {
        const generation = this.connectionGeneration;
        await this.synchronization;
        const client = this.getClient();
        if (!client || client.state !== State.Running || generation !== this.connectionGeneration || token.isCancellationRequested) {
            throw new Error('Host LSP client is unavailable');
        }
        if (method === 'workspace/executeCommand') { this.consoleCommands++; }
        try { return await client.sendRequest(method, params, token); }
        finally { if (method === 'workspace/executeCommand') { this.consoleCommands--; } }
    }

    sendNotification(method: string, params: unknown): Promise<void> {
        const generation = this.connectionGeneration;
        const pending = this.synchronization.then(async () => {
            const client = this.getClient();
            if (!client || client.state !== State.Running || generation !== this.connectionGeneration) {
                throw new Error('Host LSP client is unavailable');
            }
            const rawUri = (params as { textDocument?: { uri?: string } } | undefined)?.textDocument?.uri;
            const uri = rawUri ? vscode.Uri.parse(rawUri).toString(true) : undefined;
            if (method === 'textDocument/didOpen' && uri) { this.consoleDocuments.add(uri); }
            try { await client.sendNotification(method, params); }
            finally {
                if (method === 'textDocument/didClose' && uri) { this.consoleDocuments.delete(uri); }
            }
        });
        this.synchronization = pending.catch(() => {});
        return pending;
    }

    registerRequestHandler(method: string, handler: RequestHandler): vscode.Disposable {
        this.requestHandlers.set(method, handler);
        return new vscode.Disposable(() => {
            if (this.requestHandlers.get(method) === handler) { this.requestHandlers.delete(method); }
        });
    }

    dispose(): void {
        this.connectionGeneration++;
        this.consoleDocuments.clear();
        this.dynamicRegistrations.clear();
        this.requestHandlers.clear();
        this.notifications.dispose();
    }
}
