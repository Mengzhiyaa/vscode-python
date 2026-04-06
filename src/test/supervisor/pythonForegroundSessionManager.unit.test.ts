import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { IInterpreterHelper, IInterpreterService } from '../../client/interpreter/contracts';
import { IPythonPathUpdaterServiceManager } from '../../client/interpreter/configuration/types';
import { PythonForegroundSessionManager } from '../../client/supervisor/pythonForegroundSessionManager';
import { PythonSessionRegistry } from '../../client/supervisor/pythonSessionRegistry';
import { MockOutputChannel } from '../mockClasses';

suite('Python Supervisor - Foreground Session Manager', () => {
    function createSession(sessionId: string, sessionMode: 'console' | 'notebook') {
        const stateEmitter = new vscode.EventEmitter<any>();
        return {
            sessionId,
            sessionMode,
            state: 'ready',
            isForeground: false,
            runtimeMetadata: {
                languageId: 'python',
                runtimePath: `/tmp/${sessionId}/python`,
            },
            metadata: {
                sessionId,
                sessionMode,
                createdTimestamp: Date.now(),
                sessionName: sessionId,
                startReason: 'test',
            },
            activateLsp: sinon.stub().resolves(),
            deactivateLsp: sinon.stub().resolves(),
            onDidChangeRuntimeState: stateEmitter.event,
            emitState: (state: string) => stateEmitter.fire(state),
        };
    }

    function createContext() {
        const state = new Map<string, string | null>();
        return ({
            workspaceState: {
                get: (key: string) => state.get(key),
                update: async (key: string, value: string | null) => {
                    state.set(key, value);
                },
            },
        } as unknown) as vscode.ExtensionContext;
    }

    function createRuntimeSessionService(activeSessions: any[] = []) {
        const didCreateSession = new vscode.EventEmitter<any>();
        const didDeleteRuntimeSession = new vscode.EventEmitter<string>();
        const didChangeForegroundSession = new vscode.EventEmitter<any>();
        return {
            activeSessions,
            onDidCreateSession: didCreateSession.event,
            onDidDeleteRuntimeSession: didDeleteRuntimeSession.event,
            onDidChangeForegroundSession: didChangeForegroundSession.event,
            emitCreateSession: (session: any) => didCreateSession.fire(session),
            emitDeleteRuntimeSession: (sessionId: string) => didDeleteRuntimeSession.fire(sessionId),
            emitForegroundSession: (session: any) => didChangeForegroundSession.fire(session),
        };
    }

    async function flushQueue() {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    teardown(() => {
        sinon.restore();
    });

    test('activates only the foreground console session LSP', async () => {
        const consoleA = createSession('console-a', 'console');
        const consoleB = createSession('console-b', 'console');
        const runtimeSessionService = createRuntimeSessionService();
        const manager = new PythonForegroundSessionManager(
            createContext(),
            runtimeSessionService as any,
            new PythonSessionRegistry(),
            ({ updatePythonPath: sinon.stub().resolves() } as unknown) as IPythonPathUpdaterServiceManager,
            ({
                getActiveWorkspaceUri: () => ({
                    folderUri: vscode.Uri.file('/workspace'),
                    configTarget: vscode.ConfigurationTarget.Workspace,
                }),
            } as unknown) as IInterpreterHelper,
            ({
                getActiveInterpreter: sinon.stub().resolves(undefined),
            } as unknown) as IInterpreterService,
            new MockOutputChannel('python-supervisor'),
        );

        runtimeSessionService.emitCreateSession(consoleA);
        runtimeSessionService.emitCreateSession(consoleB);
        runtimeSessionService.emitForegroundSession(consoleA);
        await flushQueue();
        runtimeSessionService.emitForegroundSession(consoleB);
        await flushQueue();

        sinon.assert.calledOnce(consoleA.activateLsp);
        sinon.assert.calledOnce(consoleA.deactivateLsp);
        sinon.assert.calledOnce(consoleB.activateLsp);
        sinon.assert.notCalled(consoleB.deactivateLsp);
        manager.dispose();
    });

    test('activates notebook session LSP without deactivating the foreground console LSP', async () => {
        const consoleSession = createSession('console-a', 'console');
        const notebookSession = createSession('notebook-a', 'notebook');
        const runtimeSessionService = createRuntimeSessionService();
        const manager = new PythonForegroundSessionManager(
            createContext(),
            runtimeSessionService as any,
            new PythonSessionRegistry(),
            ({ updatePythonPath: sinon.stub().resolves() } as unknown) as IPythonPathUpdaterServiceManager,
            ({
                getActiveWorkspaceUri: () => ({
                    folderUri: vscode.Uri.file('/workspace'),
                    configTarget: vscode.ConfigurationTarget.Workspace,
                }),
            } as unknown) as IInterpreterHelper,
            ({
                getActiveInterpreter: sinon.stub().resolves(undefined),
            } as unknown) as IInterpreterService,
            new MockOutputChannel('python-supervisor'),
        );

        runtimeSessionService.emitCreateSession(consoleSession);
        runtimeSessionService.emitCreateSession(notebookSession);
        runtimeSessionService.emitForegroundSession(consoleSession);
        await flushQueue();

        notebookSession.emitState('ready');
        await flushQueue();

        sinon.assert.calledOnce(consoleSession.activateLsp);
        sinon.assert.notCalled(consoleSession.deactivateLsp);
        sinon.assert.calledOnce(notebookSession.activateLsp);
        manager.dispose();
    });

    test('updates the Python path when the foreground console interpreter changes', async () => {
        const consoleSession = createSession('console-a', 'console');
        const runtimeSessionService = createRuntimeSessionService();
        const updatePythonPath = sinon.stub().resolves();
        const manager = new PythonForegroundSessionManager(
            createContext(),
            runtimeSessionService as any,
            new PythonSessionRegistry(),
            ({ updatePythonPath } as unknown) as IPythonPathUpdaterServiceManager,
            ({
                getActiveWorkspaceUri: () => ({
                    folderUri: vscode.Uri.file('/workspace'),
                    configTarget: vscode.ConfigurationTarget.Workspace,
                }),
            } as unknown) as IInterpreterHelper,
            ({
                getActiveInterpreter: sinon.stub().resolves({ path: '/tmp/other/python' }),
            } as unknown) as IInterpreterService,
            new MockOutputChannel('python-supervisor'),
        );

        runtimeSessionService.emitCreateSession(consoleSession);
        runtimeSessionService.emitForegroundSession(consoleSession);
        await flushQueue();

        sinon.assert.calledOnceWithExactly(
            updatePythonPath,
            consoleSession.runtimeMetadata.runtimePath,
            vscode.ConfigurationTarget.Workspace,
            'load',
            vscode.Uri.file('/workspace'),
        );
        manager.dispose();
    });
});
