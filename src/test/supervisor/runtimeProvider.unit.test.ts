import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { EnvironmentType } from '../../client/pythonEnvironments/info';
import {
    isPythonRuntimeCacheable,
    PythonRuntimeProvider,
} from '../../client/supervisor/runtimeProvider';
import { MockOutputChannel } from '../mockClasses';

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
