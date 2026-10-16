// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as os from 'os';
import * as path from 'path';
import { realpath, readFile } from 'fs/promises';
import { exec, isParentPath } from '../externalDependencies';

interface UvInstallation {
    command: string;
    pythonDirectory: string;
}

let locatedUv: Promise<UvInstallation | undefined> | undefined;

async function locateUv(): Promise<UvInstallation | undefined> {
    const binary = process.platform === 'win32' ? 'uv.exe' : 'uv';
    for (const candidate of ['uv', path.join(os.homedir(), '.local', 'bin', binary),
        path.join(os.homedir(), '.cargo', 'bin', binary)]) {
        try {
            const result = await exec(candidate, ['--color', 'never', 'python', 'dir'], { throwOnStdErr: true });
            const pythonDirectory = result.stdout.trim();
            if (pythonDirectory) { return { command: candidate, pythonDirectory }; }
        } catch { /* Try the next installation location. */ }
    }
    return undefined;
}

async function getUvInstallation(): Promise<UvInstallation> {
    locatedUv ??= locateUv();
    const installation = await locatedUv;
    if (!installation) {
        locatedUv = undefined;
        throw new Error('uv is not available. Install uv to use this environment\'s package manager.');
    }
    return installation;
}

export async function getLocatedUvCommand(): Promise<string> {
    return (await getUvInstallation()).command;
}

export async function isUvInstalled(): Promise<boolean> {
    try { await getLocatedUvCommand(); return true; } catch { return false; }
}

/** Recognizes uv-created venvs and installations in uv's managed Python directory. */
export async function isUvEnvironment(interpreterPath: string): Promise<boolean> {
    let installation: UvInstallation;
    try { installation = await getUvInstallation(); } catch { return false; }
    try {
        const [interpreter, directory] = await Promise.all([realpath(interpreterPath), realpath(installation.pythonDirectory)]);
        if (isParentPath(interpreter, directory)) { return true; }
    } catch { /* A uv-created venv can still be identified by its configuration. */ }
    const directory = path.dirname(interpreterPath);
    for (const file of [path.join(directory, '..', 'pyvenv.cfg'), path.join(directory, 'pyvenv.cfg')]) {
        try {
            if (/^\s*uv\s*=/mi.test(await readFile(file, 'utf8'))) { return true; }
        } catch { /* This interpreter layout may not have this candidate file. */ }
    }
    return false;
}
