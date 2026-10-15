import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { updateApk } from './update-apk.mjs';

function fixture(t) {
    t.mock.method(console, 'log', () => {});
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'update-apk-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const packagePath = path.join(directory, 'package.json');
    const platforms = [
        'darwin-arm64',
        'darwin-universal',
        'darwin-x64',
        'linux-arm64',
        'linux-x64',
        'windows-arm64',
        'windows-x64',
    ];
    const pkg = {
        name: 'python',
        version: '2026.11.0',
        positron: {
            binaryDependencies: { apk: '0.1.1', other: '1.0.0' },
            binaryChecksums: { apk: Object.fromEntries(platforms.map((platform) => [platform, 'old'])) },
        },
        scripts: { 'install:apk': 'node scripts/install-apk.mjs' },
    };
    const original = `${JSON.stringify(pkg, null, 4)}\n`;
    fs.writeFileSync(packagePath, original);
    const release = {
        tag_name: '0.1.2',
        draft: false,
        prerelease: false,
        assets: platforms.map((platform, index) => ({
            name: `apk-0.1.2-${platform}.zip`,
            state: 'uploaded',
            digest: `sha256:${String(index + 1).repeat(64)}`,
        })),
    };
    const fetchRelease = async () => ({ ok: true, json: async () => release });
    return { packagePath, original, release, fetchRelease, pkg, directory };
}

test('updates all seven archive digests and only changes the APK fields', async (t) => {
    const { packagePath, release, pkg, fetchRelease, directory } = fixture(t);
    await updateApk({ packagePath, fetchRelease });
    const actual = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    pkg.positron.binaryDependencies.apk = release.tag_name;
    Object.keys(pkg.positron.binaryChecksums.apk).forEach((platform, index) => {
        pkg.positron.binaryChecksums.apk[platform] = release.assets[index].digest;
    });
    assert.deepEqual(actual, pkg);
    assert.deepEqual(fs.readdirSync(directory), ['package.json']);

    const updated = fs.readFileSync(packagePath, 'utf8');
    const modifiedAt = fs.statSync(packagePath).mtimeMs;
    await updateApk({ packagePath, fetchRelease });
    assert.equal(fs.readFileSync(packagePath, 'utf8'), updated);
    assert.equal(fs.statSync(packagePath).mtimeMs, modifiedAt);
});

test('dry run fetches the latest release without changing the file', async (t) => {
    const { packagePath, original, release } = fixture(t);
    await updateApk({
        packagePath,
        dryRun: true,
        fetchRelease: async (url, options) => {
            assert.equal(url, 'https://api.github.com/repos/Mengzhiyaa/apk-build/releases/latest');
            assert.ok(options.signal instanceof AbortSignal);
            return { ok: true, json: async () => release };
        },
    });
    assert.equal(fs.readFileSync(packagePath, 'utf8'), original);
});

test('explicit version uses the tag endpoint and preserves CRLF', async (t) => {
    const { packagePath, original, release } = fixture(t);
    fs.writeFileSync(packagePath, original.replace(/\n/g, '\r\n'));
    await updateApk({
        packagePath,
        version: '0.1.2',
        fetchRelease: async (url) => {
            assert.equal(url, 'https://api.github.com/repos/Mengzhiyaa/apk-build/releases/tags/0.1.2');
            return { ok: true, json: async () => release };
        },
    });
    assert.ok(!/(?<!\r)\n/.test(fs.readFileSync(packagePath, 'utf8')));
});

const invalidReleases = [
    ['missing platform archive', (release) => release.assets.pop()],
    ['missing digest', (release) => delete release.assets[6].digest],
    ['invalid digest', (release) => (release.assets[6].digest = 'sha256:123')],
    ['duplicate archive', (release) => release.assets.push({ ...release.assets[6] })],
    ['unfinished upload', (release) => (release.assets[6].state = 'new')],
    ['draft release', (release) => (release.draft = true)],
    ['prerelease', (release) => (release.prerelease = true)],
    ['invalid version tag', (release) => (release.tag_name = 'v0.1.2')],
    ['wrong requested version', (release) => (release.tag_name = '0.1.3')],
];

for (const [label, invalidate] of invalidReleases) {
    test(`rejects ${label} without partially updating package.json`, async (t) => {
        const { packagePath, original, release, fetchRelease, directory } = fixture(t);
        invalidate(release);
        await assert.rejects(updateApk({ packagePath, version: '0.1.2', fetchRelease }));
        assert.equal(fs.readFileSync(packagePath, 'utf8'), original);
        assert.deepEqual(fs.readdirSync(directory), ['package.json']);
    });
}

test('HTTP and network errors leave package.json unchanged', async (t) => {
    const { packagePath, original } = fixture(t);
    await assert.rejects(
        updateApk({ packagePath, fetchRelease: async () => ({ ok: false, status: 403 }) }),
        /HTTP 403/,
    );
    await assert.rejects(
        updateApk({
            packagePath,
            fetchRelease: async () => {
                throw new Error('connection failed');
            },
        }),
        /connection failed/,
    );
    assert.equal(fs.readFileSync(packagePath, 'utf8'), original);
});

test('CLI rejects unknown flags and missing versions before accessing the network', () => {
    const scriptPath = fileURLToPath(new URL('./update-apk.mjs', import.meta.url));
    for (const args of [['--unknown'], ['--version'], ['--version', '../latest']]) {
        const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /APK update failed:/);
    }
});
