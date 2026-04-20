import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { untildify } from '../common/helpers';
import * as workspaceApis from '../common/vscodeApis/workspaceApis';
import type { JupyterKernelSpec, LanguageSessionMode } from './types/supervisor-api';
import type { PythonRuntimeInstallation } from './runtimeProvider';

const APK_BINARY_ENV_VAR = 'VSCODE_PYTHON_SUPERVISOR_APK_PATH';

type ApkPathCandidate = {
    source: string;
    path: string | undefined;
    explicit: boolean;
};

function getApkExecutableName(): string {
    return process.platform === 'win32' ? 'apk.exe' : 'apk';
}

function normalizeCandidatePath(candidate: string | undefined): string | undefined {
    if (!candidate) {
        return undefined;
    }

    const trimmed = candidate.trim();
    if (!trimmed) {
        return undefined;
    }

    return path.resolve(untildify(trimmed));
}

function findExecutableOnPath(executableName: string): string | undefined {
    const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter((entry) => entry.length > 0);
    for (const entry of pathEntries) {
        const candidate = path.join(entry, executableName);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return undefined;
}

function getApkPathCandidates(context: vscode.ExtensionContext): ApkPathCandidate[] {
    const configuredPath = workspaceApis.getConfiguration('python').get<string>('supervisor.apkPath');
    const executableName = getApkExecutableName();
    return [
        {
            source: 'python.supervisor.apkPath',
            path: normalizeCandidatePath(configuredPath),
            explicit: true,
        },
        {
            source: APK_BINARY_ENV_VAR,
            path: normalizeCandidatePath(process.env[APK_BINARY_ENV_VAR]),
            explicit: true,
        },
        {
            source: 'supervisor binary install',
            path: path.join(context.extensionPath, 'resources', 'apk', executableName),
            explicit: false,
        },
        {
            source: 'local apk release build',
            path: path.resolve(context.extensionPath, '..', '..', '..', 'apk', 'target', 'release', executableName),
            explicit: false,
        },
        {
            source: 'local apk debug build',
            path: path.resolve(context.extensionPath, '..', '..', '..', 'apk', 'target', 'debug', executableName),
            explicit: false,
        },
        {
            source: 'PATH',
            path: findExecutableOnPath(executableName),
            explicit: false,
        },
    ];
}

function resolveApkBinaryPath(
    context: vscode.ExtensionContext,
    logChannel: vscode.LogOutputChannel,
): string {
    const pathCandidates = getApkPathCandidates(context);

    for (const candidate of pathCandidates) {
        if (!candidate.path) {
            continue;
        }

        if (fs.existsSync(candidate.path)) {
            logChannel.info(`[Python Supervisor] Using apk binary from ${candidate.source}: ${candidate.path}`);
            return candidate.path;
        }

        if (candidate.explicit) {
            logChannel.warn(`[Python Supervisor] Ignoring missing apk binary from ${candidate.source}: ${candidate.path}`);
        }
    }

    const checkedPaths = pathCandidates
        .filter((candidate) => !!candidate.path)
        .map((candidate) => `${candidate.source}: ${candidate.path}`)
        .join(', ');

    throw new Error(
        `Unable to find the apk binary. Set python.supervisor.apkPath or ${APK_BINARY_ENV_VAR}. ` +
        `Checked ${checkedPaths || 'no candidate paths'}.`,
    );
}

function createDisplayName(installation: PythonRuntimeInstallation): string {
    const label =
        installation.envName ??
        installation.displayName ??
        installation.version ??
        path.basename(installation.pythonPath);
    return `Python (${label})`;
}

export async function createApkKernelSpec(
    context: vscode.ExtensionContext,
    installation: PythonRuntimeInstallation,
    sessionMode: LanguageSessionMode,
    logChannel: vscode.LogOutputChannel,
): Promise<JupyterKernelSpec> {
    const apkPath = resolveApkBinaryPath(context, logChannel);
    const kernelSpec: JupyterKernelSpec = {
        argv: [
            apkPath,
            '--python',
            installation.pythonPath,
            '--connection-file',
            '{connection_file}',
            '--session-mode',
            sessionMode,
            '--log',
            '{log_file}',
        ],
        display_name: createDisplayName(installation),
        language: 'python',
        env: {
            APK_PYTHON_PATH: installation.pythonPath,
        },
        kernel_protocol_version: '5.5',
    };

    logChannel.info(`[Python Supervisor] Using apk kernel at ${apkPath}`);
    logChannel.debug(`[Python Supervisor] Kernel spec: ${JSON.stringify(kernelSpec)}`);

    return kernelSpec;
}
