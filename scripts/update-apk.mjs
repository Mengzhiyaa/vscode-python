/**
 * Updates the pinned APK version and archive SHA-256 checksums from GitHub Releases.
 * Usage: npm run update:apk -- [--version <version>] [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const defaultPackagePath = path.resolve(path.dirname(scriptPath), '..', 'package.json');
const releaseApi = 'https://api.github.com/repos/Mengzhiyaa/apk-build/releases';
const versionPattern = /^\d+\.\d+\.\d+$/;

function parseArgs(args) {
    const options = {};
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--version') {
            options.version = args[++index];
            if (!versionPattern.test(options.version ?? '')) {
                throw new Error('--version requires a release version such as 0.1.2');
            }
        } else if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return options;
}

export async function updateApk({
    version,
    dryRun = false,
    packagePath = defaultPackagePath,
    fetchRelease = fetch,
} = {}) {
    if (version !== undefined && !versionPattern.test(version)) {
        throw new Error('APK version must have the form 0.1.2');
    }

    const original = fs.readFileSync(packagePath, 'utf8');
    const pkg = JSON.parse(original);
    const currentVersion = pkg.positron?.binaryDependencies?.apk;
    const currentChecksums = pkg.positron?.binaryChecksums?.apk;
    if (!currentVersion || !currentChecksums || !Object.keys(currentChecksums).length) {
        throw new Error('Missing APK version or platform checksums in package.json');
    }

    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'vscode-python-update-apk' };
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    const url = `${releaseApi}/${version ? `tags/${version}` : 'latest'}`;
    const response = await fetchRelease(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
        throw new Error(`GitHub release request failed: HTTP ${response.status} (${url})`);
    }
    const release = await response.json();
    const nextVersion = release.tag_name;
    if (
        release.draft !== false ||
        release.prerelease !== false ||
        !versionPattern.test(nextVersion ?? '') ||
        (version && nextVersion !== version)
    ) {
        throw new Error('Expected a published stable APK release with a matching version tag');
    }
    if (!Array.isArray(release.assets)) {
        throw new Error('GitHub release is missing its assets');
    }

    const nextChecksums = {};
    for (const platform of Object.keys(currentChecksums)) {
        const name = `apk-${nextVersion}-${platform}.zip`;
        const matches = release.assets.filter((asset) => asset.name === name);
        if (matches.length !== 1 || matches[0].state !== 'uploaded') {
            throw new Error(`Expected exactly one uploaded release asset: ${name}`);
        }
        const digest = matches[0].digest;
        if (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(digest)) {
            throw new Error(`Missing or invalid SHA-256 digest for ${name}; package.json was not changed`);
        }
        nextChecksums[platform] = digest.toLowerCase();
    }

    pkg.positron.binaryDependencies.apk = nextVersion;
    pkg.positron.binaryChecksums.apk = nextChecksums;
    const changed = JSON.stringify(JSON.parse(original)) !== JSON.stringify(pkg);
    console.log(`APK ${currentVersion} -> ${nextVersion}`);
    for (const [platform, digest] of Object.entries(nextChecksums)) {
        console.log(`  ${platform}: ${digest}`);
    }
    if (dryRun || !changed) {
        console.log(
            dryRun ? 'Dry run: package.json was not changed.' : 'APK version and checksums are already current.',
        );
        return;
    }

    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    const updated = `${JSON.stringify(pkg, null, 4)}\n`.replace(/\n/g, eol);
    const stagedPath = `${packagePath}.apk-update-${process.pid}.tmp`;
    fs.writeFileSync(stagedPath, updated, { flag: 'wx' });
    try {
        fs.renameSync(stagedPath, packagePath);
    } finally {
        fs.rmSync(stagedPath, { force: true });
    }
    console.log('Updated package.json. Run npm run install:apk to install the updated kernel.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
    try {
        const options = parseArgs(process.argv.slice(2));
        if (options.help) {
            console.log('Usage: npm run update:apk -- [--version <version>] [--dry-run]');
        } else {
            await updateApk(options);
        }
    } catch (error) {
        console.error(`APK update failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    }
}
