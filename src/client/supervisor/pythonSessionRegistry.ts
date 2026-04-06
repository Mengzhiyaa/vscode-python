import * as vscode from 'vscode';
import type { ILanguageRuntimeSession } from './types/supervisor-api';
import { PYTHON_LANGUAGE_ID } from './runtimeProvider';

interface PythonSessionEntry {
    session: ILanguageRuntimeSession;
    disposables: vscode.Disposable[];
}

export class PythonSessionRegistry implements vscode.Disposable {
    private readonly _sessions = new Map<string, PythonSessionEntry>();

    addSession(session: ILanguageRuntimeSession): boolean {
        if (!this.isPythonSession(session) || this._sessions.has(session.sessionId)) {
            return false;
        }

        this._sessions.set(session.sessionId, {
            session,
            disposables: [],
        });
        return true;
    }

    get(sessionId: string): ILanguageRuntimeSession | undefined {
        return this._sessions.get(sessionId)?.session;
    }

    getAll(): ILanguageRuntimeSession[] {
        return Array.from(this._sessions.values()).map((entry) => entry.session);
    }

    getConsoleSessions(): ILanguageRuntimeSession[] {
        return this.getAll().filter((session) => session.metadata.sessionMode === 'console');
    }

    getNotebookSessions(): ILanguageRuntimeSession[] {
        return this.getAll().filter((session) => session.metadata.sessionMode === 'notebook');
    }

    getForegroundConsole(): ILanguageRuntimeSession | undefined {
        return this.getConsoleSessions().find((session) => session.isForeground);
    }

    registerDisposable(sessionId: string, disposable: vscode.Disposable): void {
        const entry = this._sessions.get(sessionId);
        if (!entry) {
            disposable.dispose();
            return;
        }

        entry.disposables.push(disposable);
    }

    deleteSession(sessionId: string): void {
        const entry = this._sessions.get(sessionId);
        if (!entry) {
            return;
        }

        entry.disposables.forEach((disposable) => disposable.dispose());
        this._sessions.delete(sessionId);
    }

    dispose(): void {
        Array.from(this._sessions.keys()).forEach((sessionId) => this.deleteSession(sessionId));
    }

    private isPythonSession(session: ILanguageRuntimeSession): boolean {
        return session.runtimeMetadata.languageId === PYTHON_LANGUAGE_ID;
    }
}
