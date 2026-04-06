import { expect } from 'chai';
import * as vscode from 'vscode';

import { createSupervisorWebviewAssets } from '../../client/supervisor/extension';

suite('Python Supervisor - Extension Webview Assets', () => {
    test('points supervisor registration at the Python Monaco support module', () => {
        const extensionUri = vscode.Uri.file('/tmp/python-extension');
        const assets = createSupervisorWebviewAssets({
            extensionUri,
        } as unknown as vscode.ExtensionContext);

        expect(assets.monacoSupportModule?.path).to.equal(
            vscode.Uri.joinPath(
                extensionUri,
                'resources',
                'supervisor',
                'pythonMonacoSupport.js',
            ).path,
        );
        expect(assets.localResourceRoots?.map((uri) => uri.path)).to.deep.equal([
            vscode.Uri.joinPath(extensionUri, 'resources', 'supervisor').path,
            vscode.Uri.joinPath(extensionUri, 'syntaxes').path,
        ]);
        expect(assets.textMateGrammar).to.deep.equal({
            scopeName: 'source.python',
            grammarUri: vscode.Uri.joinPath(
                extensionUri,
                'syntaxes',
                'MagicPython.tmLanguage.json',
            ),
        });
    });

    test('ships the vendored TextMate grammar used by the supervisor console', () => {
        const extensionUri = vscode.Uri.file('/tmp/python-extension');
        const assets = createSupervisorWebviewAssets({
            extensionUri,
        } as unknown as vscode.ExtensionContext);

        expect(assets.textMateGrammar?.grammarUri.path).to.equal(
            vscode.Uri.joinPath(
                extensionUri,
                'syntaxes',
                'MagicPython.tmLanguage.json',
            ).path,
        );
    });
});
