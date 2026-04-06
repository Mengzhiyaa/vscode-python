import { expect } from 'chai';
import * as sinon from 'sinon';
import * as TypeMoq from 'typemoq';
import * as vscode from 'vscode';

import { IConfigurationService } from '../../client/common/types';
import { IServiceContainer } from '../../client/ioc/types';
import { PythonConsoleExecutionService } from '../../client/supervisor/pythonConsoleExecutionService';
import { PythonConsoleRuntimeRouter } from '../../client/supervisor/pythonConsoleRuntimeRouter';
import { PYTHON_LANGUAGE_ID } from '../../client/supervisor/runtimeProvider';
import type { IPositronConsoleService } from '../../client/supervisor/types/supervisor-api';
import { ICodeExecutionHelper } from '../../client/terminals/types';

suite('Python Supervisor - Console Execution Service', () => {
    let service: PythonConsoleExecutionService;
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let codeExecutionHelper: TypeMoq.IMock<ICodeExecutionHelper>;
    let configurationService: TypeMoq.IMock<IConfigurationService>;
    let runtimeRouter: {
        ensureConsoleSession: sinon.SinonStub;
        getLiveConsoleSession: sinon.SinonStub;
    };
    let executeCodeStub: sinon.SinonStub;
    let positronConsoleService: IPositronConsoleService;
    let originalExecuteCommand: unknown;
    let originalShowWarningMessage: unknown;

    setup(() => {
        serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();
        codeExecutionHelper = TypeMoq.Mock.ofType<ICodeExecutionHelper>();
        configurationService = TypeMoq.Mock.ofType<IConfigurationService>();
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

        serviceContainer
            .setup((container) => container.get(TypeMoq.It.isValue(ICodeExecutionHelper)))
            .returns(() => codeExecutionHelper.object);
        serviceContainer
            .setup((container) => container.get(TypeMoq.It.isValue(IConfigurationService)))
            .returns(() => configurationService.object);
        configurationService
            .setup((config) => config.getSettings(TypeMoq.It.isAny()))
            .returns(() => ({ terminal: { executeInFileDir: true } } as any));

        service = new PythonConsoleExecutionService(
            (runtimeRouter as unknown) as PythonConsoleRuntimeRouter,
            serviceContainer.object,
            positronConsoleService,
        );
        originalExecuteCommand = (vscode.commands as any).executeCommand;
        originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    });

    teardown(() => {
        (vscode.commands as any).executeCommand = originalExecuteCommand;
        (vscode.window as any).showWarningMessage = originalShowWarningMessage;
        sinon.restore();
    });

    test('executes a file through the supervisor console with runpy bootstrap code', async () => {
        const file = vscode.Uri.file('/tmp/test file.py');

        codeExecutionHelper
            .setup((helper) => helper.saveFileIfDirty(TypeMoq.It.isValue(file)))
            .returns(() => Promise.resolve(undefined));

        await service.executeFile('python.execInConsole', file);

        codeExecutionHelper.verify((helper) => helper.getFileToExecute(), TypeMoq.Times.never());
        sinon.assert.calledOnceWithExactly(runtimeRouter.ensureConsoleSession, 'python.execInConsole', file, true);

        const [languageId, sessionId, code, attribution, focus] = executeCodeStub.firstCall.args;

        expect(languageId).to.equal(PYTHON_LANGUAGE_ID);
        expect(sessionId).to.equal('session-1');
        expect(code).to.include('runpy.run_path');
        expect(code).to.include('__vsc_py_chdir = True');
        expect(code).to.include(JSON.stringify(file.fsPath));
        expect(attribution).to.deep.include({
            source: 'python.execInConsole',
            fileUri: file,
            lineNumber: 1,
        });
        expect(focus).to.equal(true);
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
        sinon.assert.calledOnceWithExactly(executeCommandStub, 'supervisor.console.executeCode');
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
        sinon.assert.calledOnceWithExactly(executeCommandStub, 'supervisor.console.executeCode');
    });

    test('warns instead of executing when no supervisor runtime can be resolved', async () => {
        const warningStub = sinon.stub().resolves(undefined);
        const file = vscode.Uri.file('/tmp/test.py');
        (vscode.window as any).showWarningMessage = warningStub;

        runtimeRouter.ensureConsoleSession.resolves(undefined);
        codeExecutionHelper
            .setup((helper) => helper.saveFileIfDirty(TypeMoq.It.isValue(file)))
            .returns(() => Promise.resolve(undefined));

        await service.executeFile('python.execInConsole', file);

        sinon.assert.notCalled(executeCodeStub);
        sinon.assert.calledOnce(warningStub);
    });
});
