import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { IInterpreterService } from '../interpreter/contracts';
import { EnvironmentType, PythonEnvironment } from '../pythonEnvironments/info';
import { createApkKernelSpec } from './kernelSpec';
import { PythonLanguageLspFactory } from './pythonLsp';
import type {
    ILanguageInstallationPickerOptions,
    ILanguageRuntimeProvider,
    JupyterKernelSpec,
    LanguageRuntimeMetadata,
    LanguageSessionMode,
} from './types/supervisor-api';

export const PYTHON_LANGUAGE_ID = 'python';

export interface PythonRuntimeInstallation {
    pythonPath: string;
    displayName?: string;
    envName?: string;
    envPath?: string;
    envType: EnvironmentType;
    sysPrefix?: string;
    version?: string;
    architecture?: string;
}

type PythonRuntimeExtraData = {
    installation: PythonRuntimeInstallation;
};

type InterpreterQuickPickItem = vscode.QuickPickItem & {
    installation?: PythonRuntimeInstallation;
    browse?: boolean;
};

const RUNTIME_SESSION_LOCATION = {
    Workspace: 'workspace' as NonNullable<LanguageRuntimeMetadata['sessionLocation']>,
} as const;

const RUNTIME_STARTUP_BEHAVIOR = {
    Immediate: 'immediate' as NonNullable<LanguageRuntimeMetadata['startupBehavior']>,
    Implicit: 'implicit' as NonNullable<LanguageRuntimeMetadata['startupBehavior']>,
} as const;

function comparePaths(left: string, right: string): boolean {
    const normalizedLeft = process.platform === 'win32' ? path.normalize(left).toLowerCase() : path.normalize(left);
    const normalizedRight = process.platform === 'win32' ? path.normalize(right).toLowerCase() : path.normalize(right);
    return normalizedLeft === normalizedRight;
}

function getSourceLabel(envType: EnvironmentType): string {
    return envType.toLowerCase();
}

function getVersionString(interpreter: PythonEnvironment): string | undefined {
    return interpreter.version?.raw ?? interpreter.sysVersion?.split(' ')[0];
}

function getInstallationLabel(installation: PythonRuntimeInstallation): string | undefined {
    const candidate = installation.envName ?? installation.displayName;
    if (candidate && candidate.trim().length > 0) {
        return candidate.trim();
    }

    if (installation.envPath) {
        return path.basename(installation.envPath);
    }

    return undefined;
}

export class PythonRuntimeProvider implements ILanguageRuntimeProvider<PythonRuntimeInstallation> {
    readonly languageId = PYTHON_LANGUAGE_ID;
    readonly languageName = 'Python';
    readonly lspFactory = new PythonLanguageLspFactory();

    private _activeInterpreterPath: string | undefined;

    constructor(
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _interpreterService: IInterpreterService,
    ) {}

    async *discoverInstallations(
        logChannel: vscode.LogOutputChannel,
    ): AsyncGenerator<PythonRuntimeInstallation> {
        await this.refreshInterpreters(logChannel);
        for (const interpreter of this.listInterpreterEnvironments()) {
            yield this.installationFromEnvironment(interpreter);
        }
    }

    async resolveInitialInstallation(
        logChannel: vscode.LogOutputChannel,
    ): Promise<PythonRuntimeInstallation | undefined> {
        await this.refreshInterpreters(logChannel);
        const resource = this.getPrimaryWorkspaceUri();
        const activeInterpreter = await this._interpreterService.getActiveInterpreter(resource);
        if (activeInterpreter) {
            return this.installationFromEnvironment(activeInterpreter);
        }

        const [firstInterpreter] = this.listInterpreterEnvironments();
        return firstInterpreter ? this.installationFromEnvironment(firstInterpreter) : undefined;
    }

    async resolveActiveInstallation(
        logChannel: vscode.LogOutputChannel,
        resource?: vscode.Uri,
    ): Promise<PythonRuntimeInstallation | undefined> {
        await this.refreshInterpreters(logChannel, resource);
        const activeInterpreter = await this._interpreterService.getActiveInterpreter(resource);
        return activeInterpreter ? this.installationFromEnvironment(activeInterpreter) : undefined;
    }

