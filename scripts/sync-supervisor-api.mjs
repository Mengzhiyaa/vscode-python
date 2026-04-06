import fs from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const sourceRootArg = args.find((arg) => !arg.startsWith('--'));
const sourceRepoRoot = path.resolve(
    repoRoot,
    sourceRootArg ?? process.env.SUPERVISOR_REPO_PATH ?? '../vscode-supervisor',
);

const sourcePath = path.join(sourceRepoRoot, 'src', 'api.d.ts');
const targetPath = path.join(repoRoot, 'src', 'client', 'supervisor', 'types', 'supervisor-api.d.ts');

if (!fs.existsSync(sourcePath)) {
    throw new Error(`Supervisor API declaration not found: ${sourcePath}`);
}

const sourceContents = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');
const targetContents = fs.existsSync(targetPath)
    ? fs.readFileSync(targetPath, 'utf8').replace(/\r\n/g, '\n')
    : undefined;

if (checkOnly) {
    if (targetContents !== sourceContents) {
        throw new Error(
            [
                'src/client/supervisor/types/supervisor-api.d.ts is out of sync with supervisor src/api.d.ts.',
                `Source: ${sourcePath}`,
                `Target: ${targetPath}`,
                'Run `npm run sync:supervisor-api -- ../vscode-supervisor` to update it.',
            ].join('\n'),
        );
    }

    console.log(`Supervisor API types are in sync: ${targetPath}`);
    process.exit(0);
}

fs.mkdirSync(path.dirname(targetPath), { recursive: true });
fs.writeFileSync(targetPath, sourceContents);
console.log(`Copied ${sourcePath} -> ${targetPath}`);
