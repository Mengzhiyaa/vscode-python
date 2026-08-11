// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as path from 'path';
import { IWorkspaceService } from '../../common/application/types';
import { IFileSystem } from '../../common/platform/types';

export const USE_REQUIREMENTS_FILE_SETTING = 'packageManager.useRequirementsFile';

export async function findWorkspaceRequirementsFile(
    workspaceService: IWorkspaceService,
    fileSystem: IFileSystem,
): Promise<string | undefined> {
    const workspace = workspaceService.workspaceFolders?.[0];
    if (!workspace) {
        return undefined;
    }
    const candidate = path.join(workspace.uri.fsPath, 'requirements.txt');
    return (await fileSystem.fileExists(candidate)) ? candidate : undefined;
}
