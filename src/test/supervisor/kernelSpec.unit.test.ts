import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { createApkKernelSpec } from '../../client/supervisor/kernelSpec';
import * as workspaceApis from '../../client/common/vscodeApis/workspaceApis';
import { EnvironmentType } from '../../client/pythonEnvironments/info';
import type { PythonRuntimeInstallation } from '../../client/supervisor/runtimeProvider';
import { MockOutputChannel } from '../mockClasses';

const APK_BINARY_ENV_VAR = 'VSCODE_PYTHON_SUPERVISOR_APK_PATH';

function getExecutableName(): string {
    return process.platform === 'win32' ? 'apk.exe' : 'apk';
}

function createBinary(filePath: string): string {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '');
    return filePath;
}

suite('Python Supervisor - Kernel Spec', () => {
    const installation: PythonRuntimeInstallation = {
        pythonPath: '/tmp/python',
        envType: EnvironmentType.Unknown,
    };
    let originalApkEnv: string | undefined;
    let originalPath: string | undefined;
    let tempDirs: string[];

    setup(() => {
        originalApkEnv = process.env[APK_BINARY_ENV_VAR];
        originalPath = process.env.PATH;
        tempDirs = [];
    });

    teardown(() => {
        sinon.restore();
        if (originalApkEnv === undefined) {
            delete process.env[APK_BINARY_ENV_VAR];
        } else {
            process.env[APK_BINARY_ENV_VAR] = originalApkEnv;
        }
        process.env.PATH = originalPath;
        for (const tempDir of tempDirs) {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('prefers python.supervisor.apkPath over env and installed binaries', async () => {
        const extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'python-supervisor-ext-'));
        tempDirs.push(extensionPath);

        const configuredBinary = createBinary(path.join(extensionPath, 'configured', getExecutableName()));
        const envBinary = createBinary(path.join(extensionPath, 'env', getExecutableName()));
        createBinary(path.join(extensionPath, 'resources', 'apk', getExecutableName()));
        process.env[APK_BINARY_ENV_VAR] = envBinary;
        process.env.PATH = '';

        sinon.stub(workspaceApis, 'getConfiguration').returns({
            get: sinon.stub().callsFake((key: string, defaultValue?: string) =>
                key === 'supervisor.apkPath' ? configuredBinary : defaultValue),
        } as any);

        const kernelSpec = await createApkKernelSpec(
            ({ extensionPath } as unknown) as vscode.ExtensionContext,
            installation,
            'console',
            new MockOutputChannel('python-supervisor'),
        );

        expect(kernelSpec.argv[0]).to.equal(configuredBinary);
    });

    test('prefers the apk environment variable over the installed resource path', async () => {
        const extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'python-supervisor-ext-'));
        tempDirs.push(extensionPath);

        const envBinary = createBinary(path.join(extensionPath, 'env', getExecutableName()));
        createBinary(path.join(extensionPath, 'resources', 'apk', getExecutableName()));
        process.env[APK_BINARY_ENV_VAR] = envBinary;
        process.env.PATH = '';

        sinon.stub(workspaceApis, 'getConfiguration').returns({
            get: sinon.stub().returns(''),
        } as any);

        const kernelSpec = await createApkKernelSpec(
            ({ extensionPath } as unknown) as vscode.ExtensionContext,
            installation,
            'console',
            new MockOutputChannel('python-supervisor'),
        );

        expect(kernelSpec.argv[0]).to.equal(envBinary);
    });

    test('uses the supervisor-managed apk install location when available', async () => {
        const extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'python-supervisor-ext-'));
        tempDirs.push(extensionPath);

        const installedBinary = createBinary(path.join(extensionPath, 'resources', 'apk', getExecutableName()));
        delete process.env[APK_BINARY_ENV_VAR];
        process.env.PATH = '';

        sinon.stub(workspaceApis, 'getConfiguration').returns({
            get: sinon.stub().returns(''),
        } as any);

        const kernelSpec = await createApkKernelSpec(
            ({ extensionPath } as unknown) as vscode.ExtensionContext,
            installation,
            'console',
            new MockOutputChannel('python-supervisor'),
        );

        expect(kernelSpec.argv[0]).to.equal(installedBinary);
    });

    test('reports checked paths when no apk binary can be found', async () => {
        const extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'python-supervisor-ext-'));
        tempDirs.push(extensionPath);

        const missingConfiguredPath = path.join(extensionPath, 'missing', getExecutableName());
        const logChannel = new MockOutputChannel('python-supervisor');
        delete process.env[APK_BINARY_ENV_VAR];
        process.env.PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'python-supervisor-path-'));
        tempDirs.push(process.env.PATH);

        sinon.stub(workspaceApis, 'getConfiguration').returns({
            get: sinon.stub().callsFake((key: string, defaultValue?: string) =>
                key === 'supervisor.apkPath' ? missingConfiguredPath : defaultValue),
        } as any);

        let error: Error | undefined;
        try {
            await createApkKernelSpec(
                ({ extensionPath } as unknown) as vscode.ExtensionContext,
                installation,
                'console',
                logChannel,
            );
        } catch (ex) {
            error = ex as Error;
        }

        expect(error?.message).to.contain('Unable to find the apk binary');
        expect(error?.message).to.contain(`python.supervisor.apkPath: ${missingConfiguredPath}`);
        expect(logChannel.output).to.contain(`Ignoring missing apk binary from python.supervisor.apkPath: ${missingConfiguredPath}`);
    });
});
