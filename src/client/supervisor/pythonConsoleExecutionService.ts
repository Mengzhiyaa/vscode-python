import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { PYTHON_LANGUAGE_ID } from './runtimeProvider';
import { PythonConsoleRuntimeRouter } from './pythonConsoleRuntimeRouter';
import type { IPositronConsoleService } from './types/supervisor-api';
import { UnsavedScriptFiles } from './unsavedScriptFiles';

const NO_RUNTIME_MESSAGE = 'No Python interpreter is available for the Supervisor console.';

export class PythonConsoleExecutionService implements vscode.Disposable {
    constructor(
        private readonly _runtimeRouter: PythonConsoleRuntimeRouter,
        private readonly _positronConsoleService: IPositronConsoleService,
        private readonly _unsavedScripts = new UnsavedScriptFiles(),
    ) {}

    async executeFile(source: string, resource?: vscode.Uri): Promise<void> {
        const document = resource
            ? await vscode.workspace.openTextDocument(resource)
            : vscode.window.activeTextEditor?.document;
        if (!document) {
            return;
        }
        if (!document.isUntitled && document.isDirty && !(await document.save())) {
            return;
        }

        let scratchFile: string | undefined;
        let submitted = false;
        try {
            scratchFile = document.isUntitled ? await this._unsavedScripts.write(document) : undefined;
            const fileToExecute = scratchFile ? vscode.Uri.file(scratchFile) : document.uri;
            const liveSession = this._runtimeRouter.getLiveConsoleSession();
            const target = liveSession
                ? { sessionId: liveSession.sessionId, session: liveSession }
                : await this._runtimeRouter.ensureConsoleSession(source, document.uri, false);
            if (!target) {
                void vscode.window.showWarningMessage(NO_RUNTIME_MESSAGE);
                return;
            }

            const executionId = scratchFile ? randomUUID() : undefined;
            if (scratchFile && executionId) {
                if (!target.session) {
                    throw new Error('The Python console session is unavailable for unsaved script execution.');
                }
                this._unsavedScripts.watchExecution(scratchFile, target.session, executionId);
            }
            await this._positronConsoleService.executeCode(
                PYTHON_LANGUAGE_ID,
                target.sessionId || target.session?.sessionId,
                this.createRunFileCode(fileToExecute),
                { source, fileUri: document.uri, lineNumber: 1, metadata: { executionTarget: 'file' } },
                false,
                true,
                undefined,
                undefined,
                executionId,
                document.uri,
                { executionTarget: 'file' },
            );
            submitted = true;
        } finally {
            if (scratchFile && !submitted) {
                await this._unsavedScripts.finished(scratchFile);
            }
        }
    }

    dispose(): void {
        this._unsavedScripts.dispose();
    }

    async executeSelectionCommand(source: string, command: string, resource?: vscode.Uri): Promise<void> {
        // Match Ark/R editor execution semantics: once a Python console is live,
        // follow the current foreground console session instead of re-selecting a
        // runtime from the editor's active interpreter before every Ctrl+Enter.
        if (!this._runtimeRouter.getLiveConsoleSession()) {
            const target = await this._runtimeRouter.ensureConsoleSession(source, resource, false);
            if (!target) {
                void vscode.window.showWarningMessage(NO_RUNTIME_MESSAGE);
                return;
            }
        }

        // A statement-range provider can return a complete compound statement
        // (for example, a Python `for` block) whose editor range does not carry
        // the extra blank line expected by the interactive runtime's
        // `is_complete` check. Match Positron's console execution semantics and
        // let the console submit the provider-selected fragment as-is.
        await vscode.commands.executeCommand(command, { allowIncomplete: true });
    }

    private createRunFileCode(file: vscode.Uri): string {
        // APK owns %run's namespace, import path and argv handling. -G keeps
        // literal paths containing glob characters; -- ends option parsing.
        const filePath = process.platform === 'win32' ? file.fsPath.replace(/\\/g, '/') : file.fsPath;
        const quotedPath = process.platform === 'win32'
            ? `"${filePath}"`
            : `'${filePath.replace(/'/g, "'\\''")}'`;
        return `%run -G -- ${quotedPath}`;
    }
}
