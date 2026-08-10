import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { PythonSupervisorNotebookController } from '../../client/supervisor/pythonNotebookController';
import { MockOutputChannel } from '../mockClasses';

suite('Python Supervisor - Notebook Controller', () => {
    teardown(() => {
        delete (vscode.notebooks as any).createNotebookController;
        sinon.restore();
    });

    test('executes a cell while registry ownership is managed by the builder', async () => {
        const stateEmitter = new vscode.EventEmitter<any>();
        const streamEmitter = new vscode.EventEmitter<any>();
        const resultEmitter = new vscode.EventEmitter<any>();
        const cancellationEmitter = new vscode.EventEmitter<void>();
        const emptyEvent = new vscode.EventEmitter<any>().event;
        const execute = sinon.stub();
        const session = {
            state: 'ready',
            execute,
            interrupt: sinon.stub().resolves(),
            replyToPrompt: sinon.stub().resolves(),
            onDidReceiveRuntimeMessageStream: streamEmitter.event,
            onDidReceiveRuntimeMessageInput: emptyEvent,
            onDidReceiveRuntimeMessageError: emptyEvent,
            onDidReceiveRuntimeMessageOutput: emptyEvent,
            onDidReceiveRuntimeMessageResult: resultEmitter.event,
            onDidReceiveRuntimeMessagePrompt: emptyEvent,
            onDidReceiveRuntimeMessageClearOutput: emptyEvent,
            onDidReceiveRuntimeMessageUpdateOutput: emptyEvent,
            onDidReceiveRuntimeMessageIPyWidget: emptyEvent,
            onDidReceiveRuntimeMessageState: stateEmitter.event,
            onDidEndSession: emptyEvent,
        };
        execute.callsFake((_code, id) => {
            streamEmitter.fire({ parent_id: id, name: 'stdout', text: 'hello\n' });
            resultEmitter.fire({
                parent_id: id,
                execution_count: 7,
                data: { 'text/plain': '7' },
            });
            stateEmitter.fire({ parent_id: id, state: 'idle' });
        });

        const execution = {
            token: { onCancellationRequested: cancellationEmitter.event },
            executionOrder: undefined,
            start: sinon.spy(),
            end: sinon.spy(),
            clearOutput: sinon.stub().resolves(),
            appendOutput: sinon.stub().resolves(),
            replaceOutput: sinon.stub().resolves(),
            replaceOutputItems: sinon.stub().resolves(),
        };
        const notebookController = {
            id: 'python-supervisor',
            notebookType: 'jupyter-notebook',
            label: 'Python (Supervisor)',
            supportedLanguages: undefined,
            description: undefined,
            supportsExecutionOrder: false,
            executeHandler: sinon.stub(),
            interruptHandler: undefined,
            createNotebookCellExecution: sinon.stub().returns(execution),
            dispose: sinon.spy(),
        };
        (vscode.notebooks as any).createNotebookController = sinon
            .stub()
            .returns((notebookController as unknown) as vscode.NotebookController);

        const notebookUri = vscode.Uri.file('/tmp/notebook.ipynb');
        const notebook = ({ uri: notebookUri } as unknown) as vscode.NotebookDocument;
        const cell = ({
            metadata: { id: 'cell-1' },
            document: {
                uri: vscode.Uri.parse('vscode-notebook-cell:/tmp/notebook.ipynb#cell-1'),
                getText: () => 'print("hello")',
            },
        } as unknown) as vscode.NotebookCell;
        const runtimeMetadata = { runtimeId: 'python-runtime-1', languageId: 'python' };
        const runtimeRouter = {
            resolveRuntimeMetadata: sinon.stub().resolves(runtimeMetadata),
            resolveActiveInstallation: sinon.stub(),
            registerInstallation: sinon.stub(),
        };
        const getNotebookSessionForNotebookUri = sinon.stub();
        getNotebookSessionForNotebookUri.onFirstCall().returns(undefined);
        getNotebookSessionForNotebookUri.onSecondCall().returns(session);
        const services = {
            logChannel: new MockOutputChannel('python-supervisor'),
            runtimeSessionService: {
                getNotebookSessionForNotebookUri,
                selectRuntime: sinon.stub().resolves(),
                selectInstallation: sinon.stub(),
            },
        };

        const controller = new PythonSupervisorNotebookController(runtimeRouter as any, services as any);
        await notebookController.executeHandler([cell], notebook, notebookController as any);

        sinon.assert.calledOnceWithExactly(
            services.runtimeSessionService.selectRuntime,
            'python-runtime-1',
            'python.supervisor.notebook',
            notebookUri,
        );
        sinon.assert.calledOnce(execute);
        expect(execute.firstCall.args[0]).to.equal('print("hello")');
        expect(execute.firstCall.args[2]).to.equal('interactive');
        expect(execute.firstCall.args[3]).to.equal('stop');
        expect(execute.firstCall.args[4]).to.deep.equal({
            source: 'python.supervisor.notebook',
            fileUri: notebookUri,
            metadata: { cellId: 'cell-1' },
        });
        expect(execution.executionOrder).to.equal(7);
        sinon.assert.calledTwice(execution.appendOutput);
        const streamItem = execution.appendOutput.firstCall.args[0].items[0];
        expect(streamItem.mime).to.equal('application/vnd.code.notebook.stdout');
        expect(Buffer.from(streamItem.data).toString()).to.equal('hello\n');
        const resultItem = execution.appendOutput.secondCall.args[0].items[0];
        expect(resultItem.mime).to.equal('text/plain');
        expect(Buffer.from(resultItem.data).toString()).to.equal('7');
        sinon.assert.calledOnceWithExactly(execution.end, true, sinon.match.number);

        controller.dispose();
        sinon.assert.calledOnce(notebookController.dispose);
    });
});
