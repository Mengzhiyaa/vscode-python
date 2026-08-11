import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { notifySupervisorEnvironmentContributionsChanged } from '../../client/supervisor/environmentContributions';
import { activateSupervisor } from '../../client/supervisor/extension';

suite('Python Supervisor - Extension Registration', () => {
    teardown(() => {
        sinon.restore();
    });

    test('declares passive Python language assets in the package manifest', () => {
        const packageJson = JSON.parse(
            fs.readFileSync(path.resolve(__dirname, '../../..', 'package.json'), 'utf8'),
        );

        expect(packageJson.supervisor).to.deep.equal({
            languageAssetsVersion: 1,
            languages: [{
                languageId: 'python',
                displayName: 'Python',
                assets: {
                    localResourceRoots: ['./resources/supervisor', './syntaxes'],
                    monacoSupportModule: './resources/supervisor/pythonMonacoSupport.js',
                    textMateGrammar: {
                        scopeName: 'source.python',
                        path: './syntaxes/MagicPython.tmLanguage.json',
                    },
                },
            }],
        });
    });

    test('rejects stale APIs and retries Python supervisor registration', async () => {
        const extensionUri = vscode.Uri.file('/tmp/python-extension');
        const replaceEnvironmentVariable = 1 as vscode.EnvironmentVariableMutatorType;
        let startupValue = '/tmp/pythonrc.py';
        const context = ({
            extension: {
                id: 'ms-python.python',
                packageJSON: {
                    positron: {
                        binaryDependencies: {
                            apk: '0.1.0',
                        },
                    },
                },
            },
            extensionPath: extensionUri.fsPath,
            extensionUri,
            subscriptions: [],
            environmentVariableCollection: {
                forEach: (callback: (name: string, mutator: vscode.EnvironmentVariableMutator) => void) => {
                    callback('PYTHONSTARTUP', {
                        type: replaceEnvironmentVariable,
                        value: startupValue,
                        options: {},
                    });
                },
            },
        } as unknown) as vscode.ExtensionContext;
        const environmentRegistrationDisposals = [sinon.spy(), sinon.spy()];
        const registerEnvironmentContributions = sinon.stub();
        environmentRegistrationDisposals.forEach((dispose, index) => {
            registerEnvironmentContributions.onCall(index).returns(new vscode.Disposable(dispose));
        });

        const notebookController = { dispose: sinon.spy() } as unknown as vscode.NotebookController;
        const notebooks = vscode.notebooks as unknown as {
            createNotebookController?: () => vscode.NotebookController;
        };
        const originalCreateNotebookController = notebooks.createNotebookController;
        notebooks.createNotebookController = sinon.stub().returns(notebookController);
        const handle = new vscode.Disposable(() => undefined);
        const setBinaryProvider = sinon.stub();
        const builder = {
            setRuntimeProvider: sinon.stub(),
            setSessionManager: sinon.stub(),
            setLspFactory: sinon.stub(),
            setBinaryProvider,
            addNotebookController: sinon.stub(),
            addOptionalCapability: sinon.stub(),
            commit: sinon.stub().returns(handle),
        };
        for (const method of [
            builder.setRuntimeProvider,
            builder.setSessionManager,
            builder.setLspFactory,
            builder.setBinaryProvider,
            builder.addNotebookController,
            builder.addOptionalCapability,
        ]) {
            method.returns(builder);
        }
        const supervisorApi = {
            apiVersion: 2,
            protocolVersion: { major: 2, minor: 0 },
            capabilities: ['languageCapabilityRegistry'],
            services: { logChannel: {} },
            languages: {
                forExtension: sinon.stub().returns({
                    ownerExtensionId: 'ms-python.python',
                    begin: sinon.stub().returns(builder),
                }),
            },
            registerEnvironmentContributions,
        };
        const supervisorExtension = {
            activate: sinon.stub(),
        };
        supervisorExtension.activate.onFirstCall().resolves({
            apiVersion: 1,
            registerEnvironmentContributions,
        });
        supervisorExtension.activate.onSecondCall().resolves(supervisorApi);
        const serviceContainer = {
            get: sinon.stub().returns({}),
        };

        sinon.stub(vscode.extensions, 'getExtension').returns(supervisorExtension as any);

        let firstError: Error | undefined;
        try {
            await activateSupervisor(context, serviceContainer as any);
        } catch (error) {
            firstError = error as Error;
        }

        expect(firstError?.message).to.contain('does not expose the required Supervisor Language API');

        await activateSupervisor(context, serviceContainer as any);
        await activateSupervisor(context, serviceContainer as any);

        sinon.assert.calledTwice(supervisorExtension.activate);
        sinon.assert.calledOnce(builder.commit);
        expect(setBinaryProvider.firstCall.args[0].getBinaryDefinitions().apk.installDir).to.equal(
            path.join(context.extensionPath, 'resources', 'apk'),
        );
        sinon.assert.calledOnceWithExactly(registerEnvironmentContributions, 'ms-python.python', [
            {
                action: replaceEnvironmentVariable,
                name: 'PYTHONSTARTUP',
                value: '/tmp/pythonrc.py',
            },
        ]);

        startupValue = '/tmp/updated-pythonrc.py';
        notifySupervisorEnvironmentContributionsChanged();
        expect(registerEnvironmentContributions.secondCall.args).to.deep.equal([
            'ms-python.python',
            [
                {
                    action: replaceEnvironmentVariable,
                    name: 'PYTHONSTARTUP',
                    value: '/tmp/updated-pythonrc.py',
                },
            ],
        ]);
        sinon.assert.calledOnce(environmentRegistrationDisposals[0]);
        sinon.assert.notCalled(environmentRegistrationDisposals[1]);

        context.subscriptions.forEach((subscription) => subscription.dispose());
        sinon.assert.calledOnce(environmentRegistrationDisposals[1]);
        notebooks.createNotebookController = originalCreateNotebookController;
    });

    test('shares a registration attempt and retains independent capability ownership', async () => {
        const extensionUri = vscode.Uri.file('/tmp/python-extension-registry');
        const context = ({
            extension: {
                id: 'ms-python.python',
                packageJSON: {
                    positron: { binaryDependencies: { apk: '0.1.0' } },
                },
            },
            extensionPath: extensionUri.fsPath,
            extensionUri,
            subscriptions: [],
            environmentVariableCollection: { forEach: sinon.stub() },
        } as unknown) as vscode.ExtensionContext;
        const notebookController = {
            dispose: sinon.spy(),
        } as unknown as vscode.NotebookController;
        const notebooks = vscode.notebooks as unknown as {
            createNotebookController?: () => vscode.NotebookController;
        };
        const originalCreateNotebookController = notebooks.createNotebookController;
        notebooks.createNotebookController = sinon.stub().returns(notebookController);

        const setRuntimeProvider = sinon.stub();
        const setSessionManager = sinon.stub();
        const setLspFactory = sinon.stub();
        const setBinaryProvider = sinon.stub();
        const addNotebookController = sinon.stub();
        const addOptionalCapability = sinon.stub();
        const handle = new vscode.Disposable(sinon.spy());
        const builder = {
            setRuntimeProvider,
            setSessionManager,
            setLspFactory,
            setBinaryProvider,
            addNotebookController,
            addOptionalCapability,
            commit: sinon.stub().returns(handle),
        };
        for (const method of [
            setRuntimeProvider,
            setSessionManager,
            setLspFactory,
            setBinaryProvider,
            addNotebookController,
            addOptionalCapability,
        ]) {
            method.returns(builder);
        }

        const begin = sinon.stub().returns(builder);
        const forExtension = sinon.stub().returns({ ownerExtensionId: 'ms-python.python', begin });
        const registerEnvironmentContributions = sinon.stub().returns(new vscode.Disposable(() => undefined));
        const api = {
            apiVersion: 2,
            protocolVersion: { major: 2, minor: 0 },
            capabilities: ['languageCapabilityRegistry'],
            services: { logChannel: {} },
            languages: { forExtension },
            registerEnvironmentContributions,
        };
        let resolveActivation: ((value: unknown) => void) | undefined;
        const supervisorExtension = {
            activate: sinon.stub().returns(new Promise((resolve) => {
                resolveActivation = resolve;
            })),
        };
        sinon.stub(vscode.extensions, 'getExtension').returns(supervisorExtension as any);
        const serviceContainer = { get: sinon.stub().returns({}) };

        const first = activateSupervisor(context as any, serviceContainer as any);
        const second = activateSupervisor(context as any, serviceContainer as any);
        sinon.assert.calledOnce(supervisorExtension.activate);
        resolveActivation?.(api);
        await Promise.all([first, second]);

        sinon.assert.calledOnceWithExactly(forExtension, 'ms-python.python');
        sinon.assert.calledOnceWithExactly(begin, {
            languageId: 'python',
            registrationId: 'core',
            revision: 1,
        });
        expect(setRuntimeProvider.firstCall.args[0].languageId).to.equal('python');
        expect(setSessionManager.firstCall.args[0].managesRuntime).to.be.a('function');
        expect(setLspFactory.firstCall.args[0].languageId).to.equal('python');
        expect(setBinaryProvider.firstCall.args[0].getBinaryDefinitions).to.be.a('function');
        sinon.assert.calledOnceWithExactly(addNotebookController, 'notebook.python', notebookController, ['python']);
        expect(addOptionalCapability.getCalls().map((call) => call.args[0].id)).to.deep.equal([
            'python.foregroundSessionManager',
            'python.consoleController',
            'python.packages',
        ]);
        const packageCapability = addOptionalCapability.getCalls().find((call) => call.args[0].id === 'python.packages')
            ?.args[0];
        expect(packageCapability.kind).to.equal('packageManager');
        const disposePackageProvider = sinon.spy();
        const registerPackageManagerProvider = sinon.stub().returns(new vscode.Disposable(disposePackageProvider));
        const packageRegistration = await packageCapability.activate({
            services: {
                logChannel: {},
                positronPackagesService: { registerPackageManagerProvider },
            },
        });
        sinon.assert.calledOnce(registerPackageManagerProvider);
        expect(registerPackageManagerProvider.firstCall.args[0].languageId).to.equal('python');
        packageRegistration.dispose();
        sinon.assert.calledOnce(disposePackageProvider);
        expect(context.subscriptions).to.include(handle);
        expect(context.subscriptions).to.have.length.greaterThan(2);

        context.subscriptions.forEach((subscription) => subscription.dispose());
        sinon.assert.calledOnce(notebookController.dispose as sinon.SinonSpy);

        const coreOnlyHandle = new vscode.Disposable(() => undefined);
        builder.commit.resetHistory();
        builder.commit.returns(coreOnlyHandle);
        addNotebookController.resetHistory();
        notebooks.createNotebookController = sinon.stub().throws(new Error('notebook API unavailable'));
        supervisorExtension.activate.resetBehavior();
        supervisorExtension.activate.resolves(api);
        const coreOnlyContext = ({
            ...context,
            subscriptions: [],
        } as unknown) as vscode.ExtensionContext;

        await activateSupervisor(coreOnlyContext as any, serviceContainer as any);

        sinon.assert.calledOnce(builder.commit);
        sinon.assert.notCalled(addNotebookController);
        expect(coreOnlyContext.subscriptions).to.include(coreOnlyHandle);
        coreOnlyContext.subscriptions.forEach((subscription) => subscription.dispose());
        notebooks.createNotebookController = originalCreateNotebookController;
    });
});
