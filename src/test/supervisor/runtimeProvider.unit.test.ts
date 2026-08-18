import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { when } from 'ts-mockito';

import { EnvironmentType } from '../../client/pythonEnvironments/info';
import {
    isPythonRuntimeCacheable,
    PythonRuntimeProvider,
} from '../../client/supervisor/runtimeProvider';
import { MockOutputChannel } from '../mockClasses';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../constants';
import { mockedVSCodeNamespaces } from '../vscode-mock';

function createExtensionContext(): vscode.ExtensionContext {
    const extensionUri = vscode.Uri.file(EXTENSION_ROOT_DIR_FOR_TESTS);
    return ({
        extensionPath: extensionUri.fsPath,
        extensionUri,
        extension: { packageJSON: { version: '1.0.0' } },
    } as unknown) as vscode.ExtensionContext;
}

suite('Python Supervisor - Runtime Provider', () => {
    teardown(() => {
        sinon.restore();
    });

    test('changes the working directory through silent Python execution', async () => {
        const provider = new PythonRuntimeProvider({} as vscode.ExtensionContext, {} as any);
        const executeAndWait = sinon.stub().resolves();

        await provider.setWorkingDirectory(({ executeAndWait } as unknown) as any, '/tmp/a "quoted" path');

        sinon.assert.calledOnce(executeAndWait);
        const [code, options] = executeAndWait.firstCall.args;
        expect(code).to.equal(
            [
                'import os as _vscode_python_os',
                '_vscode_python_os.chdir("/tmp/a \\"quoted\\" path")',
                'del _vscode_python_os',
            ].join('\n'),
        );
        expect(options).to.deep.equal({
            mode: 'silent',
            errorBehavior: 'stop',
            attribution: { source: 'python.supervisor.setWorkingDirectory' },
        });
    });

    test('provides the Python icon for runtime quick picks and metadata', () => {
        when(mockedVSCodeNamespaces.workspace!.workspaceFolders).thenReturn([]);
        const context = createExtensionContext();
        const provider = new PythonRuntimeProvider(context, {} as any);
        const installation = {
            pythonPath: '/usr/bin/python3',
            envType: EnvironmentType.System,
            version: '3.13.0',
        };
        const expectedIconPath = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'resources', 'branding', 'python-icon.svg');

        const iconPath = provider.getRuntimeIconPath(installation) as vscode.Uri;
        expect(iconPath.toString()).to.equal(vscode.Uri.file(expectedIconPath).toString());

        const metadata = provider.createRuntimeMetadata(
            context,
            installation,
            new MockOutputChannel('python-supervisor'),
        );
        expect(metadata.extensionId).to.equal(provider.extensionId);
        expect(metadata.base64EncodedIconSvg).to.equal(fs.readFileSync(expectedIconPath).toString('base64'));
        expect(metadata.runtimeDisplayPath).to.equal(installation.pythonPath);
    });

    test('provides a home-relative runtime display path', () => {
        when(mockedVSCodeNamespaces.workspace!.workspaceFolders).thenReturn([]);
        const context = createExtensionContext();
        const provider = new PythonRuntimeProvider(context, {} as any);
        const pythonPath = path.join(os.homedir(), 'envs', 'python-3.13', 'bin', 'python');

        const metadata = provider.createRuntimeMetadata(
            context,
            {
                pythonPath,
                envType: EnvironmentType.Venv,
                version: '3.13.0',
            },
            new MockOutputChannel('python-supervisor'),
        );

        expect(metadata.runtimeDisplayPath).to.equal(path.join('~', 'envs', 'python-3.13', 'bin', 'python'));
    });

    test('waits for PET discovery before refreshing and resolving the active interpreter', async () => {
        const calls: string[] = [];
        const interpreterService = {
            triggerRefresh: sinon.stub().callsFake(async () => {
                calls.push('triggerRefresh');
            }),
            refresh: sinon.stub().callsFake(async () => {
                calls.push('refresh');
            }),
            getActiveInterpreter: sinon.stub().callsFake(async () => {
                calls.push('getActiveInterpreter');
                return { path: '/pet/python' };
            }),
        };
        const provider = new PythonRuntimeProvider(
            {} as vscode.ExtensionContext,
            (interpreterService as unknown) as any,
        );

        await provider.triggerInterpreterRefresh(new MockOutputChannel('python-supervisor'));

        expect(calls).to.deep.equal(['triggerRefresh', 'refresh', 'getActiveInterpreter']);
    });

    test('only caches system-scoped Python installations', () => {
        expect(isPythonRuntimeCacheable({
            pythonPath: '/usr/bin/python3',
            envType: EnvironmentType.System,
        }, ['/workspace'])).to.equal(true);
        expect(isPythonRuntimeCacheable({
            pythonPath: '/workspace/.venv/bin/python',
            envPath: '/workspace/.venv',
            envType: EnvironmentType.Venv,
        }, ['/workspace'])).to.equal(false);
        expect(isPythonRuntimeCacheable({
            pythonPath: '/home/user/.pyenv/shims/python',
            envType: EnvironmentType.Pyenv,
        }, ['/workspace'])).to.equal(false);
        expect(isPythonRuntimeCacheable({
            pythonPath: '/workspace/tools/python',
            envType: EnvironmentType.Unknown,
        }, ['/workspace'])).to.equal(false);
    });
});
