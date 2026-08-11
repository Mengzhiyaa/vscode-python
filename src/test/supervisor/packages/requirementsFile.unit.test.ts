// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { expect } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { IWorkspaceService } from '../../../client/common/application/types';
import { IFileSystem } from '../../../client/common/platform/types';
import {
    buildRequirementsFile,
    extractRequirementName,
    normalizePackageName,
} from '../../../client/supervisor/packages/requirementsFile';
import { findWorkspaceRequirementsFile } from '../../../client/supervisor/packages/workspaceRequirements';

suite('Python Supervisor - Requirements Files', () => {
    teardown(() => sinon.restore());

    test('normalizes package names and extracts plain requirement names', () => {
        expect(normalizePackageName('Foo--_.Bar')).to.equal('foo-bar');
        expect(extractRequirementName('Werkzeug==2.0.3')).to.equal('Werkzeug');
        expect(extractRequirementName('pkg @ file:///tmp/pkg')).to.equal('pkg');
        for (const line of ['', '# comment', '--index-url https://example.com', '-e /tmp/pkg']) {
            expect(extractRequirementName(line)).to.equal(undefined);
        }
    });

    test('builds a resolver file with pinned targets and preserved origins', () => {
        expect(
            buildRequirementsFile(
                [
                    'flask==2.2.0',
                    'Typing_Extensions==4.0.0',
                    'local @ file:///tmp/local',
                    '-e /tmp/editable',
                    'pkg-resources==0.0.0',
                ],
                [
                    { name: 'typing-extensions', version: '4.9.0' },
                    { name: 'requests', version: '2.31.0' },
                ],
            ),
        ).to.equal(
            [
                'flask',
                'typing-extensions==4.9.0',
                'local @ file:///tmp/local',
                '-e /tmp/editable',
                'requests==2.31.0',
                '',
            ].join('\n'),
        );
    });

    test('uses bare names for update-all resolver input', () => {
        expect(buildRequirementsFile(['flask==2.2.0', 'werkzeug==2.0.3'], [])).to.equal('flask\nwerkzeug\n');
    });

    test('finds requirements.txt only in the first workspace root', async () => {
        const workspace = {
            workspaceFolders: [{ uri: vscode.Uri.file('/workspace'), name: 'workspace', index: 0 }],
        } as unknown as IWorkspaceService;
        const expected = path.join('/workspace', 'requirements.txt');
        const fileSystem = { fileExists: sinon.stub().withArgs(expected).resolves(true) } as unknown as IFileSystem;

        expect(await findWorkspaceRequirementsFile(workspace, fileSystem)).to.equal(expected);
    });
});
