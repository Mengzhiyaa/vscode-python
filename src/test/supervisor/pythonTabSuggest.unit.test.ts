import { expect } from 'chai';
import * as vscode from 'vscode';
import { isInPythonTabSuggestContext } from '../../client/supervisor/pythonTabSuggest';

function createEditor(
    line: string,
    character: number,
    options: { languageId?: string; hasSelection?: boolean } = {},
): vscode.TextEditor {
    const position = new vscode.Position(0, character);
    const selection = options.hasSelection
        ? new vscode.Selection(new vscode.Position(0, 0), position)
        : new vscode.Selection(position, position);

    return {
        document: {
            languageId: options.languageId ?? 'python',
            lineAt: () => ({ text: line }),
        },
        selection,
    } as unknown as vscode.TextEditor;
}

suite('Python Tab Suggest', () => {
    test('matches Positron context for code after indentation', () => {
        expect(isInPythonTabSuggestContext(createEditor('    pri', 7))).to.equal(true);
        expect(isInPythonTabSuggestContext(createEditor('    ', 4))).to.equal(false);
    });

    test('does not take Tab from selections or non-Python editors', () => {
        expect(isInPythonTabSuggestContext(createEditor('print', 5, { hasSelection: true }))).to.equal(false);
        expect(isInPythonTabSuggestContext(createEditor('print', 5, { languageId: 'text' }))).to.equal(false);
    });
});
