import { expect } from 'chai';
import * as fs from 'fs';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { UnsavedScriptFiles } from '../../client/supervisor/unsavedScriptFiles';
import type { ILanguageRuntimeSession, RuntimeStateMessage } from '../../client/supervisor/types/supervisor-api';

suite('Python Supervisor - Unsaved Script Files', () => {
    teardown(() => { sinon.restore(); });

    test('retains separate queued snapshots until their own execution or session ends', async () => {
        const write = sinon.stub(fs.promises, 'writeFile').resolves();
        const remove = sinon.stub(fs.promises, 'rm').resolves();
        const state = new vscode.EventEmitter<RuntimeStateMessage>();
        const end = new vscode.EventEmitter<void>();
        const session = { onDidReceiveRuntimeMessageState: state.event,
            onDidEndSession: end.event } as unknown as ILanguageRuntimeSession;
        let source = 'answer = 1';
        const document = { uri: vscode.Uri.parse('untitled:Untitled-1'),
            getText: () => source } as unknown as vscode.TextDocument;
        const scripts = new UnsavedScriptFiles();
        try {
            const first = await scripts.write(document);
            source = 'answer = 2';
            const second = await scripts.write(document);
            expect(first).not.to.equal(second);
            expect(write.firstCall.args[1]).to.equal('answer = 1');
            expect(write.secondCall.args[1]).to.equal('answer = 2');
            scripts.watchExecution(first, session, 'first');
            scripts.watchExecution(second, session, 'second');

            state.fire({ parent_id: 'unrelated', state: 'idle' } as RuntimeStateMessage);
            sinon.assert.notCalled(remove);
            state.fire({ parent_id: 'first', state: 'idle' } as RuntimeStateMessage);
            sinon.assert.calledOnceWithExactly(remove, first, { force: true });
            // Repeated terminal messages do not retire another queued run.
            state.fire({ parent_id: 'first', state: 'idle' } as RuntimeStateMessage);
            sinon.assert.calledOnce(remove);
            end.fire();
            sinon.assert.calledWithExactly(remove, second, { force: true });
            expect(remove.callCount).to.equal(2);
        } finally {
            scripts.dispose();
            state.dispose();
            end.dispose();
        }
    });

    test('releases outstanding scratch files when the execution service is disposed', async () => {
        sinon.stub(fs.promises, 'writeFile').resolves();
        const remove = sinon.stub(fs.promises, 'rm').resolves();
        const scripts = new UnsavedScriptFiles();
        const document = { uri: vscode.Uri.parse('untitled:Untitled-1'),
            getText: () => 'answer = 42' } as unknown as vscode.TextDocument;
        const file = await scripts.write(document);
        scripts.dispose();
        sinon.assert.calledOnceWithExactly(remove, file, { force: true });
    });

    test('cleans only the cancelled execution, without waiting for Idle or session exit', async () => {
        sinon.stub(fs.promises, 'writeFile').resolves();
        const remove = sinon.stub(fs.promises, 'rm').resolves();
        const state = new vscode.EventEmitter<RuntimeStateMessage>();
        const end = new vscode.EventEmitter<void>();
        const cancelled = new vscode.EventEmitter<string>();
        const session = { onDidReceiveRuntimeMessageState: state.event,
            onDidEndSession: end.event, onDidCancelExecution: cancelled.event } as unknown as ILanguageRuntimeSession;
        const scripts = new UnsavedScriptFiles();
        const document = { uri: vscode.Uri.parse('untitled:Untitled-1'),
            getText: () => 'answer = 42' } as unknown as vscode.TextDocument;
        try {
            const first = await scripts.write(document);
            const second = await scripts.write(document);
            scripts.watchExecution(first, session, 'first');
            scripts.watchExecution(second, session, 'second');
            cancelled.fire('unrelated');
            sinon.assert.notCalled(remove);
            cancelled.fire('first');
            sinon.assert.calledOnceWithExactly(remove, first, { force: true });
            cancelled.fire('first');
            sinon.assert.calledOnce(remove);
            state.fire({ parent_id: 'second', state: 'idle' } as RuntimeStateMessage);
            sinon.assert.calledWithExactly(remove, second, { force: true });
            expect(remove.callCount).to.equal(2);
        } finally {
            scripts.dispose(); state.dispose(); end.dispose(); cancelled.dispose();
        }
    });
});
