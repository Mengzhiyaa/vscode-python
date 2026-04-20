import * as path from 'path';
import * as vscode from 'vscode';

import type { BinaryDefinition, IBinaryProvider } from './types/supervisor-api';
import { PYTHON_LANGUAGE_ID } from './runtimeProvider';

function getApkBinaryName(): string {
    return process.platform === 'win32' ? 'apk.exe' : 'apk';
}

export class PythonBinaryProvider implements IBinaryProvider {
    readonly ownerId = PYTHON_LANGUAGE_ID;

    constructor(private readonly _extensionContext: vscode.ExtensionContext) {}

    getBinaryDefinitions(): Readonly<Record<string, BinaryDefinition>> {
        const apkVersion = this._extensionContext.extension.packageJSON?.positron?.binaryDependencies?.apk;
        if (typeof apkVersion !== 'string' || !apkVersion) {
            throw new Error('Missing positron.binaryDependencies.apk in vscode-python package.json');
        }

        return {
            apk: {
                repo: 'Mengzhiyaa/apk-build',
                version: apkVersion,
                binaryName: getApkBinaryName(),
                archivePattern: (version, platform) => `apk-${version}-${platform}.zip`,
                installDir: path.join(this._extensionContext.extensionPath, 'resources', 'apk'),
                platformOverride: (platform) => platform.startsWith('darwin') ? 'darwin-universal' : platform,
            },
        };
    }
}
