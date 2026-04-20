import { expect } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { activateSupervisor, createSupervisorWebviewAssets } from '../../client/supervisor/extension';

suite('Python Supervisor - Extension Webview Assets', () => {
    teardown(() => {
        sinon.restore();
    });

    test('points supervisor registration at the Python Monaco support module', () => {
        const extensionUri = vscode.Uri.file('/tmp/python-extension');
        const assets = createSupervisorWebviewAssets(({
            extensionUri,
        } as unknown) as vscode.ExtensionContext);

        expect(assets.monacoSupportModule?.path).to.equal(
            vscode.Uri.joinPath(extensionUri, 'resources', 'supervisor', 'pythonMonacoSupport.js').path,
        );
        expect(assets.localResourceRoots?.map((uri) => uri.path)).to.deep.equal([
            vscode.Uri.joinPath(extensionUri, 'resources', 'supervisor').path,
            vscode.Uri.joinPath(extensionUri, 'syntaxes').path,
        ]);
        expect(assets.textMateGrammar).to.deep.equal({
            scopeName: 'source.python',
            grammarUri: vscode.Uri.joinPath(extensionUri, 'syntaxes', 'MagicPython.tmLanguage.json'),
        });
    });

    test('ships the vendored TextMate grammar used by the supervisor console', () => {
        const extensionUri = vscode.Uri.file('/tmp/python-extension');
        const assets = createSupervisorWebviewAssets(({
            extensionUri,
        } as unknown) as vscode.ExtensionContext);

        expect(assets.textMateGrammar?.grammarUri.path).to.equal(
            vscode.Uri.joinPath(extensionUri, 'syntaxes', 'MagicPython.tmLanguage.json').path,
        );
    });

    test('registers Python supervisor support with a binary provider and retries after failures', async () => {
        const extensionUri = vscode.Uri.file('/tmp/python-extension');
        const context = ({
            extension: {
                packageJSON: {
                    positron: {
                        binaryDependencies: {
                            apk: '0.1.0',
                        },
                    },
                },
            },
            extensionPath: extensionUri.fsPath,
            extensionUri,
        } as unknown) as vscode.ExtensionContext;
        const registerLanguageSupport = sinon.stub();
        registerLanguageSupport.onFirstCall().rejects(new Error('register failed'));
        registerLanguageSupport.onSecondCall().resolves();

        const supervisorApi = {
            registerLanguageSupport,
        };
        const supervisorExtension = {
            activate: sinon.stub().resolves(supervisorApi),
        };
        const serviceContainer = {
            get: sinon.stub().returns({}),
        };

        sinon.stub(vscode.extensions, 'getExtension').returns(supervisorExtension as any);

        let firstError: Error | undefined;
        try {
            await activateSupervisor(context, serviceContainer as any);
        } catch (error) {
            firstError = error as Error;
        }

        expect(firstError?.message).to.equal('register failed');

        await activateSupervisor(context, serviceContainer as any);
        await activateSupervisor(context, serviceContainer as any);

        sinon.assert.calledTwice(supervisorExtension.activate);
        sinon.assert.calledTwice(registerLanguageSupport);

        const registration = registerLanguageSupport.secondCall.args[0];
        expect(registration.runtimeProvider.languageId).to.equal('python');
        expect(registration.binaryProvider.ownerId).to.equal('python');
        expect(registration.binaryProvider.getBinaryDefinitions().apk.installDir).to.equal(
            path.join(context.extensionPath, 'resources', 'apk'),
        );
    });
});
