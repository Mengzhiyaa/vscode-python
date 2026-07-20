/**
 * Downloads and installs the APK (Python kernel) binary from GitHub Releases.
 *
 * Usage:
 *   node scripts/install-apk.mjs [--platform <platform>] [--retry <n>]
 *
 * Platform is auto-detected from the environment or can be overridden via
 * TARGET_OS / TARGET_ARCH environment variables (used in CI) or the --platform flag.
 *
 * The version is read from package.json → positron.binaryDependencies.apk.
 */

import fs from 'fs';
import http from 'http';
import https from 'https';
import os from 'os';
import path from 'path';
import process from 'process';
import crypto from 'crypto';
import { execFileSync, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DOWNLOAD_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
    let retries = 1;
    let platform;

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--retry') {
            retries = Number.parseInt(args[index + 1] ?? '1', 10) || 1;
            index += 1;
        } else if (arg === '--platform') {
            platform = args[index + 1];
            index += 1;
        }
    }

    return { retries, platform };
}

// ---------------------------------------------------------------------------
// Platform helpers
// ---------------------------------------------------------------------------

function normalizeOs(osName) {
    switch (osName) {
        case 'darwin':
        case 'macos':
            return 'darwin';
        case 'win32':
        case 'windows':
            return 'windows';
        default:
            return osName;
    }
}

function normalizeArch(arch) {
    switch (arch) {
        case 'amd64':
        case 'x86_64':
            return 'x64';
        case 'aarch64':
            return 'arm64';
        default:
            return arch;
    }
}

function detectPlatform(explicitPlatform) {
    if (explicitPlatform) {
        const [targetOs, targetArch] = explicitPlatform.split('-', 2);
        const normalizedOs = targetOs === 'alpine' ? 'linux' : normalizeOs(targetOs);
        return `${normalizedOs}-${normalizeArch(targetArch)}`;
    }

    const targetOs = process.env.TARGET_OS;
    const targetArch = process.env.TARGET_ARCH;
    if (targetOs && targetArch) {
        return `${normalizeOs(targetOs)}-${normalizeArch(targetArch)}`;
    }

    return `${normalizeOs(os.platform())}-${normalizeArch(os.arch())}`;
}

/**
 * For macOS we ship a universal binary, so override the detected platform.
 */
function effectivePlatform(platform) {
    if (platform.startsWith('darwin')) {
        return 'darwin-universal';
    }

    return platform;
}

// ---------------------------------------------------------------------------
// Version resolution
// ---------------------------------------------------------------------------

function readApkManifest(platform) {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const version = pkg?.positron?.binaryDependencies?.apk;
    if (!version) {
        throw new Error('Missing positron.binaryDependencies.apk in package.json');
    }

    const checksum = pkg?.positron?.binaryChecksums?.apk?.[effectivePlatform(platform)];
    if (!checksum) {
        throw new Error(`Missing positron.binaryChecksums.apk.${effectivePlatform(platform)} in package.json`);
    }

    return { version, checksum };
}

function sha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function verifyChecksum(filePath, expectedDigest) {
    const [algorithm, expected] = expectedDigest.split(':', 2);
    if (algorithm !== 'sha256' || !/^[0-9a-f]{64}$/i.test(expected ?? '')) {
        throw new Error(`Unsupported checksum '${expectedDigest}' for ${path.basename(filePath)}`);
    }

    const actual = sha256(filePath);
    if (actual !== expected.toLowerCase()) {
        throw new Error(`Checksum mismatch for ${path.basename(filePath)}: expected ${expected}, got ${actual}`);
    }

    console.log(`Verified sha256 checksum for ${path.basename(filePath)}`);
}

function canExecuteTarget(platform) {
    const hostPlatform = detectPlatform();
    return platform === hostPlatform || (platform.startsWith('darwin-') && hostPlatform.startsWith('darwin-'));
}

function verifyBinaryVersion(binaryPath, version, platform) {
    if (!canExecuteTarget(platform)) {
        console.log(`Skipped executable version probe for cross-platform target ${platform}`);
        return;
    }

    const output = execFileSync(binaryPath, ['--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
        windowsHide: true,
    }).trim();
    const detectedVersion = output.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0];
    if (detectedVersion !== version) {
        throw new Error(`Installed apk reported version ${detectedVersion ?? 'unknown'}; expected ${version}`);
    }

    console.log(`Verified apk executable version ${detectedVersion}`);
}

// ---------------------------------------------------------------------------
// Download & extraction
// ---------------------------------------------------------------------------

