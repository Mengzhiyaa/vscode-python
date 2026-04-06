import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { PythonConsoleRuntimeRouter } from '../../client/supervisor/pythonConsoleRuntimeRouter';
import { PYTHON_LANGUAGE_ID } from '../../client/supervisor/runtimeProvider';
import { MockOutputChannel } from '../mockClasses';

suite('Python Supervisor - Console Runtime Router', () => {
    let router: PythonConsoleRuntimeRouter;
    let runtimeProvider: {
        languageId: string;
        resolveActiveInstallation: sinon.SinonStub;
        createRuntimeMetadata: sinon.SinonStub;
        isActiveInstallation: sinon.SinonStub;
        installationFromEnvironment: sinon.SinonStub;
    };
    let api: {
        startRuntime: sinon.SinonStub;
    };
    let services: {
        logChannel: vscode.LogOutputChannel;
        runtimeSessionService: {
            getConsoleSessionForLanguage: sinon.SinonStub;
            getConsoleSessionForRuntime: sinon.SinonStub;
            getSession: sinon.SinonStub;
            selectRuntime: sinon.SinonStub;
        };
        runtimeStartupService: {
            getPreferredRuntime: sinon.SinonStub;
        };
        runtimeManager: {
            registerDiscoveredRuntime: sinon.SinonStub;
        };
    };

    setup(() => {
        runtimeProvider = {
            languageId: PYTHON_LANGUAGE_ID,
            resolveActiveInstallation: sinon.stub(),
            createRuntimeMetadata: sinon.stub(),
            isActiveInstallation: sinon.stub(),
            installationFromEnvironment: sinon.stub(),
        };
        api = {
            startRuntime: sinon.stub().resolves('session-1'),
        };
        services = {
            logChannel: new MockOutputChannel('python-supervisor'),
            runtimeSessionService: {
                getConsoleSessionForLanguage: sinon.stub(),
                getConsoleSessionForRuntime: sinon.stub(),
                getSession: sinon.stub(),
                selectRuntime: sinon.stub().resolves(),
            },
            runtimeStartupService: {
                getPreferredRuntime: sinon.stub(),
            },
            runtimeManager: {
                registerDiscoveredRuntime: sinon.stub(),
            },
        };

        router = new PythonConsoleRuntimeRouter(
            {} as vscode.ExtensionContext,
            api as any,
            runtimeProvider as any,
            services as any,
        );
    });

    teardown(() => {
        sinon.restore();
    });

    test('selects the active interpreter runtime for a live console session', async () => {
        const installation = { pythonPath: '/tmp/python', envType: 'Unknown' as any };
        const runtimeMetadata = {
            runtimeId: 'python-runtime-1',
            runtimePath: installation.pythonPath,
            languageId: PYTHON_LANGUAGE_ID,
        };
        const session = {
            sessionId: 'session-1',
            state: 'ready',
            runtimeMetadata: {
                runtimeId: 'old-runtime',
                languageId: PYTHON_LANGUAGE_ID,
            },
        };

        runtimeProvider.resolveActiveInstallation.resolves(installation);
        runtimeProvider.createRuntimeMetadata.returns(runtimeMetadata);
        services.runtimeSessionService.getConsoleSessionForLanguage.returns(session);

        const result = await router.ensureConsoleSession('python.executeSelectionInSupervisor', vscode.Uri.file('/tmp/test.py'));

        expect(result?.runtimeMetadata).to.equal(runtimeMetadata);
        expect(result?.sessionId).to.equal('session-1');
        sinon.assert.calledOnceWithExactly(
            services.runtimeSessionService.selectRuntime,
            'python-runtime-1',
            'python.executeSelectionInSupervisor',
        );
        sinon.assert.notCalled(api.startRuntime);
        sinon.assert.calledOnceWithExactly(
            services.runtimeManager.registerDiscoveredRuntime,
            PYTHON_LANGUAGE_ID,
            installation,
            runtimeMetadata,
        );
    });

    test('starts a console session when no live session exists', async () => {
        const installation = { pythonPath: '/tmp/python', envType: 'Unknown' as any };
        const runtimeMetadata = {
            runtimeId: 'python-runtime-1',
            runtimePath: installation.pythonPath,
            languageId: PYTHON_LANGUAGE_ID,
        };
        const session = {
            sessionId: 'session-1',
            state: 'ready',
            runtimeMetadata,
        };

        runtimeProvider.resolveActiveInstallation.resolves(installation);
        runtimeProvider.createRuntimeMetadata.returns(runtimeMetadata);
        services.runtimeSessionService.getConsoleSessionForLanguage.returns(undefined);
        services.runtimeSessionService.getSession.withArgs('session-1').returns(session);

        const result = await router.ensureConsoleSession('python.execInConsole', vscode.Uri.file('/tmp/test.py'), true);

        expect(result?.sessionId).to.equal('session-1');
        expect(result?.session).to.equal(session);
        sinon.assert.calledOnceWithExactly(api.startRuntime, runtimeMetadata, 'python.execInConsole', true);
    });
});
