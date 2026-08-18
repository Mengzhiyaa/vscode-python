import * as vscode from 'vscode';
import { PYTHON_LANGUAGE } from '../common/constants';
import { IDisposableRegistry } from '../common/types';

export const PYTHON_TRIGGER_SUGGEST_ON_TAB_COMMAND = 'python.triggerSuggestOnTab';
export const PYTHON_IN_TAB_SUGGEST_CONTEXT = 'python.inTabSuggestContext';

/**
 * Match Positron's tab-suggest context: Tab triggers suggestions only when
 * there is no selection and the current line contains non-whitespace text
 * before the cursor.
 */
export function isInPythonTabSuggestContext(editor: vscode.TextEditor | undefined): boolean {
    if (!editor || editor.document.languageId !== PYTHON_LANGUAGE || !editor.selection.isEmpty) {
        return false;
    }

    const position = editor.selection.active;
    const leadingText = editor.document.lineAt(position.line).text.substring(0, position.character);
    return leadingText.trim().length > 0;
}

export function registerPythonTabSuggest(disposables: IDisposableRegistry): void {
    const updateContext = (editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor) => {
        void vscode.commands.executeCommand(
            'setContext',
            PYTHON_IN_TAB_SUGGEST_CONTEXT,
            isInPythonTabSuggestContext(editor),
        );
    };

    disposables.push(
        vscode.commands.registerCommand(PYTHON_TRIGGER_SUGGEST_ON_TAB_COMMAND, () =>
            vscode.commands.executeCommand('editor.action.triggerSuggest'),
        ),
        vscode.window.onDidChangeActiveTextEditor(editor => updateContext(editor)),
        vscode.window.onDidChangeTextEditorSelection(event => {
            if (event.textEditor === vscode.window.activeTextEditor) {
                updateContext(event.textEditor);
            }
        }),
        new vscode.Disposable(() => {
            void vscode.commands.executeCommand('setContext', PYTHON_IN_TAB_SUGGEST_CONTEXT, false);
        }),
    );

    updateContext();
}
