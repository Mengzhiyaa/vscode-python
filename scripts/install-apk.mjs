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
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

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
        return explicitPlatform;
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

function readApkVersion() {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const version = pkg?.positron?.binaryDependencies?.apk;
    if (!version) {
        throw new Error('Missing positron.binaryDependencies.apk in package.json');
    }
    return version;
}

// ---------------------------------------------------------------------------
// Download & extraction
// ---------------------------------------------------------------------------

function download(url, destination) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(destination);

        const request = (currentUrl, redirectCount) => {
            if (redirectCount > 5) {
                reject(new Error(`Too many redirects for ${url}`));
                return;
            }

            const protocol = currentUrl.startsWith('https') ? https : http;
            protocol.get(currentUrl, (response) => {
                if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    response.resume();
                    request(response.headers.location, redirectCount + 1);
                    return;
                }

                if (response.statusCode !== 200) {
                    response.resume();
                    reject(new Error(`Download failed for ${currentUrl}: HTTP ${response.statusCode}`));
                    return;
                }

                response.pipe(output);
                output.on('finish', () => {
                    output.close();
                    resolve();
                });
            }).on('error', reject);
        };

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

async function installApk(version, platform) {
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
        extractZip(archivePath, extractDir);

        const extractedBinary = findFile(extractDir, executableName);
        if (!extractedBinary) {
            throw new Error(`Could not find ${executableName} in extracted archive`);
        }

        fs.mkdirSync(installDir, { recursive: true });
        const destination = path.join(installDir, executableName);
        fs.copyFileSync(extractedBinary, destination);

        if (process.platform !== 'win32') {
            fs.chmodSync(destination, 0o755);
        }

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
    const version = readApkVersion();

    let lastError;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            await installApk(version, platform);
            lastError = undefined;
            break;
        } catch (error) {
            lastError = error;
            console.error(`apk attempt ${attempt}/${retries} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    if (lastError) {
        throw lastError;
    }
}

await main();
