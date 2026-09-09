import { expect } from 'chai';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { anything, reset, when } from 'ts-mockito';
import { mockedVSCodeNamespaces } from '../vscode-mock';
import { DocumentSelector, LanguageClient, State } from 'vscode-languageclient/node';

import {
    disposePythonLspOutputChannel,
    getDocumentSelectorForSession,
    PythonLanguageLsp,
} from '../../client/supervisor/pythonLsp';
import { MockOutputChannel } from '../mockClasses';

function selectorEntries(selector: DocumentSelector) {
    return Array.isArray(selector) ? selector : [selector];
}

suite('Python Supervisor - LSP document selectors', () => {
    test('the foreground session owns Python documents in the main editor', () => {
        const entries = selectorEntries(getDocumentSelectorForSession());

        expect(entries).to.deep.include({ language: 'python', pattern: '**/*.py' });
        expect(entries).to.deep.include({ language: 'python', scheme: 'untitled' });
        expect(entries).to.deep.include({ language: 'python', scheme: 'inmemory' });
    });

    test('a notebook session is scoped to its notebook and related virtual documents', () => {
        const notebookUri = vscode.Uri.file('/workspace/notebook.ipynb');
        const entries = selectorEntries(getDocumentSelectorForSession(notebookUri));

        expect(entries).to.deep.include({ language: 'python', pattern: notebookUri.fsPath });
        expect(entries).to.deep.include({ language: 'python', pattern: '**/.vdoc.*.{py,PY}' });
        expect(entries).to.deep.include({ language: 'python', scheme: 'inmemory' });
        expect(entries).not.to.deep.include({ language: 'python', pattern: '**/*.py' });
    });
});

suite('Python Supervisor - LSP startup', () => {
    setup(() => {
        sinon.stub(LanguageClient.prototype as any, 'checkVersion');
        when(mockedVSCodeNamespaces.window!.createOutputChannel(anything())).thenReturn(new MockOutputChannel('lsp'));
    });
    teardown(() => {
        disposePythonLspOutputChannel();
        sinon.restore();
        reset(mockedVSCodeNamespaces.window);
    });

    test('propagates initialization failure to its owner', async () => {
        const error = new Error('initialize failed');
        sinon.stub(LanguageClient.prototype, 'start').rejects(error);
        const lsp = new PythonLanguageLsp(
            '3.11',
            { sessionId: 'test' } as any,
            { sessionName: 'test' } as any,
            new MockOutputChannel('python'),
        );
        let failure: unknown;
        await lsp.activate(1234).catch((value) => {
            failure = value;
        });
        expect(failure).to.equal(error);
        expect(lsp.state).to.equal('stopped');
        await lsp.dispose();
    });

    test('waits for initialization after the client emits Running', async () => {
        let listener!: (event: any) => void;
        sinon.stub(LanguageClient.prototype, 'onDidChangeState').get(() => (callback: typeof listener) => {
            listener = callback;
            return { dispose() {} };
        });
        let finish!: () => void;
        sinon.stub(LanguageClient.prototype, 'start').callsFake(async () => {
            listener({ oldState: State.Starting, newState: State.Running });
            await new Promise<void>((resolve) => {
                finish = resolve;
            });
        });
        const lsp = new PythonLanguageLsp(
            '3.11',
            { sessionId: 'test' } as any,
            { sessionName: 'test' } as any,
            new MockOutputChannel('python'),
        );
        let ready = false;
        const activation = lsp.activate(1234).then(() => {
            ready = true;
        });
        await Promise.resolve();
        expect(ready).to.equal(false);
        expect(lsp.state).not.to.equal('running');
        finish();
        await activation;
        expect(lsp.state).to.equal('running');
        await lsp.dispose();
    });
});
