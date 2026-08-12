import { expect } from 'chai';
import * as vscode from 'vscode';
import { DocumentSelector } from 'vscode-languageclient/node';

import { getDocumentSelectorForSession } from '../../client/supervisor/pythonLsp';

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
