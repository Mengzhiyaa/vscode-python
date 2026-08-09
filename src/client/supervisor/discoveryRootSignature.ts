import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { getUserHomeDir } from '../common/utils/platform';
import { getPyenvDir } from '../pythonEnvironments/common/environmentManagers/pyenv';
import type { RuntimeRootEntry, RuntimeRootSignature } from './types/supervisor-api';

const POSIX_BIN_PATHS: readonly string[] = [
    '/usr/bin',
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/local/bin',
    '/opt/python',
];

const HOME_RELATIVE_PATHS: readonly string[] = [
    '.pyenv/versions',
    'anaconda3/envs',
    'miniconda3/envs',
    'anaconda/envs',
    'miniconda/envs',
    '.conda/envs',
];

function getUvPythonInstallDirs(): string[] {
    const installDirOverride = process.env.UV_PYTHON_INSTALL_DIR;
    if (installDirOverride) {
        return [installDirOverride];
    }
    const stateDirOverride = process.env.UV_STATE_DIR;
    if (stateDirOverride) {
        return [path.join(stateDirOverride, 'python')];
    }
    if (process.platform === 'win32') {
        return process.env.APPDATA ? [path.join(process.env.APPDATA, 'uv', 'python')] : [];
    }
    const home = getUserHomeDir();
    const dirs = process.env.XDG_DATA_HOME
        ? [path.join(process.env.XDG_DATA_HOME, 'uv', 'python')]
        : home
            ? [path.join(home, '.local', 'share', 'uv', 'python')]
            : [];
    if (process.platform === 'darwin' && home) {
        dirs.push(path.join(home, 'Library', 'Application Support', 'uv', 'python'));
    }
    return dirs;
}

function getHatchVirtualEnvRoot(): string | undefined {
    const home = getUserHomeDir();
    if (!home) {
        return undefined;
    }
    switch (process.platform) {
        case 'darwin':
            return path.join(home, 'Library', 'Application Support', 'hatch', 'env', 'virtual');
        case 'linux':
            return path.join(home, '.local', 'share', 'hatch', 'env', 'virtual');
        case 'win32':
            return process.env.LOCALAPPDATA
                ? path.join(process.env.LOCALAPPDATA, 'hatch', 'env', 'virtual')
                : undefined;
        default:
            return undefined;
    }
}

function getWindowsKnownRoots(): string[] {
    if (process.platform !== 'win32') {
        return [];
    }
    const roots: string[] = [];
    if (process.env.LOCALAPPDATA) {
        roots.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Python'));
        roots.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps'));
    }
    const programFiles = process.env.ProgramFiles ?? process.env.PROGRAMFILES;
    if (programFiles) {
        roots.push(path.join(programFiles, 'Python'));
    }
    return roots;
}

function getDefaultInterpreterParent(): string | undefined {
    const value = vscode.workspace.getConfiguration('python').get<string>('defaultInterpreterPath');
    return value ? path.dirname(value) : undefined;
}

export function computeRootSignatureEntries(candidates: readonly string[]): RuntimeRootEntry[] {
    const seen = new Set<string>();
    const entries: RuntimeRootEntry[] = [];
    for (const candidate of candidates) {
        let resolved = candidate;
        let exists = false;
        let mtimeMs = 0;
        try {
            const stat = fs.statSync(candidate);
            try {
                resolved = fs.realpathSync(candidate);
            } catch {
                resolved = candidate;
            }
            exists = true;
            mtimeMs = stat.mtimeMs;
        } catch {
            // Keep absent roots so creating one invalidates the signature.
        }
        if (!seen.has(resolved)) {
            seen.add(resolved);
            entries.push({ path: resolved, exists, mtimeMs });
        }
    }
    return entries;
}

export async function getPythonDiscoveryRootSignature(): Promise<RuntimeRootSignature> {
    const home = getUserHomeDir();
    const candidates: string[] = [];
    try {
        const pyenvDir = getPyenvDir();
        if (pyenvDir) {
            candidates.push(path.join(pyenvDir, 'versions'));
        }
    } catch {
        // Pyenv is not configured.
    }
    candidates.push(...POSIX_BIN_PATHS);
    if (home) {
        candidates.push(...HOME_RELATIVE_PATHS.map(relativePath => path.join(home, relativePath)));
    }
    candidates.push(...getUvPythonInstallDirs());
    const hatchRoot = getHatchVirtualEnvRoot();
    if (hatchRoot) {
        candidates.push(hatchRoot);
    }
    candidates.push(...getWindowsKnownRoots());
    const defaultInterpreterParent = getDefaultInterpreterParent();
    if (defaultInterpreterParent) {
        candidates.push(defaultInterpreterParent);
    }

    return {
        entries: computeRootSignatureEntries(candidates),
        opaque: getFilterSettingsDigest(),
    };
}

function getFilterSettingsDigest(): string {
    const config = vscode.workspace.getConfiguration('python');
    const payload = {
        include: config.get<string[]>('interpreters.include') ?? [],
        exclude: config.get<string[]>('interpreters.exclude') ?? [],
        override: config.get<string[]>('interpreters.override') ?? [],
        locator: config.get<string>('locator') ?? '',
        useEnvironmentsExtension: config.get<boolean>('useEnvironmentsExtension') ?? false,
    };
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
