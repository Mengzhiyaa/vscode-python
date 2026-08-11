// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { IWorkspaceService } from '../../../client/common/application/types';
import { IFileSystem } from '../../../client/common/platform/types';
import { IPythonExecutionFactory } from '../../../client/common/process/types';
import { IProcessServiceFactory } from '../../../client/common/process/types';
import { ITerminalServiceFactory } from '../../../client/common/terminal/types';
import { ICondaService } from '../../../client/interpreter/contracts';
import { IServiceContainer } from '../../../client/ioc/types';
import { EnvironmentType } from '../../../client/pythonEnvironments/info';
import { CondaPackageManager, parseCondaSearchResult } from '../../../client/supervisor/packages/condaPackageManager';
import { KernelPackageRpc } from '../../../client/supervisor/packages/kernelPackageRpc';
import { PackageManagerFactory } from '../../../client/supervisor/packages/packageManagerFactory';
import { PythonPackageManagerProvider } from '../../../client/supervisor/packages/packageManagerProvider';
import { PipPackageManager } from '../../../client/supervisor/packages/pipPackageManager';
import {
    resetPyPIIndexCacheForTests,
    searchPyPI,
    searchPyPIVersions,
} from '../../../client/supervisor/packages/pypiSearch';

function createLogChannel(): vscode.LogOutputChannel {
    return {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
        trace: sinon.stub(),
    } as unknown as vscode.LogOutputChannel;
}

function createSession(callMethod = sinon.stub().resolves([])): any {
    return {
        sessionId: 'session-1',
        runtimeMetadata: { runtimePath: '/env/bin/python', languageVersion: '3.12' },
        callMethod,
        interrupt: sinon.stub().resolves(),
    };
}

