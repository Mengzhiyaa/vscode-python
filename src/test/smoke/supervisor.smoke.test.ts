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
const STAGE_TIMEOUT = 30_000;
const CONDITION_TIMEOUT = 25_000;
// Keep Mocha's watchdog above the combined stage budgets so the stage that
// stalls can report its own failure and finish cleanup first.
const TEST_TIMEOUT = 12 * STAGE_TIMEOUT;
type SmokeStage<T> = (token: vscode.CancellationToken) => PromiseLike<T>;

function isIdle(session: ILanguageRuntimeSession): boolean {
    return session.state === 'idle' || session.state === 'ready';
}

async function executeAndCollectOutput(
    session: ILanguageRuntimeSession,
    code: string,
    token: vscode.CancellationToken,
): Promise<string> {
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
        await session.executeAndWait(code, { attribution: { source: 'python.supervisor.smokeTest' } }, token);
    } finally {
        disposables.forEach((disposable) => disposable.dispose());
    }

    return output.join('');
}

suite('Smoke Test: Python Supervisor integration', function () {
    // A Mocha timeout does not cancel the pending runtime operation. Retrying
    // would overlap startup or execution with the next attempt.
    this.retries(0);
    let supervisorApi: ISupervisorFrameworkApi;

    async function runStage<T>(name: string, action: SmokeStage<T>, timeoutMs = STAGE_TIMEOUT): Promise<T> {
        console.log(`[Python Supervisor smoke] Starting: ${name}`);
        let timer: NodeJS.Timeout | undefined;
        const cancellation = new vscode.CancellationTokenSource();
        try {
            const result = await Promise.race([
                Promise.resolve().then(() => action(cancellation.token)),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => {
                        reject(new Error(`${name} timed out after ${timeoutMs}ms`));
                        cancellation.cancel();
                    }, timeoutMs);
                }),
            ]);
            console.log(`[Python Supervisor smoke] Completed: ${name}`);
            return result;
        } catch (error) {
            console.error(
                `[Python Supervisor smoke] Failed: ${name}`,
                JSON.stringify({
                    workspaceTrusted: vscode.workspace.isTrusted,
                    discoveredRuntimeCount: supervisorApi?.services.runtimeStartupService.discoveredRuntimeCount,
                    sessions: supervisorApi?.services.runtimeSessionService.sessions.map((session) => ({
                        sessionId: session.sessionId,
                        state: session.state,
                        runtimePath: session.runtimeMetadata.runtimePath,
                        languageId: session.runtimeMetadata.languageId,
                    })),
                }),
                error,
            );
            throw error;
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
            cancellation.dispose();
        }
    }

    async function startPythonConsole(): Promise<ILanguageRuntimeSession> {
        await runStage(
            'start Python console command',
            () => vscode.commands.executeCommand(START_CONSOLE_COMMAND),
            60_000,
        );
        await runStage('wait for Python console session creation', () =>
            waitForCondition(
                async () =>
                    !!supervisorApi.services.runtimeSessionService.getConsoleSessionForLanguage(PYTHON_LANGUAGE_ID),
                CONDITION_TIMEOUT,
                'Python Supervisor console session was not created',
            ),
        );
        const session = supervisorApi.services.runtimeSessionService.getConsoleSessionForLanguage(PYTHON_LANGUAGE_ID);
        assert.ok(session, 'Expected a Python Supervisor console session');
        await runStage('wait for Python console to become idle', () =>
            waitForCondition(
                async () => isIdle(session),
                CONDITION_TIMEOUT,
                'Python Supervisor console did not become idle',
            ),
        );
        return session;
    }

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

    suiteTeardown(async function () {
        this.timeout(2 * STAGE_TIMEOUT + 10_000);
        const session = supervisorApi?.services.runtimeSessionService.getConsoleSessionForLanguage(PYTHON_LANGUAGE_ID);
        if (session) {
            try {
                if (session.state === 'busy' || session.state === 'interrupting') {
                    await runStage('force quit Python console during cleanup', () =>
                        supervisorApi.services.runtimeSessionService.forceQuitSession(session.sessionId),
                    );
                }
                await runStage('delete Python console during cleanup', () =>
                    supervisorApi.services.runtimeSessionService.deleteSession(session.sessionId),
                );
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

        await runStage('discover Python runtime', () =>
            waitForCondition(
                async () => supervisorApi.services.runtimeStartupService.discoveredRuntimeCount > 0,
                CONDITION_TIMEOUT,
                'Supervisor did not discover the Python runtime contributed by vscode-python',
            ),
        );
    }).timeout(TEST_TIMEOUT);

    test('starts a real Python console and receives runtime output', async () => {
        const session = await startPythonConsole();

        assert.strictEqual(session.runtimeMetadata.languageId, PYTHON_LANGUAGE_ID);
        const marker = `SUPERVISOR_SMOKE_${crypto.randomUUID().replace(/-/g, '')}`;
        const output = await runStage('execute Python code and receive output', (token) =>
            executeAndCollectOutput(session, `print(${JSON.stringify(marker)})`, token),
        );

        assert.ok(output.includes(marker), `Expected Python runtime output to include ${marker}; received: ${output}`);
    }).timeout(TEST_TIMEOUT);

    test('interrupts, restarts, and deletes the Python console session', async () => {
        const session = await startPythonConsole();
        const states: string[] = [];
        const errors: string[] = [];
        const disposables = [
            session.onDidChangeRuntimeState((state) => {
                states.push(state);
                console.log(`[Python Supervisor smoke] Session ${session.sessionId}: ${state}`);
            }),
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
            await runStage('wait for Python console to become busy', () =>
                waitForCondition(
                    async () => session.state === 'busy',
                    CONDITION_TIMEOUT,
                    `Python Supervisor console did not become busy (states: ${states.join(', ')})`,
                ),
            );

            await runStage('interrupt Python console', () =>
                supervisorApi.services.runtimeSessionService.interruptSession(session.sessionId),
            );
            await runStage('wait for Python console to become idle after interrupt', () =>
                waitForCondition(
                    async () => isIdle(session),
                    CONDITION_TIMEOUT,
                    `Python Supervisor console did not return to idle after interrupt (states: ${states.join(', ')})`,
                ),
            );
            assert.ok(states.includes('busy'), `Expected a busy state; observed: ${states.join(', ')}`);
            assert.ok(
                errors.some((message) => message.includes('KeyboardInterrupt')),
                `Expected KeyboardInterrupt after interrupt; received: ${errors.join(', ')}`,
            );

            states.length = 0;
            await runStage('restart Python console', () =>
                supervisorApi.services.runtimeSessionService.restartSession(
                    session.sessionId,
                    'python.supervisor.smokeTest.restart',
                ),
            );
            await runStage('wait for Python console to become idle after restart', () =>
                waitForCondition(
                    async () => isIdle(session),
                    CONDITION_TIMEOUT,
                    `Python Supervisor console did not become idle after restart (states: ${states.join(', ')})`,
                ),
            );
            assert.ok(states.includes('restarting'), `Expected a restarting state; observed: ${states.join(', ')}`);

            const marker = `SUPERVISOR_RESTART_${crypto.randomUUID().replace(/-/g, '')}`;
            const output = await runStage('execute Python code after restart', (token) =>
                executeAndCollectOutput(session, `print(${JSON.stringify(marker)})`, token),
            );
            assert.ok(
                output.includes(marker),
                `Expected output after restart to include ${marker}; received: ${output}`,
            );

            const deleted = await runStage('delete Python console', () =>
                supervisorApi.services.runtimeSessionService.deleteSession(session.sessionId),
            );
            assert.strictEqual(deleted, true);
            assert.strictEqual(supervisorApi.services.runtimeSessionService.getSession(session.sessionId), undefined);
        } finally {
            disposables.forEach((disposable) => disposable.dispose());
            if (session.state === 'busy' || session.state === 'interrupting') {
                try {
                    await runStage('interrupt Python console during cleanup', () =>
                        supervisorApi.services.runtimeSessionService.interruptSession(session.sessionId),
                    );
                } catch (error) {
                    console.warn(`Failed to interrupt Python Supervisor smoke session during cleanup: ${error}`);
                }
            }
        }
    }).timeout(TEST_TIMEOUT);
});
