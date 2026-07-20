/**
 * Verifies that a packaged VSIX contains the target APK binary and that the
 * packaged bytes match the signed build manifest produced by install-apk.mjs.
 *
 * Usage: node scripts/verify-apk-vsix.mjs <file.vsix> [--platform <platform>]
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const StreamZip = require('node-stream-zip');
const args = process.argv.slice(2);
const vsixPathArg = args.find((arg) => !arg.startsWith('--'));
const platformIndex = args.indexOf('--platform');
const explicitPlatform = platformIndex >= 0 ? args[platformIndex + 1] : undefined;

if (!vsixPathArg) {
    throw new Error('Usage: node scripts/verify-apk-vsix.mjs <file.vsix> [--platform <platform>]');
}

function normalizeOs(value) {
    if (value === 'win32' || value === 'windows') {
        return 'windows';
    }
    if (value === 'alpine') {
        return 'linux';
    }
    if (value === 'macos') {
        return 'darwin';
    }
    return value;
}

function normalizeArch(value) {
    if (value === 'amd64' || value === 'x86_64') {
        return 'x64';
    }
    if (value === 'aarch64') {
        return 'arm64';
    }
    return value;
}

function normalizePlatform(value) {
    const [targetOs, targetArch] = value.split('-', 2);
    return `${normalizeOs(targetOs)}-${normalizeArch(targetArch)}`;
}

function hostPlatform() {
    return `${normalizeOs(os.platform())}-${normalizeArch(os.arch())}`;
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function digestValue(value, label) {
    const [algorithm, digest] = String(value ?? '').split(':', 2);
    if (algorithm !== 'sha256' || !/^[0-9a-f]{64}$/i.test(digest ?? '')) {
        throw new Error(`Invalid ${label}: ${value ?? '<missing>'}`);
    }
    return digest.toLowerCase();
}

function detectVersion(binaryPath) {
    const output = execFileSync(binaryPath, ['--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
        windowsHide: true,
    }).trim();
    return output.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0];
}

const vsixPath = path.resolve(vsixPathArg);
const targetPlatform = normalizePlatform(explicitPlatform ?? hostPlatform());
const executableName = targetPlatform.startsWith('windows-') ? 'apk.exe' : 'apk';
const binaryEntryName = `extension/resources/apk/${executableName}`;
const manifestEntryName = 'extension/resources/apk/manifest.json';
const packageEntryName = 'extension/package.json';
const zip = new StreamZip.async({ file: vsixPath });
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-apk-vsix-'));

try {
    const entries = await zip.entries();
    const binaryEntry = entries[binaryEntryName];
    if (!binaryEntry?.isFile) {
        throw new Error(`VSIX is missing ${binaryEntryName}`);
    }
    if (!entries[manifestEntryName]?.isFile) {
        throw new Error(`VSIX is missing ${manifestEntryName}`);
    }

    const packageJson = JSON.parse((await zip.entryData(packageEntryName)).toString('utf8'));
    const manifest = JSON.parse((await zip.entryData(manifestEntryName)).toString('utf8'));
    const binary = await zip.entryData(binaryEntryName);
    const expectedVersion = packageJson?.positron?.binaryDependencies?.apk;
    if (!expectedVersion || manifest.version !== expectedVersion) {
        throw new Error(
            `APK version mismatch: package=${expectedVersion ?? 'missing'}, manifest=${manifest.version ?? 'missing'}`,
        );
    }

    const expectedDigest = digestValue(manifest.binaryChecksum, 'APK binary checksum');
    const actualDigest = sha256(binary);
    if (actualDigest !== expectedDigest) {
        throw new Error(`APK binary checksum mismatch: expected ${expectedDigest}, got ${actualDigest}`);
    }

    if (!targetPlatform.startsWith('windows-')) {
        const unixMode = (binaryEntry.attr >>> 16) & 0xffff;
        if ((unixMode & 0o111) === 0) {
            throw new Error(`${binaryEntryName} is not executable in the VSIX (mode ${unixMode.toString(8)})`);
        }
    }

    const extractedBinary = path.join(tempDir, executableName);
    fs.writeFileSync(extractedBinary, binary, { mode: 0o755 });
    if (targetPlatform === hostPlatform()) {
        const detectedVersion = detectVersion(extractedBinary);
        if (detectedVersion !== expectedVersion) {
            throw new Error(
                `APK executable reported version ${detectedVersion ?? 'unknown'}; expected ${expectedVersion}`,
            );
        }
    } else {
        console.log(`Skipped executable version probe for cross-platform target ${targetPlatform}`);
    }

    console.log(
        `Verified ${path.basename(vsixPath)}: ${binaryEntryName}, version ${expectedVersion}, sha256:${actualDigest}`,
    );
} finally {
    await zip.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
}