function download(url, destination) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(destination);
        let activeRequest;
        let settled = false;

        const finish = () => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            resolve();
        };

        const fail = (error) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            activeRequest?.destroy();
            output.destroy();
            fs.rm(destination, { force: true }, () => reject(error));
        };

        const timeout = setTimeout(() => {
            fail(new Error(`Download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s for ${url}`));
        }, DOWNLOAD_TIMEOUT_MS);

        const request = (currentUrl, redirectCount) => {
            if (redirectCount > 5) {
                fail(new Error(`Too many redirects for ${url}`));
                return;
            }

            const protocol = currentUrl.startsWith('https') ? https : http;
            activeRequest = protocol
                .get(currentUrl, (response) => {
                    if (
                        response.statusCode &&
                        response.statusCode >= 300 &&
                        response.statusCode < 400 &&
                        response.headers.location
                    ) {
                        response.resume();
                        request(response.headers.location, redirectCount + 1);
                        return;
                    }

                    if (response.statusCode !== 200) {
                        response.resume();
                        fail(new Error(`Download failed for ${currentUrl}: HTTP ${response.statusCode}`));
                        return;
                    }

                    response.on('error', fail);
                    response.pipe(output);
                    output.on('finish', () => {
                        output.close(finish);
                    });
                })
                .on('error', fail);
        };

        output.on('error', fail);
        request(url, 0);
    });
}

function extractZip(archivePath, destination) {
    fs.mkdirSync(destination, { recursive: true });

    if (process.platform === 'win32') {
        execSync(
            `powershell -NoProfile -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destination}' -Force"`,
            { stdio: 'pipe' },
        );
        return;
    }

    execSync(`unzip -o -q "${archivePath}" -d "${destination}"`, { stdio: 'pipe' });
}

function findFile(rootDir, filename) {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = path.join(rootDir, entry.name);
        if (entry.isFile() && entry.name === filename) {
            return entryPath;
        }

        if (entry.isDirectory()) {
            const nested = findFile(entryPath, filename);
            if (nested) {
                return nested;
            }
        }
    }

    return undefined;
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

const APK_REPO = 'Mengzhiyaa/apk-build';
const INSTALL_DIR = 'resources/apk';

function getExecutableName(platform) {
    return platform.startsWith('windows') ? 'apk.exe' : 'apk';
}

async function installApk(version, checksum, platform) {
    const downloadPlatform = effectivePlatform(platform);
    const executableName = getExecutableName(platform);
    const archiveFile = `apk-${version}-${downloadPlatform}.zip`;
    const downloadUrl = `https://github.com/${APK_REPO}/releases/download/${version}/${archiveFile}`;
    const installDir = path.join(repoRoot, INSTALL_DIR);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-python-apk-'));

    try {
        const archivePath = path.join(tempDir, archiveFile);
        const extractDir = path.join(tempDir, 'extract');

        console.log(`Installing apk ${version} for ${platform} (archive: ${downloadPlatform})`);
        console.log(`Downloading ${downloadUrl}`);
        await download(downloadUrl, archivePath);
        verifyChecksum(archivePath, checksum);
        extractZip(archivePath, extractDir);

        const extractedBinary = findFile(extractDir, executableName);
        if (!extractedBinary) {
            throw new Error(`Could not find ${executableName} in extracted archive`);
        }

        const destination = path.join(installDir, executableName);
        const stagedDestination = path.join(installDir, `.install-${process.pid}-${executableName}`);
        fs.mkdirSync(installDir, { recursive: true });
        try {
            fs.copyFileSync(extractedBinary, stagedDestination);

            if (process.platform !== 'win32') {
                fs.chmodSync(stagedDestination, 0o755);
            }

            verifyBinaryVersion(stagedDestination, version, platform);
            if (process.platform === 'win32' && fs.existsSync(destination)) {
                fs.rmSync(destination, { force: true });
            }
            fs.renameSync(stagedDestination, destination);
        } finally {
            fs.rmSync(stagedDestination, { force: true });
        }
        const binaryDigest = `sha256:${sha256(destination)}`;
        fs.writeFileSync(
            path.join(installDir, 'manifest.json'),
            `${JSON.stringify(
                { version, platform: downloadPlatform, archiveChecksum: checksum, binaryChecksum: binaryDigest },
                null,
                2,
            )}\n`,
        );
        console.log(`Installed ${destination}`);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
    const { retries, platform: explicitPlatform } = parseArgs();
    const platform = detectPlatform(explicitPlatform);
    const { version, checksum } = readApkManifest(platform);

    let lastError;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            await installApk(version, checksum, platform);
            lastError = undefined;
            break;
        } catch (error) {
            lastError = error;
            console.error(
                `apk attempt ${attempt}/${retries} failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    if (lastError) {
        throw lastError;
    }
}

await main();
