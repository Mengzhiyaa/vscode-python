import * as vscode from 'vscode';
import { LanguageClient, Position, RequestType, VersionedTextDocumentIdentifier } from 'vscode-languageclient/node';

interface HelpTopicParams {
    textDocument: VersionedTextDocumentIdentifier;
    position: Position;
}

interface HelpTopicResponse {
    topic: string;
}

export namespace PythonHelpTopicRequest {
    export const type: RequestType<HelpTopicParams, HelpTopicResponse | undefined, any> = new RequestType(
        'positron/textDocument/helpTopic',
    );
}

export class PythonHelpTopicProvider {
    constructor(private readonly _client: LanguageClient) {}

    async provideHelpTopic(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<string | undefined> {
        // Editor document synchronization is managed by LanguageClient. Do not
        // close the shared document after this one request.
        const params: HelpTopicParams = {
            textDocument: this._client.code2ProtocolConverter.asVersionedTextDocumentIdentifier(document),
            position: this._client.code2ProtocolConverter.asPosition(position),
        };

        const response = await this._client.sendRequest(PythonHelpTopicRequest.type, params, token);
        return response?.topic;
    }
}
