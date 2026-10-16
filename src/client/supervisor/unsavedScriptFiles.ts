import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { traceWarn } from '../logging';
import type { ILanguageRuntimeSession } from './types/supervisor-api';

/** Keeps each untitled run's snapshot alive until its own execution finishes. */
export class UnsavedScriptFiles implements vscode.Disposable {
    private readonly _files = new Map<string, vscode.Disposable[]>();
    private _disposed = false;

    async write(document: vscode.TextDocument): Promise<string> {
        const source = document.getText();
        const base = path.basename(document.uri.path).replace(/[^\w.-]/g, '_').toLowerCase();
        const name = `.supervisor-${base}-${randomUUID()}.py`;
        const workspaceRoot = vscode.workspace.workspaceFolders?.find((folder) => folder.uri.scheme === 'file')?.uri.fsPath;
        let filePath = path.join(workspaceRoot ?? os.tmpdir(), name);
        try {
            await fs.promises.writeFile(filePath, source, 'utf8');
        } catch (error) {
            if (!workspaceRoot) {
                throw error;
            }
            filePath = path.join(os.tmpdir(), name);
            await fs.promises.writeFile(filePath, source, 'utf8');
        }
        if (this._disposed) {
            await this.deleteFile(filePath);
            throw new Error('Python console execution has been disposed.');
        }
        this._files.set(filePath, []);
        return filePath;
    }

    watchExecution(filePath: string, session: ILanguageRuntimeSession, executionId: string): void {
        const disposables = this._files.get(filePath);
        if (!disposables) {
            return;
        }
        // executeCode() resolves after enqueueing, not after execution. A queued
        // run must retain its file even if its editor closes or another run starts.
        disposables.push(
            session.onDidReceiveRuntimeMessageState((message) => {
                if (message.parent_id === executionId && String(message.state) === 'idle') {
                    void this.finished(filePath);
                }
            }),
            session.onDidEndSession(() => { void this.finished(filePath); }),
        );
        // Queued work discarded by an interrupt will never emit its own Idle.
        // Keep this optional for compatibility with older Supervisor hosts.
        const cancelled = session.onDidCancelExecution?.((id) => {
            if (id === executionId) { void this.finished(filePath); }
        });
        if (cancelled) { disposables.push(cancelled); }
    }

    async finished(filePath: string): Promise<void> {
        const disposables = this._files.get(filePath);
        if (!disposables) {
            return;
        }
        this._files.delete(filePath);
        disposables.forEach((disposable) => disposable.dispose());
        await this.deleteFile(filePath);
    }

    dispose(): void {
        this._disposed = true;
        for (const filePath of this._files.keys()) {
            void this.finished(filePath);
        }
    }

    private async deleteFile(filePath: string): Promise<void> {
        try {
            await fs.promises.rm(filePath, { force: true });
        } catch (error) {
            traceWarn(`Cannot delete Python scratch script '${filePath}': ${error}`);
        }
    }
}
