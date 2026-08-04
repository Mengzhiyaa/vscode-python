import * as path from 'path';
import { runTests } from '@vscode/test-electron';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from './constants';
import { initializeLogger } from './testLogger';
import { getSupervisorExtensionDevelopmentPath } from './utils/supervisor';
import { getChannel } from './utils/vscode';

const workspacePath = path.join(__dirname, '..', '..', 'src', 'testMultiRootWkspc', 'multi.code-workspace');
process.env.IS_CI_SERVER_TEST_DEBUGGER = '';
process.env.VSC_PYTHON_CI_TEST = '1';

initializeLogger();

function getExtensionDevelopmentPath(): string[] {
    return [EXTENSION_ROOT_DIR_FOR_TESTS, getSupervisorExtensionDevelopmentPath()];
}

async function start() {
    console.log('*'.repeat(100));
    console.log('Start Multiroot tests');
    const { downloadAndUnzipVSCode } = await import('@vscode/test-electron');
    const channel = getChannel();
    const vscodeExecutablePath = await downloadAndUnzipVSCode(channel);
    runTests({
        vscodeExecutablePath,
        extensionDevelopmentPath: getExtensionDevelopmentPath(),
        extensionTestsPath: path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'out', 'test', 'index'),
        launchArgs: [workspacePath],
        version: channel,
        extensionTestsEnv: { ...process.env, UITEST_DISABLE_INSIDERS: '1' },
    }).catch((ex) => {
        console.error('End Multiroot tests (with errors)', ex);
        process.exit(1);
    });
}
start();
