// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as assert from 'assert';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import type {
    ILanguageRuntimeSession,
    ISupervisorFrameworkApi,
    RuntimeResultMessage,
    RuntimeStreamMessage,
} from '../../client/supervisor/types/supervisor-api';
import { waitForCondition } from '../common';
import { IS_SMOKE_TEST } from '../constants';
import { closeActiveWindows, initialize } from '../initialize';

const SUPERVISOR_EXTENSION_ID = 'mengzhiya.vscode-supervisor';
const PYTHON_LANGUAGE_ID = 'python';
const START_CONSOLE_COMMAND = 'python.startSupervisorConsole';
const TEST_TIMEOUT = 3 * 60 * 1_000;

function isIdle(session: ILanguageRuntimeSession): boolean {
    return session.state === 'idle' || session.state === 'ready';
}

async function waitForPythonConsole(api: ISupervisorFrameworkApi): Promise<ILanguageRuntimeSession> {
    await waitForCondition(
        async () => !!api.services.runtimeSessionService.getConsoleSessionForLanguage(PYTHON_LANGUAGE_ID),
        TEST_TIMEOUT,
        'Python Supervisor console session was not created',
    );

    const session = api.services.runtimeSessionService.getConsoleSessionForLanguage(PYTHON_LANGUAGE_ID);
    assert.ok(session, 'Expected a Python Supervisor console session');
    await waitForCondition(
        async () => isIdle(session),
        TEST_TIMEOUT,
        `Python Supervisor console did not become idle (last state: ${session.state})`,
    );
    return session;
}

async function executeAndCollectOutput(session: ILanguageRuntimeSession, code: string): Promise<string> {
    const output: string[] = [];
    const disposables = [
        session.onDidReceiveRuntimeMessageStream((message: RuntimeStreamMessage) => output.push(message.text)),
        session.onDidReceiveRuntimeMessageResult((message: RuntimeResultMessage) => {
            const text = message.data['text/plain'];
            if (typeof text === 'string') {
                output.push(text);
            }
        }),
    ];

    try {
        await session.executeAndWait(code, {
            attribution: { source: 'python.supervisor.smokeTest' },
        });
    } finally {
        disposables.forEach((disposable) => disposable.dispose());
    }

    return output.join('');
}

suite('Smoke Test: Python Supervisor integration', () => {
    let supervisorApi: ISupervisorFrameworkApi;

    suiteSetup(async function () {
        if (!IS_SMOKE_TEST) {
            return this.skip();
        }

        await initialize();
        const extension = vscode.extensions.getExtension<ISupervisorFrameworkApi>(SUPERVISOR_EXTENSION_ID);
        assert.ok(extension, `Expected ${SUPERVISOR_EXTENSION_ID} to be installed`);
        supervisorApi = await extension.activate();
        return undefined;
    });

    suiteTeardown(async () => {
        const session = supervisorApi?.services.runtimeSessionService.getConsoleSessionForLanguage(PYTHON_LANGUAGE_ID);
        if (session) {
            try {
                if (session.state === 'busy' || session.state === 'interrupting') {
                    await supervisorApi.services.runtimeSessionService.forceQuitSession(session.sessionId);
                }
                await supervisorApi.services.runtimeSessionService.deleteSession(session.sessionId);
            } catch (error) {
                console.warn(`Failed to clean up Python Supervisor smoke session: ${error}`);
            }
        }
        await closeActiveWindows();
    });

    test('registers Python support and discovers an interpreter runtime', async () => {
        assert.strictEqual(typeof supervisorApi.version, 'string');
        assert.strictEqual(supervisorApi.apiVersion, 2);
        assert.strictEqual(supervisorApi.protocolVersion.major, 2);
        assert.strictEqual(typeof supervisorApi.languages.forExtension, 'function');

        await waitForCondition(
            async () => supervisorApi.services.runtimeStartupService.discoveredRuntimeCount > 0,
            TEST_TIMEOUT,
            'Supervisor did not discover the Python runtime contributed by vscode-python',
        );
    }).timeout(TEST_TIMEOUT);

    test('starts a real Python console and receives runtime output', async () => {
        await vscode.commands.executeCommand(START_CONSOLE_COMMAND);
        const session = await waitForPythonConsole(supervisorApi);

        assert.strictEqual(session.runtimeMetadata.languageId, PYTHON_LANGUAGE_ID);
        const marker = `SUPERVISOR_SMOKE_${crypto.randomUUID().replace(/-/g, '')}`;
        const output = await executeAndCollectOutput(session, `print(${JSON.stringify(marker)})`);

        assert.ok(output.includes(marker), `Expected Python runtime output to include ${marker}; received: ${output}`);
    }).timeout(TEST_TIMEOUT);

    test('interrupts, restarts, and deletes the Python console session', async () => {
        await vscode.commands.executeCommand(START_CONSOLE_COMMAND);
        const session = await waitForPythonConsole(supervisorApi);
        const states: string[] = [];
        const errors: string[] = [];
        const disposables = [
            session.onDidChangeRuntimeState((state) => states.push(state)),
            session.onDidReceiveRuntimeMessageError((message) => errors.push(message.message)),
        ];

        try {
            session.execute(
                'import time\nwhile True:\n    time.sleep(0.1)',
                crypto.randomUUID(),
                undefined,
                undefined,
                { source: 'python.supervisor.smokeTest.interrupt' },
            );
            await waitForCondition(
                async () => session.state === 'busy',
                TEST_TIMEOUT,
                `Python Supervisor console did not become busy (states: ${states.join(', ')})`,
            );

            await supervisorApi.services.runtimeSessionService.interruptSession(session.sessionId);
            await waitForCondition(
                async () => isIdle(session),
                TEST_TIMEOUT,
                `Python Supervisor console did not return to idle after interrupt (states: ${states.join(', ')})`,
            );
            assert.ok(states.includes('busy'), `Expected a busy state; observed: ${states.join(', ')}`);
            assert.ok(
                errors.some((message) => message.includes('KeyboardInterrupt')),
                `Expected KeyboardInterrupt after interrupt; received: ${errors.join(', ')}`,
            );

            states.length = 0;
            await supervisorApi.services.runtimeSessionService.restartSession(
                session.sessionId,
                'python.supervisor.smokeTest.restart',
            );
            await waitForCondition(
                async () => isIdle(session),
                TEST_TIMEOUT,
                `Python Supervisor console did not become idle after restart (states: ${states.join(', ')})`,
            );
            assert.ok(states.includes('restarting'), `Expected a restarting state; observed: ${states.join(', ')}`);

            const marker = `SUPERVISOR_RESTART_${crypto.randomUUID().replace(/-/g, '')}`;
            const output = await executeAndCollectOutput(session, `print(${JSON.stringify(marker)})`);
            assert.ok(output.includes(marker), `Expected output after restart to include ${marker}; received: ${output}`);

            const deleted = await supervisorApi.services.runtimeSessionService.deleteSession(session.sessionId);
            assert.strictEqual(deleted, true);
            assert.strictEqual(supervisorApi.services.runtimeSessionService.getSession(session.sessionId), undefined);
        } finally {
            disposables.forEach((disposable) => disposable.dispose());
            if (session.state === 'busy' || session.state === 'interrupting') {
                try {
                    await supervisorApi.services.runtimeSessionService.interruptSession(session.sessionId);
                } catch (error) {
                    console.warn(`Failed to interrupt Python Supervisor smoke session during cleanup: ${error}`);
                }
            }
        }
    }).timeout(TEST_TIMEOUT);
});
