import { expect } from 'chai';
import * as path from 'path';
import * as vscode from 'vscode';

import { PythonBinaryProvider } from '../../client/supervisor/binaryProvider';

suite('Python Supervisor - Binary Provider', () => {
    test('returns an apk download definition for the supervisor binary manager', () => {
        const extensionPath = '/tmp/python-extension';
        const provider = new PythonBinaryProvider(({
            extension: {
                packageJSON: {
                    positron: {
                        binaryDependencies: {
                            apk: '0.1.0',
                        },
                    },
                },
            },
            extensionPath,
        } as unknown) as vscode.ExtensionContext);

        const definitions = provider.getBinaryDefinitions();
        const apk = definitions.apk;

        expect(provider.ownerId).to.equal('python');
        expect(apk.repo).to.equal('Mengzhiyaa/apk-build');
        expect(apk.version).to.equal('0.1.0');
        expect(apk.binaryName).to.equal(process.platform === 'win32' ? 'apk.exe' : 'apk');
        expect(apk.archivePattern('0.1.0', 'linux-x64')).to.equal('apk-0.1.0-linux-x64.zip');
        expect(apk.installDir).to.equal(path.join(extensionPath, 'resources', 'apk'));
        expect(apk.platformOverride?.('darwin-arm64')).to.equal('darwin-universal');
        expect(apk.platformOverride?.('linux-x64')).to.equal('linux-x64');
    });

    test('throws when the apk version metadata is missing', () => {
        const provider = new PythonBinaryProvider(({
            extension: {
                packageJSON: {},
            },
            extensionPath: '/tmp/python-extension',
        } as unknown) as vscode.ExtensionContext);

        expect(() => provider.getBinaryDefinitions()).to.throw(
            'Missing positron.binaryDependencies.apk in vscode-python package.json',
        );
    });
});
