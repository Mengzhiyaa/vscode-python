// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { resolveCliPathFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from './constants';
import { getChannel } from './utils/vscode';

const workspacePath = path.join(__dirname, '..', '..', 'src', 'testMultiRootWkspc', 'multi.code-workspace');
process.env.IS_CI_SERVER_TEST_DEBUGGER = '1';
process.env.VSC_PYTHON_CI_TEST = '1';

/**
 * Install the vscode-supervisor extension from a local VSIX if SUPERVISOR_VSIX_PATH is set.
 */
function installSupervisorExtension(vscodeExecutablePath: string) {
    const vsixPath = process.env.SUPERVISOR_VSIX_PATH;
    if (!vsixPath) {
        console.info('Supervisor Extension VSIX not provided, skipping');
        return;
    }
    const resolvedPath = path.resolve(EXTENSION_ROOT_DIR_FOR_TESTS, vsixPath);
    console.info(`Installing Supervisor Extension from ${resolvedPath}`);
    const cliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath, os.platform());
    spawnSync(cliPath, ['--install-extension', resolvedPath, '--force'], {
        encoding: 'utf-8',
        stdio: 'inherit',
    });
}

async function start() {
    console.log('*'.repeat(100));
    console.log('Start Debugger tests');
    const { downloadAndUnzipVSCode } = await import('@vscode/test-electron');
    const channel = getChannel();
    const vscodeExecutablePath = await downloadAndUnzipVSCode(channel);
    installSupervisorExtension(vscodeExecutablePath);
    runTests({
        extensionDevelopmentPath: EXTENSION_ROOT_DIR_FOR_TESTS,
        extensionTestsPath: path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'out', 'test', 'index'),
        launchArgs: [workspacePath],
        version: channel,
        extensionTestsEnv: { ...process.env, UITEST_DISABLE_INSIDERS: '1' },
    }).catch((ex) => {
        console.error('End Debugger tests (with errors)', ex);
        process.exit(1);
    });
}
start();
