import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { PythonRuntimeProvider } from '../../client/supervisor/runtimeProvider';

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
});