suite('Python Supervisor - Package Managers', () => {
    teardown(() => {
        resetPyPIIndexCacheForTests();
        sinon.restore();
    });

    test('selects Conda only for Conda installations and otherwise uses Pip', () => {
        const serviceContainer = { get: sinon.stub() } as unknown as IServiceContainer;
        const session = createSession();
        const logChannel = createLogChannel();

        expect(
            PackageManagerFactory.create(
                { pythonPath: '/conda/bin/python', envType: EnvironmentType.Conda },
                serviceContainer,
                session,
                logChannel,
            ),
        ).to.be.instanceOf(CondaPackageManager);
        for (const envType of [EnvironmentType.Venv, EnvironmentType.Global, EnvironmentType.Unknown]) {
            expect(
                PackageManagerFactory.create(
                    { pythonPath: '/env/bin/python', envType },
                    serviceContainer,
                    session,
                    logChannel,
                ),
            ).to.be.instanceOf(PipPackageManager);
        }
    });

    test('provider restores the installation from session metadata', () => {
        const installation = { pythonPath: '/env/bin/python', envType: EnvironmentType.Venv };
        const runtimeProvider = {
            restoreInstallationFromMetadata: sinon.stub().returns(installation),
        };
        const provider = new PythonPackageManagerProvider(
            runtimeProvider as any,
            { get: sinon.stub() } as unknown as IServiceContainer,
            createLogChannel(),
        );

        expect(provider.languageId).to.equal('python');
        expect(provider.createPackageManager(createSession())).to.be.instanceOf(PipPackageManager);
        sinon.assert.calledOnce(runtimeProvider.restoreInstallationFromMetadata);
    });

    test('provider declines sessions whose installation cannot be restored', () => {
        const logChannel = createLogChannel();
        const provider = new PythonPackageManagerProvider(
            { restoreInstallationFromMetadata: sinon.stub().returns(undefined) } as unknown as any,
            { get: sinon.stub() } as unknown as IServiceContainer,
            logChannel,
        );

        expect(provider.createPackageManager(createSession())).to.equal(undefined);
        sinon.assert.calledOnce(logChannel.warn as unknown as sinon.SinonStub);
    });

    test('kernel RPC forwards arguments and disposes cancellation listeners', async () => {
        const callMethod = sinon.stub().resolves({ ok: true });
        const session = createSession(callMethod);
        const dispose = sinon.spy();
        const token = {
            isCancellationRequested: false,
            onCancellationRequested: (listener: () => void) => {
                expect(listener).to.be.a('function');
                return new vscode.Disposable(dispose);
            },
        } as unknown as vscode.CancellationToken;

        const result = await new KernelPackageRpc(session, createLogChannel()).call('checkRequiresPython', token, [
            '>=3.10',
        ]);

        expect(result).to.deep.equal({ ok: true });
        sinon.assert.calledOnceWithExactly(callMethod, 'checkRequiresPython', ['>=3.10']);
        sinon.assert.calledOnce(dispose);
    });

    test('kernel RPC interrupts an in-flight call when cancelled', async () => {
        let cancel: (() => void) | undefined;
        const dispose = sinon.spy();
        const callMethod = sinon.stub().returns(new Promise(() => undefined));
        const session = createSession(callMethod);
        const token = {
            isCancellationRequested: false,
            onCancellationRequested: (listener: () => void) => {
                cancel = listener;
                return new vscode.Disposable(dispose);
            },
        } as unknown as vscode.CancellationToken;
        const promise = new KernelPackageRpc(session, createLogChannel()).call('getPackagesInstalled', token);

        cancel?.();
        let error: unknown;
        try {
            await promise;
        } catch (caught) {
            error = caught;
        }

        expect(error).to.be.instanceOf(vscode.CancellationError);
        sinon.assert.calledOnce(session.interrupt);
        sinon.assert.calledOnce(dispose);
    });

    test('kernel RPC handles pre-cancellation and interrupt failures as cancellation', async () => {
        const preCancelledSession = createSession();
        let error: unknown;
        try {
            await new KernelPackageRpc(preCancelledSession, createLogChannel()).call('getPackagesInstalled', {
                isCancellationRequested: true,
            } as unknown as vscode.CancellationToken);
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(vscode.CancellationError);
        sinon.assert.notCalled(preCancelledSession.callMethod);

        let cancel: (() => void) | undefined;
        const logChannel = createLogChannel();
        const session = createSession(sinon.stub().returns(new Promise(() => undefined)));
        session.interrupt.rejects(new Error('interrupt failed'));
        const promise = new KernelPackageRpc(session, logChannel).call('getPackagesInstalled', {
            isCancellationRequested: false,
            onCancellationRequested: (listener: () => void) => {
                cancel = listener;
                return new vscode.Disposable(() => undefined);
            },
        } as unknown as vscode.CancellationToken);
        cancel?.();
        error = undefined;
        try {
            await promise;
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(vscode.CancellationError);
        sinon.assert.calledOnce(logChannel.warn as unknown as sinon.SinonStub);
    });

    test('Pip list uses APK RPC and operations use the session interpreter', async () => {
        const terminal = {
            show: sinon.stub().resolves(),
            sendCommand: sinon.stub().resolves(),
            sendText: sinon.stub().resolves(),
        };
        const pythonService = {
            isModuleInstalled: sinon.stub().resolves(true),
            execModule: sinon.stub().callsFake((_module: string, args: string[]) =>
                Promise.resolve({
                    stdout:
                        args[0] === 'freeze'
                            ? 'demo==1.0\nother==1.0\n'
                            : JSON.stringify([{ name: 'demo', latest_version: '2.0' }]),
                }),
            ),
        };
        const executionFactory = { create: sinon.stub().resolves(pythonService) };
        const terminalFactory = { getTerminalService: sinon.stub().returns(terminal) };
        const disposeTemporaryFile = sinon.spy();
        const fileSystem = {
            createTemporaryFile: sinon.stub().resolves({
                filePath: '/tmp/package-requirements.txt',
                dispose: disposeTemporaryFile,
            }),
            writeFile: sinon.stub().resolves(),
            fileExists: sinon.stub().resolves(false),
        };
        const workspaceService = { workspaceFolders: undefined };
        const container = {
            get: sinon.stub().callsFake((key) => {
                if (key === IPythonExecutionFactory) {
                    return executionFactory;
                }
                if (key === ITerminalServiceFactory) {
                    return terminalFactory;
                }
                if (key === IFileSystem) {
                    return fileSystem;
                }
                if (key === IWorkspaceService) {
                    return workspaceService;
                }
                throw new Error(`Unexpected service: ${String(key)}`);
            }),
        } as unknown as IServiceContainer;
        const callMethod = sinon.stub().resolves([{ name: 'demo' }]);
        const manager = new PipPackageManager(
            '/env/bin/python',
            container,
            createSession(callMethod),
            createLogChannel(),
        );

        expect(await manager.getPackages()).to.deep.equal([{ name: 'demo' }]);
        sinon.assert.calledOnceWithExactly(callMethod, 'getPackagesInstalled');

        await manager.installPackages([{ name: 'demo', version: '1.0' }]);
        sinon.assert.calledWithExactly(
            terminal.sendCommand,
            '/env/bin/python',
            ['-m', 'pip', 'install', '-r', '/tmp/package-requirements.txt'],
            undefined,
            false,
        );
        sinon.assert.calledWithExactly(fileSystem.writeFile, '/tmp/package-requirements.txt', 'demo==1.0\nother\n');

        await manager.updateAllPackages();
        sinon.assert.calledWithExactly(
            terminal.sendCommand,
            '/env/bin/python',
            ['-m', 'pip', 'install', '--upgrade', '-r', '/tmp/package-requirements.txt'],
            undefined,
            false,
        );
        sinon.assert.calledTwice(disposeTemporaryFile);

        const metadata = await manager.getPackageMetadata?.(['Demo', 'other']);
        expect(metadata?.get('demo')).to.deep.equal({ outdated: true, latestVersion: '2.0' });
        expect(metadata?.get('other')).to.deep.equal({ outdated: false });
    });

    test('Conda operations always target the session environment prefix', async () => {
        const terminal = {
            show: sinon.stub().resolves(),
            sendCommand: sinon.stub().resolves(),
            sendText: sinon.stub().resolves(),
        };
        const condaService = {
            isCondaAvailable: sinon.stub().resolves(true),
            getCondaFile: sinon.stub().resolves('/opt/conda/bin/conda'),
        };
        const terminalFactory = { getTerminalService: sinon.stub().returns(terminal) };
        const processFactory = {
            create: sinon.stub().resolves({ exec: sinon.stub().resolves({ stdout: '{}' }) }),
        };
        const container = {
            get: sinon.stub().callsFake((key) => {
                if (key === ICondaService) {
                    return condaService;
                }
                if (key === ITerminalServiceFactory) {
                    return terminalFactory;
                }
                if (key === IProcessServiceFactory) {
                    return processFactory;
                }
                throw new Error(`Unexpected service: ${String(key)}`);
            }),
        } as unknown as IServiceContainer;
        const manager = new CondaPackageManager(
            {
                pythonPath: '/env/bin/python',
                envPath: '/env',
                envType: EnvironmentType.Conda,
            },
            container,
            createSession(),
            createLogChannel(),
        );

        await manager.installPackages([{ name: 'demo', version: '1.0' }]);
        sinon.assert.calledWithExactly(
            terminal.sendCommand,
            '/opt/conda/bin/conda',
            ['install', '--prefix', '/env', '-y', 'demo==1.0'],
            undefined,
            false,
        );
    });

    test('validates conda search output', () => {
        expect(parseCondaSearchResult('{"demo":[{"version":"2.0","timestamp":2}]}')).to.deep.equal({
            demo: [{ version: '2.0', timestamp: 2 }],
        });
        expect(() => parseCondaSearchResult('[]')).to.throw('object');
        expect(() => parseCondaSearchResult('{"demo":[{"version":2}]}')).to.throw('version and timestamp');
    });

    test('PyPI search ranks prefix matches and filters yanked or incompatible files', async () => {
        const fetchStub = sinon.stub(globalThis, 'fetch');
        fetchStub.onFirstCall().resolves({
            ok: true,
            status: 200,
            json: async () => ({
                projects: [{ name: 'other-demo' }, { name: 'demo-tools' }, { name: 'demo' }],
            }),
        } as unknown as Response);
        fetchStub.onSecondCall().resolves({
            ok: true,
            status: 200,
            json: async () => ({
                versions: ['1.0', '2.0', '3.0'],
                files: [
                    { filename: 'demo-1.0.tar.gz', 'requires-python': '>=99' },
                    { filename: 'demo-2.0.tar.gz', yanked: 'broken' },
                    { filename: 'demo-3.0.tar.gz' },
                ],
            }),
        } as unknown as Response);

        expect((await searchPyPI('demo')).map((pkg) => pkg.name)).to.deep.equal(['demo-tools', 'demo', 'other-demo']);
        expect(await searchPyPIVersions('demo', async () => ({ '>=99': false }))).to.deep.equal(['3.0']);
    });
});
