import * as path from 'path';
import * as fs from '../../client/common/platform/fs-paths';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../constants';

export function getSupervisorExtensionDevelopmentPath(): string {
    const configuredPath = process.env.CODE_SUPERVISOR_PATH ?? '../vscode-supervisor';
    const resolvedPath = path.resolve(EXTENSION_ROOT_DIR_FOR_TESTS, configuredPath);
    const manifestPath = path.join(resolvedPath, 'package.json');

    if (!fs.pathExistsSync(manifestPath)) {
        throw new Error(
            `vscode-supervisor extension manifest not found: ${manifestPath}. ` +
                'Set CODE_SUPERVISOR_PATH to the supervisor repository path.',
        );
    }

    console.info(`Loading vscode-supervisor from ${resolvedPath}`);
    return resolvedPath;
}
