import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { PythonConsoleExecutionService } from '../../client/supervisor/pythonConsoleExecutionService';
import { PythonConsoleRuntimeRouter } from '../../client/supervisor/pythonConsoleRuntimeRouter';
import { PYTHON_LANGUAGE_ID } from '../../client/supervisor/runtimeProvider';
import type { IPositronConsoleService } from '../../client/supervisor/types/supervisor-api';
import { UnsavedScriptFiles } from '../../client/supervisor/unsavedScriptFiles';

suite('Python Supervisor - Console Execution Service', () => {
    let service: PythonConsoleExecutionService;
    let openDocument: sinon.SinonStub;
    let unsavedScripts: UnsavedScriptFiles;
    let runtimeRouter: {
        ensureConsoleSession: sinon.SinonStub;
        getLiveConsoleSession: sinon.SinonStub;
    };
    let executeCodeStub: sinon.SinonStub;
    let positronConsoleService: IPositronConsoleService;
    let originalExecuteCommand: unknown;
    let originalShowWarningMessage: unknown;

    setup(() => {
        openDocument = sinon.stub(vscode.workspace, 'openTextDocument').resolves({
            uri: vscode.Uri.file('/tmp/test.py'), isUntitled: false, isDirty: false,
        } as vscode.TextDocument);
        unsavedScripts = new UnsavedScriptFiles();
        sinon.stub(unsavedScripts, 'write').resolves('/tmp/scratch.py');
        sinon.stub(unsavedScripts, 'watchExecution');
        sinon.stub(unsavedScripts, 'finished').resolves();
        sinon.stub(unsavedScripts, 'dispose');
        runtimeRouter = {
            ensureConsoleSession: sinon.stub().resolves({
                sessionId: 'session-1',
                runtimeMetadata: { runtimeId: 'python-runtime-1' },
            }),
            getLiveConsoleSession: sinon.stub().returns(undefined),
        };
        executeCodeStub = sinon.stub().resolves('session-1');
        positronConsoleService = ({
            executeCode: executeCodeStub,
        } as unknown) as IPositronConsoleService;

        service = new PythonConsoleExecutionService(
            (runtimeRouter as unknown) as PythonConsoleRuntimeRouter,
            positronConsoleService,
            unsavedScripts,
        );
        originalExecuteCommand = (vscode.commands as any).executeCommand;
        originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    });

    teardown(() => {
        service.dispose();
        (vscode.commands as any).executeCommand = originalExecuteCommand;
        (vscode.window as any).showWarningMessage = originalShowWarningMessage;
        sinon.restore();
    });

    test('runs a saved script with the kernel run magic and preserves editor focus', async () => {
        const file = vscode.Uri.file('/tmp/test file.py');
        openDocument.resolves({ uri: file, isUntitled: false, isDirty: false } as vscode.TextDocument);

        await service.executeFile('python.execInConsole', file);

        sinon.assert.calledOnceWithExactly(runtimeRouter.ensureConsoleSession, 'python.execInConsole', file, false);

        const [
            languageId,
            sessionId,
            code,
            attribution,
            focus,
            allowIncomplete,
            mode,
            errorBehavior,
            executionId,
            documentUri,
            executionMetadata,
        ] = executeCodeStub.firstCall.args;

        expect(languageId).to.equal(PYTHON_LANGUAGE_ID);
        expect(sessionId).to.equal('session-1');
        expect(code).to.equal(process.platform === 'win32'
            ? `%run -G -- "${file.fsPath.replace(/\\/g, '/')}"`
            : `%run -G -- '${file.fsPath}'`);
        expect(attribution).to.deep.include({
            source: 'python.execInConsole',
            fileUri: file,
            lineNumber: 1,
        });
        expect(focus).to.equal(false);
        expect(allowIncomplete).to.equal(true);
        expect(mode).to.equal(undefined);
        expect(errorBehavior).to.equal(undefined);
        expect(executionId).to.equal(undefined);
        expect(documentUri).to.equal(file);
        expect(executionMetadata).to.deep.equal({ executionTarget: 'file' });
    });

    test('runs files in the live console without resolving or selecting another interpreter', async () => {
        runtimeRouter.getLiveConsoleSession.returns({ sessionId: 'session-2' });
        await service.executeFile('python.execInConsole', vscode.Uri.file('/tmp/test.py'));
        sinon.assert.notCalled(runtimeRouter.ensureConsoleSession);
        expect(executeCodeStub.firstCall.args[1]).to.equal('session-2');
    });

    test('keeps an untitled snapshot until its execution completes rather than merely being enqueued', async () => {
        const file = vscode.Uri.parse('untitled:Untitled-1');
        const document = { uri: file, isUntitled: true, isDirty: true } as vscode.TextDocument;
        const session = { sessionId: 'session-2' };
        openDocument.resolves(document);
        runtimeRouter.getLiveConsoleSession.returns(session);
        await service.executeFile('python.execInConsole', file);
        const executionId = executeCodeStub.firstCall.args[8];
        expect(executionId).to.be.a('string');
        sinon.assert.calledOnceWithExactly(unsavedScripts.write as sinon.SinonStub, document);
        sinon.assert.calledOnceWithExactly(unsavedScripts.watchExecution as sinon.SinonStub,
            '/tmp/scratch.py', session, executionId);
        sinon.assert.notCalled(unsavedScripts.finished as sinon.SinonStub);
        expect(executeCodeStub.firstCall.args[3].fileUri).to.equal(file);
    });

    test('cleans an untitled snapshot if enqueueing fails', async () => {
        openDocument.resolves({ uri: vscode.Uri.parse('untitled:Untitled-1'), isUntitled: true } as vscode.TextDocument);
        runtimeRouter.getLiveConsoleSession.returns({ sessionId: 'session-2' });
        const error = new Error('enqueue failed');
        executeCodeStub.rejects(error);
        let failure: unknown;
        await service.executeFile('python.execInConsole', vscode.Uri.parse('untitled:Untitled-1'))
            .catch((value) => { failure = value; });
        expect(failure).to.equal(error);
        sinon.assert.calledOnceWithExactly(unsavedScripts.finished as sinon.SinonStub, '/tmp/scratch.py');
    });

    test('does not run stale file contents after saving is cancelled', async () => {
        const file = vscode.Uri.file('/tmp/test.py');
        openDocument.resolves({ uri: file, isUntitled: false, isDirty: true,
            save: sinon.stub().resolves(false) } as unknown as vscode.TextDocument);
        await service.executeFile('python.execInConsole', file);
        sinon.assert.notCalled(executeCodeStub);
        sinon.assert.notCalled(runtimeRouter.ensureConsoleSession);
    });

    test('executes selection commands after ensuring a supervisor console session when no console is live', async () => {
        const executeCommandStub = sinon.stub().resolves(undefined);
        const file = vscode.Uri.file('/tmp/test.py');
        (vscode.commands as any).executeCommand = executeCommandStub;

        await service.executeSelectionCommand(
            'python.executeSelectionInSupervisor',
            'supervisor.console.executeCode',
            file,
        );

        sinon.assert.calledOnceWithExactly(
            runtimeRouter.ensureConsoleSession,
            'python.executeSelectionInSupervisor',
            file,
            false,
        );
        sinon.assert.calledOnceWithExactly(executeCommandStub, 'supervisor.console.executeCode', {
            allowIncomplete: true,
        });
    });

    test('executes selection commands against the live console session without re-routing runtimes', async () => {
        const executeCommandStub = sinon.stub().resolves(undefined);
        const file = vscode.Uri.file('/tmp/test.py');
        (vscode.commands as any).executeCommand = executeCommandStub;
        runtimeRouter.getLiveConsoleSession.returns({
            sessionId: 'session-2',
            state: 'ready',
            runtimeMetadata: { runtimeId: 'python-runtime-2', languageId: PYTHON_LANGUAGE_ID },
        });

        await service.executeSelectionCommand(
            'python.executeSelectionInSupervisor',
            'supervisor.console.executeCode',
            file,
        );

        sinon.assert.notCalled(runtimeRouter.ensureConsoleSession);
        sinon.assert.calledOnceWithExactly(executeCommandStub, 'supervisor.console.executeCode', {
            allowIncomplete: true,
        });
    });

    test('passes allowIncomplete when executing a selection without advancing', async () => {
        const executeCommandStub = sinon.stub().resolves(undefined);
        const file = vscode.Uri.file('/tmp/test.py');
        (vscode.commands as any).executeCommand = executeCommandStub;

        await service.executeSelectionCommand(
            'python.executeSelectionInSupervisorWithoutAdvancing',
            'supervisor.console.executeCodeWithoutAdvancing',
            file,
        );

        sinon.assert.calledOnceWithExactly(executeCommandStub, 'supervisor.console.executeCodeWithoutAdvancing', {
            allowIncomplete: true,
        });
    });

    test('warns instead of executing when no supervisor runtime can be resolved', async () => {
        const warningStub = sinon.stub().resolves(undefined);
        const file = vscode.Uri.file('/tmp/test.py');
        (vscode.window as any).showWarningMessage = warningStub;

        runtimeRouter.ensureConsoleSession.resolves(undefined);

        await service.executeFile('python.execInConsole', file);

        sinon.assert.notCalled(executeCodeStub);
        sinon.assert.calledOnce(warningStub);
    });
});