    async promptForInstallation(
        logChannel: vscode.LogOutputChannel,
        options: ILanguageInstallationPickerOptions = {},
    ): Promise<PythonRuntimeInstallation | undefined> {
        await this.refreshInterpreters(logChannel);
        const preselectedPath = options.preselectRuntimePath;
        const items: InterpreterQuickPickItem[] = this.listInterpreterEnvironments().map((interpreter) => {
            const installation = this.installationFromEnvironment(interpreter);
            const sourceLabel = getSourceLabel(installation.envType);
            const version = installation.version ?? 'Unknown';
            const label = installation.displayName ?? installation.envName ?? path.basename(installation.pythonPath);
            return {
                label,
                description: `${version} • ${sourceLabel}`,
                detail: installation.pythonPath,
                picked: preselectedPath ? comparePaths(installation.pythonPath, preselectedPath) : false,
                installation,
            };
        });

        if (options.allowBrowse !== false) {
            items.push({
                label: 'Browse for interpreter...',
                description: 'Select a Python executable manually',
                browse: true,
            });
        }

        const selection = await vscode.window.showQuickPick(items, {
            ignoreFocusOut: true,
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: options.placeHolder ?? 'Select a Python interpreter for the supervisor runtime',
            title: options.title,
        });
        if (!selection) {
            return undefined;
        }

        if (selection.browse) {
            return this.browseForInstallation();
        }

        return selection.installation;
    }

    formatRuntimeName(installation: PythonRuntimeInstallation): string {
        return `Python ${this.getRuntimeShortName(installation)}`;
    }

    getRuntimePath(installation: PythonRuntimeInstallation): string {
        return installation.pythonPath;
    }

    getRuntimeSource(installation: PythonRuntimeInstallation): string {
        return getSourceLabel(installation.envType);
    }

    createRuntimeMetadata(
        _context: vscode.ExtensionContext,
        installation: PythonRuntimeInstallation,
        _logChannel: vscode.LogOutputChannel,
    ): LanguageRuntimeMetadata {
        const runtimeShortName = this.getRuntimeShortName(installation);
        return {
            runtimeId: this.createRuntimeId(installation),
            runtimeName: `Python ${runtimeShortName}`,
            runtimeShortName,
            runtimePath: installation.pythonPath,
            runtimeVersion: this.getExtensionVersion(),
            runtimeSource: this.getRuntimeSource(installation),
            languageId: this.languageId,
            languageName: this.languageName,
            languageVersion: installation.version ?? '0.0.0',
            startupBehavior: this.isActiveInstallation(installation)
                ? RUNTIME_STARTUP_BEHAVIOR.Immediate
                : RUNTIME_STARTUP_BEHAVIOR.Implicit,
            sessionLocation: RUNTIME_SESSION_LOCATION.Workspace,
            extraRuntimeData: {
                installation,
            } satisfies PythonRuntimeExtraData,
        };
    }

    createKernelSpec(
        context: vscode.ExtensionContext,
        installation: PythonRuntimeInstallation,
        sessionMode: LanguageSessionMode,
        logChannel: vscode.LogOutputChannel,
    ): Promise<JupyterKernelSpec> {
        return createApkKernelSpec(context, installation, sessionMode, logChannel);
    }

    restoreInstallationFromMetadata(metadata: LanguageRuntimeMetadata): PythonRuntimeInstallation | undefined {
        const extraRuntimeData = metadata.extraRuntimeData as PythonRuntimeExtraData | undefined;
        if (extraRuntimeData?.installation?.pythonPath) {
            return extraRuntimeData.installation;
        }

        if (!metadata.runtimePath) {
            return undefined;
        }

        return {
            pythonPath: metadata.runtimePath,
            envType: EnvironmentType.Unknown,
            version: metadata.languageVersion,
        };
    }

    async validateMetadata(metadata: LanguageRuntimeMetadata): Promise<LanguageRuntimeMetadata> {
        const installation = this.restoreInstallationFromMetadata(metadata);
        if (!installation) {
            throw new Error('Python supervisor metadata is missing interpreter details.');
        }
        if (!fs.existsSync(installation.pythonPath)) {
            throw new Error(`Python interpreter does not exist: ${installation.pythonPath}`);
        }

        return metadata;
    }

