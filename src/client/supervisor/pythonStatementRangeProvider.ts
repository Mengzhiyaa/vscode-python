import * as vscode from 'vscode';
import {
    LanguageClient,
    Position,
    Range,
    RequestType,
    VersionedTextDocumentIdentifier,
} from 'vscode-languageclient/node';

enum StatementRangeKind {
    Success = 'success',
    Rejection = 'rejection',
}

enum StatementRangeRejectionKind {
    Syntax = 'syntax',
}

interface StatementRangeParams {
    textDocument: VersionedTextDocumentIdentifier;
    position: Position;
}

interface StatementRangeLegacyResponse {
    range: Range;
    code?: string;
}

interface StatementRangeSuccessResponse {
    kind: StatementRangeKind.Success;
    range: Range;
    code?: string;
}

interface StatementRangeSyntaxRejectionResponse {
    kind: StatementRangeKind.Rejection;
    rejectionKind: StatementRangeRejectionKind.Syntax;
    line?: number;
}

type StatementRangeResponse =
    | StatementRangeLegacyResponse
    | StatementRangeSuccessResponse
    | StatementRangeSyntaxRejectionResponse;

export namespace PythonStatementRangeRequest {
    export const type: RequestType<StatementRangeParams, StatementRangeResponse | undefined, any> =
        new RequestType('positron/textDocument/statementRange');
}

export class PythonStatementRangeSyntaxError extends Error {
    constructor(readonly line?: number) {
        super(
            line === undefined
                ? 'Cannot execute code due to a syntax error.'
                : `Cannot execute code due to a syntax error near line ${line + 1}.`,
        );
        this.name = 'PythonStatementRangeSyntaxError';
    }
}

export interface PythonStatementRange {
    range: vscode.Range;
    code?: string;
}

export class PythonStatementRangeProvider {
    constructor(private readonly _client: LanguageClient) {}

    async provideStatementRange(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<PythonStatementRange | undefined> {
        return this.withOpenDocument(document, async () => {
            const params: StatementRangeParams = {
                textDocument: this._client.code2ProtocolConverter.asVersionedTextDocumentIdentifier(document),
                position: this._client.code2ProtocolConverter.asPosition(position),
            };

            const response = await this._client.sendRequest(PythonStatementRangeRequest.type, params, token);
            if (!response) {
                return undefined;
            }

            if (!('kind' in response)) {
                const range = this._client.protocol2CodeConverter.asRange(response.range);
                const code = typeof response.code === 'string' ? response.code : undefined;
                return { range, code };
            }

            switch (response.kind) {
                case StatementRangeKind.Success: {
                    const range = this._client.protocol2CodeConverter.asRange(response.range);
                    const code = typeof response.code === 'string' ? response.code : undefined;
                    return { range, code };
                }
                case StatementRangeKind.Rejection:
                    if (response.rejectionKind === StatementRangeRejectionKind.Syntax) {
                        throw new PythonStatementRangeSyntaxError(response.line);
                    }
                    throw new Error(
                        `Unrecognized statement range rejection kind: ${response.rejectionKind}`,
                    );
                default:
                    throw new Error(
                        `Unrecognized statement range response kind: ${String((response as { kind?: unknown }).kind)}`,
                    );
            }
        });
    }

    private async withOpenDocument<T>(
        document: vscode.TextDocument,
        fn: () => Promise<T>,
    ): Promise<T> {
        const textDocument = {
            uri: document.uri.toString(),
            languageId: document.languageId,
            version: document.version,
            text: document.getText(),
        };

        this._client.sendNotification('textDocument/didOpen', { textDocument });
        try {
            return await fn();
        } finally {
            this._client.sendNotification('textDocument/didClose', {
                textDocument: { uri: textDocument.uri },
            });
        }
    }
}
