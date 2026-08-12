import { expect } from 'chai';
import * as crypto from 'crypto';
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
    fs.writeFileSync(filePath, 'apk-test-binary', { mode: 0o755 });
    if (process.platform !== 'win32') {
        fs.chmodSync(filePath, 0o755);
    }
    return filePath;
}

function createBundledBinary(extensionPath: string): string {
    const binaryPath = createBinary(path.join(extensionPath, 'resources', 'apk', getExecutableName()));
    const digest = crypto.createHash('sha256').update(fs.readFileSync(binaryPath)).digest('hex');
    fs.writeFileSync(
        path.join(path.dirname(binaryPath), 'manifest.json'),
        JSON.stringify({ version: '0.1.0', binaryChecksum: `sha256:${digest}` }),
    );
    return binaryPath;
}

function createContext(extensionPath: string): vscode.ExtensionContext {
    return {
        extensionPath,
        extension: { packageJSON: { positron: { binaryDependencies: { apk: '0.1.0' } } } },
    } as unknown as vscode.ExtensionContext;
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
        createBundledBinary(extensionPath);
        process.env[APK_BINARY_ENV_VAR] = envBinary;
        process.env.PATH = '';

        sinon.stub(workspaceApis, 'getConfiguration').returns({
            get: sinon
                .stub()
                .callsFake((key: string, defaultValue?: string) =>
                    key === 'supervisor.apkPath' ? configuredBinary : defaultValue,
                ),
        } as any);

        const kernelSpec = await createApkKernelSpec(
            createContext(extensionPath),
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
        createBundledBinary(extensionPath);
        process.env[APK_BINARY_ENV_VAR] = envBinary;
        process.env.PATH = '';

        sinon.stub(workspaceApis, 'getConfiguration').returns({
            get: sinon.stub().returns(''),
        } as any);

        const kernelSpec = await createApkKernelSpec(
            createContext(extensionPath),
            installation,
            'console',
            new MockOutputChannel('python-supervisor'),
        );

        expect(kernelSpec.argv[0]).to.equal(envBinary);
    });

    test('uses the supervisor-managed apk install location when available', async () => {
        const extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'python-supervisor-ext-'));
        tempDirs.push(extensionPath);

        const installedBinary = createBundledBinary(extensionPath);
        delete process.env[APK_BINARY_ENV_VAR];
        process.env.PATH = '';

        sinon.stub(workspaceApis, 'getConfiguration').returns({
            get: sinon.stub().returns(''),
        } as any);

        const kernelSpec = await createApkKernelSpec(
            createContext(extensionPath),
            installation,
            'console',
            new MockOutputChannel('python-supervisor'),
        );

        expect(kernelSpec.argv[0]).to.equal(installedBinary);
    });

    test('provides the PET-discovered Python path to apk', async () => {
        const extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'python-supervisor-ext-'));
        tempDirs.push(extensionPath);
        createBundledBinary(extensionPath);
        delete process.env[APK_BINARY_ENV_VAR];
        process.env.PATH = '';
        sinon.stub(workspaceApis, 'getConfiguration').returns({ get: sinon.stub().returns('') } as any);

        const logChannel = new MockOutputChannel('python-supervisor');
        const kernelSpec = await createApkKernelSpec(createContext(extensionPath), installation, 'console', logChannel);

        expect(kernelSpec.argv.slice(1, 3)).to.deep.equal(['--python', installation.pythonPath]);
        expect(kernelSpec.env?.APK_PYTHON_PATH).to.equal(installation.pythonPath);
        expect(logChannel.output).to.contain('Kernel spec created with 9 argument(s) and 1 environment variable(s)');
        expect(logChannel.output).not.to.contain('"argv"');
        expect(logChannel.output).not.to.contain('"APK_PYTHON_PATH"');
    });

    test('uses the adjacent apk repository build during extension development', async () => {
        const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'python-supervisor-workspace-'));
        const extensionPath = path.join(workspacePath, 'vscode-python');
        fs.mkdirSync(extensionPath);
        tempDirs.push(workspacePath);

        const localBinary = createBinary(path.join(workspacePath, 'apk', 'target', 'release', getExecutableName()));
        delete process.env[APK_BINARY_ENV_VAR];
        process.env.PATH = '';

        sinon.stub(workspaceApis, 'getConfiguration').returns({
            get: sinon.stub().returns(''),
        } as any);

        const kernelSpec = await createApkKernelSpec(
            createContext(extensionPath),
            installation,
            'console',
            new MockOutputChannel('python-supervisor'),
        );

        expect(kernelSpec.argv[0]).to.equal(localBinary);
    });

    test('rejects a bundled apk whose SHA-256 no longer matches its manifest', async () => {
        const extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'python-supervisor-ext-'));
        tempDirs.push(extensionPath);

        const installedBinary = createBundledBinary(extensionPath);
        fs.appendFileSync(installedBinary, '-tampered');
        const logChannel = new MockOutputChannel('python-supervisor');
        delete process.env[APK_BINARY_ENV_VAR];
        process.env.PATH = '';

        sinon.stub(workspaceApis, 'getConfiguration').returns({
            get: sinon.stub().returns(''),
        } as any);

        let error: Error | undefined;
        try {
            await createApkKernelSpec(createContext(extensionPath), installation, 'console', logChannel);
        } catch (ex) {
            error = ex as Error;
        }

        expect(error?.message).to.contain('Unable to find the apk binary');
        expect(logChannel.output).to.contain('SHA-256 mismatch');
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
            get: sinon
                .stub()
                .callsFake((key: string, defaultValue?: string) =>
                    key === 'supervisor.apkPath' ? missingConfiguredPath : defaultValue,
                ),
        } as any);

        let error: Error | undefined;
        try {
            await createApkKernelSpec(createContext(extensionPath), installation, 'console', logChannel);
        } catch (ex) {
            error = ex as Error;
        }

        expect(error?.message).to.contain('Unable to find the apk binary');
        expect(error?.message).to.contain(`python.supervisor.apkPath: ${missingConfiguredPath}`);
        expect(logChannel.output).to.contain(
            `Ignoring missing apk binary from python.supervisor.apkPath: ${missingConfiguredPath}`,
        );
    });
});
