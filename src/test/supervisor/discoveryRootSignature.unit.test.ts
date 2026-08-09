import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { computeRootSignatureEntries } from '../../client/supervisor/discoveryRootSignature';

suite('Python Supervisor - Discovery Root Signature', () => {
    test('retains absent roots and deduplicates resolved symlinks', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'python-root-signature-'));
        const target = path.join(tempDir, 'python-3.13');
        const current = path.join(tempDir, 'current');
        const absent = path.join(tempDir, 'future');
        fs.mkdirSync(target);
        fs.symlinkSync(target, current, 'dir');

        const entries = computeRootSignatureEntries([current, target, absent]);

        expect(entries).to.have.length(2);
        expect(entries[0]).to.include({ path: fs.realpathSync(target), exists: true });
        expect(entries[1]).to.deep.equal({ path: absent, exists: false, mtimeMs: 0 });
        fs.rmSync(tempDir, { recursive: true, force: true });
    });
});
