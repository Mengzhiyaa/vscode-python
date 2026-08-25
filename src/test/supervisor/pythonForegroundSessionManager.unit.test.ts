import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { IInterpreterHelper, IInterpreterService } from '../../client/interpreter/contracts';
import { IPythonPathUpdaterServiceManager } from '../../client/interpreter/configuration/types';
import { PythonForegroundSessionManager } from '../../client/supervisor/pythonForegroundSessionManager';
import { PythonSessionRegistry } from '../../client/supervisor/pythonSessionRegistry';
import { MockOutputChannel } from '../mockClasses';

suite('Python Supervisor - Foreground Session Manager', () => {
    function createSession(
        sessionId: string,
        sessionMode: 'console' | 'notebook',
        options: { created?: number; languageId?: string; state?: string } = {},
    ) {
        const stateEmitter = new vscode.EventEmitter<any>();
        const session = {
            sessionId,
            sessionMode,
            state: options.state ?? 'ready',
            created: options.created ?? Date.now(),
            isForeground: false,
            runtimeMetadata: {
                languageId: options.languageId ?? 'python',
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
            startDap: sinon.stub().resolves(),
            connectDap: sinon.stub().resolves(true),
            disconnectDap: sinon.stub().resolves(),
            emitLog: sinon.stub(),
            onDidChangeRuntimeState: stateEmitter.event,
            emitState: (state: string) => {
                session.state = state;
                stateEmitter.fire(state);
            },
        };
        return session;
    }

    function createContext(initialState: Record<string, string | null> = {}) {
        const state = new Map<string, string | null>(Object.entries(initialState));
        return {
            workspaceState: {
                get: (key: string) => state.get(key),
                update: async (key: string, value: string | null) => {
                    state.set(key, value);
                },
            },
        } as unknown as vscode.ExtensionContext;
    }

    function createRuntimeSessionService(activeSessions: any[] = [], foregroundSession?: any) {
        const didCreateSession = new vscode.EventEmitter<any>();
        const didDeleteRuntimeSession = new vscode.EventEmitter<string>();
        const didChangeForegroundSession = new vscode.EventEmitter<any>();
        return {
            activeSessions,
            foregroundSession,
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

    test('activates only the foreground console session services', async () => {
        const consoleA = createSession('console-a', 'console');
        const consoleB = createSession('console-b', 'console');
        const runtimeSessionService = createRuntimeSessionService();
        const manager = new PythonForegroundSessionManager(
            createContext(),
            runtimeSessionService as any,
            new PythonSessionRegistry(),
            { updatePythonPath: sinon.stub().resolves() } as unknown as IPythonPathUpdaterServiceManager,
            {
                getActiveWorkspaceUri: () => ({
                    folderUri: vscode.Uri.file('/workspace'),
                    configTarget: vscode.ConfigurationTarget.Workspace,
                }),
            } as unknown as IInterpreterHelper,
            {
                getActiveInterpreter: sinon.stub().resolves(undefined),
            } as unknown as IInterpreterService,
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
        sinon.assert.calledOnce(consoleB.deactivateLsp);
        sinon.assert.calledOnceWithExactly(consoleA.startDap, 'apk_dap', 'apk', 'APK Positron Python');
        sinon.assert.calledOnce(consoleA.connectDap);
        sinon.assert.calledOnce(consoleA.disconnectDap);
        sinon.assert.calledOnceWithExactly(consoleB.startDap, 'apk_dap', 'apk', 'APK Positron Python');
        sinon.assert.calledOnce(consoleB.connectDap);
        sinon.assert.notCalled(consoleB.disconnectDap);
        sinon.assert.calledWithExactly(
            consoleA.emitLog,
            'Activating LSP. Reason: foreground session changed',
            vscode.LogLevel.Debug,
        );
        sinon.assert.calledWithExactly(
            consoleA.emitLog,
            'Deactivating LSP. Reason: foreground session changed',
            vscode.LogLevel.Debug,
        );
        manager.dispose();
    });

    test('falls back to the Python language channel for an older Supervisor session', async () => {
        const consoleSession = createSession('legacy-console', 'console');
        (consoleSession as { emitLog?: sinon.SinonStub }).emitLog = undefined;
        const runtimeSessionService = createRuntimeSessionService();
        const logChannel = new MockOutputChannel('python');
        const manager = new PythonForegroundSessionManager(
            createContext(),
            runtimeSessionService as any,
            new PythonSessionRegistry(),
            { updatePythonPath: sinon.stub().resolves() } as unknown as IPythonPathUpdaterServiceManager,
            { getActiveWorkspaceUri: () => undefined } as unknown as IInterpreterHelper,
            { getActiveInterpreter: sinon.stub().resolves(undefined) } as unknown as IInterpreterService,
            logChannel,
        );

        runtimeSessionService.emitCreateSession(consoleSession);
        runtimeSessionService.emitForegroundSession(consoleSession);
        await flushQueue();

        expect(logChannel.output).to.contain(
            '[Python Supervisor] [session=legacy-console] Activating LSP. Reason: foreground session changed',
        );
        manager.dispose();
    });

    test('does not start or connect DAP when it is disabled', async () => {
        const consoleSession = createSession('console-a', 'console');
        const runtimeSessionService = createRuntimeSessionService();
        const manager = new PythonForegroundSessionManager(
            createContext(),
            runtimeSessionService as any,
            new PythonSessionRegistry(),
            { updatePythonPath: sinon.stub().resolves() } as unknown as IPythonPathUpdaterServiceManager,
            { getActiveWorkspaceUri: () => undefined } as unknown as IInterpreterHelper,
            { getActiveInterpreter: sinon.stub().resolves(undefined) } as unknown as IInterpreterService,
            new MockOutputChannel('python-supervisor'),
            false,
        );

        runtimeSessionService.emitCreateSession(consoleSession);
        runtimeSessionService.emitForegroundSession(consoleSession);
        await flushQueue();

        sinon.assert.notCalled(consoleSession.startDap);
        sinon.assert.notCalled(consoleSession.connectDap);
        sinon.assert.calledOnce(consoleSession.activateLsp);
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
            { updatePythonPath: sinon.stub().resolves() } as unknown as IPythonPathUpdaterServiceManager,
            {
                getActiveWorkspaceUri: () => ({
                    folderUri: vscode.Uri.file('/workspace'),
                    configTarget: vscode.ConfigurationTarget.Workspace,
                }),
            } as unknown as IInterpreterHelper,
            {
                getActiveInterpreter: sinon.stub().resolves(undefined),
            } as unknown as IInterpreterService,
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
        sinon.assert.notCalled(notebookSession.startDap);
        sinon.assert.notCalled(notebookSession.connectDap);
        manager.dispose();
    });

    test('starts DAP for a ready background console without connecting it', async () => {
        const foregroundSession = createSession('console-a', 'console');
        const backgroundSession = createSession('console-b', 'console', { state: 'uninitialized' });
        const runtimeSessionService = createRuntimeSessionService();
        const manager = new PythonForegroundSessionManager(
            createContext({ 'pythonSupervisor.lastForegroundSessionId': foregroundSession.sessionId }),
            runtimeSessionService as any,
            new PythonSessionRegistry(),
            { updatePythonPath: sinon.stub().resolves() } as unknown as IPythonPathUpdaterServiceManager,
            { getActiveWorkspaceUri: () => undefined } as unknown as IInterpreterHelper,
            { getActiveInterpreter: sinon.stub().resolves(undefined) } as unknown as IInterpreterService,
            new MockOutputChannel('python-supervisor'),
        );

        runtimeSessionService.emitCreateSession(foregroundSession);
        runtimeSessionService.emitCreateSession(backgroundSession);
        backgroundSession.emitState('ready');
        await flushQueue();

        sinon.assert.calledOnceWithExactly(backgroundSession.startDap, 'apk_dap', 'apk', 'APK Positron Python');
        sinon.assert.notCalled(backgroundSession.connectDap);
        sinon.assert.notCalled(backgroundSession.activateLsp);
        manager.dispose();
    });

    test('does not deactivate the Python console LSP when another language becomes foreground', async () => {
        const pythonSession = createSession('python-console', 'console');
        const rSession = createSession('r-console', 'console', { languageId: 'r' });
        const runtimeSessionService = createRuntimeSessionService();
        const manager = new PythonForegroundSessionManager(
            createContext(),
            runtimeSessionService as any,
            new PythonSessionRegistry(),
            { updatePythonPath: sinon.stub().resolves() } as unknown as IPythonPathUpdaterServiceManager,
            { getActiveWorkspaceUri: () => undefined } as unknown as IInterpreterHelper,
            { getActiveInterpreter: sinon.stub().resolves(undefined) } as unknown as IInterpreterService,
            new MockOutputChannel('python-supervisor'),
        );

        runtimeSessionService.emitCreateSession(pythonSession);
        runtimeSessionService.emitCreateSession(rSession);
        runtimeSessionService.emitForegroundSession(pythonSession);
        await flushQueue();
        pythonSession.deactivateLsp.resetHistory();

        runtimeSessionService.emitForegroundSession(rSession);
        await flushQueue();

        sinon.assert.notCalled(pythonSession.deactivateLsp);
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
            { updatePythonPath } as unknown as IPythonPathUpdaterServiceManager,
            {
                getActiveWorkspaceUri: () => ({
                    folderUri: vscode.Uri.file('/workspace'),
                    configTarget: vscode.ConfigurationTarget.Workspace,
                }),
            } as unknown as IInterpreterHelper,
            {
                getActiveInterpreter: sinon.stub().resolves({ path: '/tmp/other/python' }),
            } as unknown as IInterpreterService,
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

    test('reconciles a foreground console restored before the manager starts', async () => {
        const consoleSession = createSession('restored-console', 'console', { created: 10 });
        const runtimeSessionService = createRuntimeSessionService([consoleSession], consoleSession);
        const context = createContext({
            'pythonSupervisor.lastForegroundSessionId': 'stale-console',
        });
        const manager = new PythonForegroundSessionManager(
            context,
            runtimeSessionService as any,
            new PythonSessionRegistry(),
            { updatePythonPath: sinon.stub().resolves() } as unknown as IPythonPathUpdaterServiceManager,
            {
                getActiveWorkspaceUri: () => ({
                    folderUri: vscode.Uri.file('/workspace'),
                    configTarget: vscode.ConfigurationTarget.Workspace,
                }),
            } as unknown as IInterpreterHelper,
            {
                getActiveInterpreter: sinon.stub().resolves(undefined),
            } as unknown as IInterpreterService,
            new MockOutputChannel('python-supervisor'),
        );

        await flushQueue();

        sinon.assert.calledOnce(consoleSession.activateLsp);
        expect(context.workspaceState.get('pythonSupervisor.lastForegroundSessionId')).to.equal(
            consoleSession.sessionId,
        );
        manager.dispose();
    });

    test('falls back to the newest live console when the restored foreground event was missed', async () => {
        const olderSession = createSession('older-console', 'console', { created: 5 });
        const newestSession = createSession('newest-console', 'console', { created: 15, state: 'idle' });
        const exitedSession = createSession('exited-console', 'console', { created: 20, state: 'exited' });
        const runtimeSessionService = createRuntimeSessionService([olderSession, newestSession, exitedSession]);
        const context = createContext();
        const manager = new PythonForegroundSessionManager(
            context,
            runtimeSessionService as any,
            new PythonSessionRegistry(),
            { updatePythonPath: sinon.stub().resolves() } as unknown as IPythonPathUpdaterServiceManager,
            {
                getActiveWorkspaceUri: () => ({
                    folderUri: vscode.Uri.file('/workspace'),
                    configTarget: vscode.ConfigurationTarget.Workspace,
                }),
            } as unknown as IInterpreterHelper,
            {
                getActiveInterpreter: sinon.stub().resolves(undefined),
            } as unknown as IInterpreterService,
            new MockOutputChannel('python-supervisor'),
        );

        await flushQueue();

        sinon.assert.notCalled(olderSession.activateLsp);
        sinon.assert.calledOnce(newestSession.activateLsp);
        sinon.assert.notCalled(exitedSession.activateLsp);
        expect(context.workspaceState.get('pythonSupervisor.lastForegroundSessionId')).to.equal(
            newestSession.sessionId,
        );
        manager.dispose();
    });

    test('disables DAP auto-attach after Supervisor declines the connection', async () => {
        const consoleSession = createSession('console-a', 'console');
        consoleSession.connectDap.resolves(false);
        const runtimeSessionService = createRuntimeSessionService();
        const manager = new PythonForegroundSessionManager(
            createContext(),
            runtimeSessionService as any,
            new PythonSessionRegistry(),
            { updatePythonPath: sinon.stub().resolves() } as unknown as IPythonPathUpdaterServiceManager,
            { getActiveWorkspaceUri: () => undefined } as unknown as IInterpreterHelper,
            { getActiveInterpreter: sinon.stub().resolves(undefined) } as unknown as IInterpreterService,
            new MockOutputChannel('python-supervisor'),
        );

        runtimeSessionService.emitCreateSession(consoleSession);
        runtimeSessionService.emitForegroundSession(consoleSession);
        await flushQueue();
        consoleSession.emitState('ready');
        await flushQueue();

        sinon.assert.calledOnce(consoleSession.startDap);
        sinon.assert.calledOnce(consoleSession.connectDap);
        manager.dispose();
    });

    test('DAP startup failure does not prevent LSP activation', async () => {
        const consoleSession = createSession('console-a', 'console');
        consoleSession.startDap.rejects(new Error('missing apk_dap target'));
        const runtimeSessionService = createRuntimeSessionService();
        const manager = new PythonForegroundSessionManager(
            createContext(),
            runtimeSessionService as any,
            new PythonSessionRegistry(),
            { updatePythonPath: sinon.stub().resolves() } as unknown as IPythonPathUpdaterServiceManager,
            { getActiveWorkspaceUri: () => undefined } as unknown as IInterpreterHelper,
            { getActiveInterpreter: sinon.stub().resolves(undefined) } as unknown as IInterpreterService,
            new MockOutputChannel('python-supervisor'),
        );

        runtimeSessionService.emitCreateSession(consoleSession);
        runtimeSessionService.emitForegroundSession(consoleSession);
        await flushQueue();

        sinon.assert.calledOnce(consoleSession.startDap);
        sinon.assert.notCalled(consoleSession.connectDap);
        sinon.assert.calledOnce(consoleSession.activateLsp);
        manager.dispose();
    });

    test('disconnects DAP and resets its state when a console session exits', async () => {
        const consoleSession = createSession('console-a', 'console');
        const runtimeSessionService = createRuntimeSessionService();
        const manager = new PythonForegroundSessionManager(
            createContext(),
            runtimeSessionService as any,
            new PythonSessionRegistry(),
            { updatePythonPath: sinon.stub().resolves() } as unknown as IPythonPathUpdaterServiceManager,
            { getActiveWorkspaceUri: () => undefined } as unknown as IInterpreterHelper,
            { getActiveInterpreter: sinon.stub().resolves(undefined) } as unknown as IInterpreterService,
            new MockOutputChannel('python-supervisor'),
        );

        runtimeSessionService.emitCreateSession(consoleSession);
        runtimeSessionService.emitForegroundSession(consoleSession);
        await flushQueue();
        consoleSession.emitState('exited');
        await flushQueue();
        consoleSession.emitState('ready');
        await flushQueue();

        sinon.assert.calledTwice(consoleSession.startDap);
        sinon.assert.calledTwice(consoleSession.connectDap);
        sinon.assert.calledOnce(consoleSession.disconnectDap);
        manager.dispose();
    });
});
