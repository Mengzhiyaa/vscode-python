import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';

import { PythonHelpTopicProvider } from '../../client/supervisor/pythonHelpTopicProvider';
import { PythonStatementRangeProvider } from '../../client/supervisor/pythonStatementRangeProvider';

suite('Python Supervisor - LSP providers', () => {
    let cancellation: vscode.CancellationTokenSource;
    let document: vscode.TextDocument;
    let position: vscode.Position;
    let sendNotification: sinon.SinonStub;
    let sendRequest: sinon.SinonStub;
    let client: LanguageClient;

    setup(() => {
        cancellation = new vscode.CancellationTokenSource();
        document = {
            uri: vscode.Uri.file('/workspace/example.py'),
            languageId: 'python',
            version: 7,
            getText: () => 'value = 1',
        } as unknown as vscode.TextDocument;
        position = new vscode.Position(0, 3);
        sendNotification = sinon.stub().resolves();
        sendRequest = sinon.stub();
        client = {
            code2ProtocolConverter: {
                asVersionedTextDocumentIdentifier: sinon.stub().returns({
                    uri: document.uri.toString(),
                    version: document.version,
                }),
                asPosition: sinon.stub().returns({ line: position.line, character: position.character }),
            },
            protocol2CodeConverter: {
                asRange: sinon.stub().returns(new vscode.Range(0, 0, 0, 9)),
            },
            sendNotification,
            sendRequest,
        } as unknown as LanguageClient;
    });

    teardown(() => {
        cancellation.dispose();
        sinon.restore();
    });

    test('statement range request does not change the editor document lifecycle', async () => {
        sendRequest.resolves({
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 9 },
            },
            code: 'value = 1',
        });
        const provider = new PythonStatementRangeProvider(client);

        const result = await provider.provideStatementRange(document, position, cancellation.token);

        expect(result).to.deep.equal({
            range: new vscode.Range(0, 0, 0, 9),
            code: 'value = 1',
        });
        sinon.assert.calledOnce(sendRequest);
        sinon.assert.notCalled(sendNotification);
    });

    test('help topic request does not change the editor document lifecycle', async () => {
        sendRequest.resolves({ topic: 'example.value' });
        const provider = new PythonHelpTopicProvider(client);

        const result = await provider.provideHelpTopic(document, position, cancellation.token);

        expect(result).to.equal('example.value');
        sinon.assert.calledOnce(sendRequest);
        sinon.assert.notCalled(sendNotification);
    });
});