    async shouldRecommendForWorkspace(): Promise<boolean> {
        const globs = [
            '**/*.py',
            'pyproject.toml',
            'requirements.txt',
            'setup.py',
            'Pipfile',
            '.venv',
            '.conda',
        ];
        const glob = `{${globs.join(',')}}`;
        return (await vscode.workspace.findFiles(glob, '**/node_modules/**', 1)).length > 0;
    }

    getSessionIdPrefix(): string {
        return 'py';
    }

    installationFromEnvironment(interpreter: PythonEnvironment): PythonRuntimeInstallation {
        return {
            pythonPath: interpreter.path,
            displayName: interpreter.displayName,
            envName: interpreter.envName,
            envPath: interpreter.envPath,
            envType: interpreter.envType,
            sysPrefix: interpreter.sysPrefix,
            version: getVersionString(interpreter),
            architecture: String(interpreter.architecture),
        };
    }

    isActiveInstallation(installation: PythonRuntimeInstallation): boolean {
        return !!this._activeInterpreterPath && comparePaths(installation.pythonPath, this._activeInterpreterPath);
    }

    async refreshInterpreters(logChannel: vscode.LogOutputChannel, resource?: vscode.Uri): Promise<void> {
        try {
            await this._interpreterService.refresh(resource);
        } catch (error) {
            logChannel.warn(`[Python Supervisor] Failed to refresh interpreters: ${error}`);
        }

        try {
            const activeInterpreter = await this._interpreterService.getActiveInterpreter(resource ?? this.getPrimaryWorkspaceUri());
            this._activeInterpreterPath = activeInterpreter?.path;
        } catch (error) {
            logChannel.warn(`[Python Supervisor] Failed to resolve active interpreter: ${error}`);
        }
    }

    private async browseForInstallation(): Promise<PythonRuntimeInstallation | undefined> {
        const selection = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: process.platform === 'win32'
                ? { Python: ['exe'] }
                : undefined,
            openLabel: 'Use Interpreter',
            title: 'Select Python interpreter',
        });
        const interpreterUri = selection?.[0];
        if (!interpreterUri) {
            return undefined;
        }

        const interpreter = await this._interpreterService.getInterpreterDetails(
            interpreterUri.fsPath,
            this.getPrimaryWorkspaceUri(),
        );
        return interpreter ? this.installationFromEnvironment(interpreter) : undefined;
    }

    private createRuntimeId(installation: PythonRuntimeInstallation): string {
        const digest = crypto.createHash('sha256');
        digest.update(installation.pythonPath);
        digest.update(installation.version ?? '');
        return digest.digest('hex').substring(0, 32);
    }

    private getExtensionVersion(): string {
        const packageJson = this._extensionContext.extension.packageJSON as { version?: string } | undefined;
        return packageJson?.version ?? '0.0.1';
    }

    private getRuntimeShortName(installation: PythonRuntimeInstallation): string {
        const parts = [installation.version ?? 'Unknown'];
        const sourceLabel = getSourceLabel(installation.envType);
        const installationLabel = getInstallationLabel(installation);
        if (sourceLabel || installationLabel) {
            const suffix = installationLabel && installationLabel !== installation.version
                ? `${sourceLabel}: ${installationLabel}`
                : sourceLabel;
            parts.push(`(${suffix})`);
        }
        return parts.join(' ');
    }

    private getPrimaryWorkspaceUri(): vscode.Uri | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri;
    }

    private listInterpreterEnvironments(): PythonEnvironment[] {
        const interpreters = this._interpreterService.getInterpreters(this.getPrimaryWorkspaceUri());
        const unique = new Map<string, PythonEnvironment>();
        for (const interpreter of interpreters) {
            if (interpreter.path) {
                unique.set(process.platform === 'win32' ? interpreter.path.toLowerCase() : interpreter.path, interpreter);
            }
        }
        return Array.from(unique.values()).sort((left, right) => {
            if (this._activeInterpreterPath && comparePaths(left.path, this._activeInterpreterPath)) {
                return -1;
            }
            if (this._activeInterpreterPath && comparePaths(right.path, this._activeInterpreterPath)) {
                return 1;
            }
            return left.path.localeCompare(right.path);
        });
    }
}
