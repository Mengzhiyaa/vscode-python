// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IWorkspaceService } from '../../common/application/types';
import { IFileSystem } from '../../common/platform/types';
import { IPythonExecutionFactory, IPythonExecutionService } from '../../common/process/types';
import { ITerminalServiceFactory } from '../../common/terminal/types';
import { IServiceContainer } from '../../ioc/types';
import type { LanguageRuntimePackage, PackageSpec } from '../types/supervisor-api';
import { KernelPackageRpc } from './kernelPackageRpc';
import { fetchMetadataWithOutdated } from './packageMetadata';
import { searchPyPI, searchPyPIVersions } from './pypiSearch';
import { buildRequirementsFile } from './requirementsFile';
import type { IPackageManager, PackageSession } from './types';
import { findWorkspaceRequirementsFile, USE_REQUIREMENTS_FILE_SETTING } from './workspaceRequirements';

interface OutdatedPackage {
    name: string;
    latest_version: string;
}

export class PipPackageManager implements IPackageManager {
    private readonly _kernelRpc: KernelPackageRpc;
    private _pythonService: IPythonExecutionService | undefined;

    constructor(
        private readonly _pythonPath: string,
        private readonly _serviceContainer: IServiceContainer,
        session: PackageSession,
        private readonly _logChannel: vscode.LogOutputChannel,
    ) {
        this._kernelRpc = new KernelPackageRpc(session, this._logChannel);
    }

    getPackages(token?: vscode.CancellationToken): Promise<LanguageRuntimePackage[]> {
        return this._kernelRpc.call<LanguageRuntimePackage[]>('getPackagesInstalled', token);
    }

    getPackageMetadata(
        packageNames: string[],
        token?: vscode.CancellationToken,
    ): Promise<Map<string, Partial<LanguageRuntimePackage>>> {
        return fetchMetadataWithOutdated(
            packageNames,
            (currentToken) => this._getOutdatedVersions(currentToken),
            this._logChannel,
            token,
        );
    }

    async isPipAvailable(): Promise<boolean> {
        try {
            return await (await this._getPythonService()).isModuleInstalled('pip');
        } catch {
            return false;
        }
    }

    async installPackages(packages: PackageSpec[], token?: vscode.CancellationToken): Promise<void> {
        this._throwIfCancelled(token);
        if (packages.length === 0) {
            return;
        }
        await this._ensurePip();
        const requirementsPath = await this._getWorkspaceRequirementsPath();
        if (requirementsPath) {
            await this._executePipInTerminal(
                ['install', ...this._formatPackageSpecs(packages), '-r', requirementsPath, ...this._getProxyFlags()],
                token,
            );
            return;
        }
        await this._installFromFrozenEnvironment(packages, false, token);
    }

    async uninstallPackages(packageNames: string[], token?: vscode.CancellationToken): Promise<void> {
        this._throwIfCancelled(token);
        if (packageNames.length === 0) {
            return;
        }
        await this._ensurePip();
        await this._executePipInTerminal(['uninstall', '-y', ...packageNames], token);
    }

    async updatePackages(packages: PackageSpec[], token?: vscode.CancellationToken): Promise<void> {
        this._throwIfCancelled(token);
        if (packages.length === 0) {
            return;
        }
        const missingVersion = packages.find((pkg) => !pkg.version);
        if (missingVersion) {
            throw new Error(`A version is required to update '${missingVersion.name}'.`);
        }
        await this._ensurePip();
        const requirementsPath = await this._getWorkspaceRequirementsPath();
        if (requirementsPath) {
            await this._executePipInTerminal(
                ['install', ...this._formatPackageSpecs(packages), '-r', requirementsPath, ...this._getProxyFlags()],
                token,
            );
            return;
        }
        await this._installFromFrozenEnvironment(packages, false, token);
    }

    async updateAllPackages(token?: vscode.CancellationToken): Promise<void> {
        this._throwIfCancelled(token);
        await this._ensurePip();
        const outdated = await this._getOutdatedPackages(token);
        if (outdated.length === 0) {
            this._logChannel.info('[Python Packages] All packages are up to date.');
            return;
        }
        const requirementsPath = await this._getWorkspaceRequirementsPath();
        if (requirementsPath) {
            await this._executePipInTerminal(
                ['install', '--upgrade', '-r', requirementsPath, ...this._getProxyFlags()],
                token,
            );
            return;
        }
        await this._installFromFrozenEnvironment([], true, token);
    }

    searchPackages(query: string, token?: vscode.CancellationToken): Promise<LanguageRuntimePackage[]> {
        return searchPyPI(query, token);
    }

    searchPackageVersions(name: string, token?: vscode.CancellationToken): Promise<string[]> {
        return searchPyPIVersions(
            name,
            (specs) => this._kernelRpc.call<Record<string, boolean>>('checkRequiresPython', token, specs),
            token,
        );
    }

    private async _getPythonService(): Promise<IPythonExecutionService> {
        this._pythonService ??= await this._serviceContainer
            .get<IPythonExecutionFactory>(IPythonExecutionFactory)
            .create({ pythonPath: this._pythonPath });
        return this._pythonService;
    }

    private async _getOutdatedVersions(token?: vscode.CancellationToken): Promise<Map<string, string>> {
        if (!(await this.isPipAvailable())) {
            return new Map();
        }
        const packages = await this._getOutdatedPackages(token);
        return new Map(packages.map((pkg) => [pkg.name.toLowerCase(), pkg.latest_version]));
    }

    private async _getOutdatedPackages(token?: vscode.CancellationToken): Promise<OutdatedPackage[]> {
        const result = await (
            await this._getPythonService()
        ).execModule('pip', ['list', '--outdated', '--format=json', '--no-color', ...this._getProxyFlags()], { token });
        const parsed = JSON.parse(result.stdout) as unknown;
        if (!Array.isArray(parsed)) {
            throw new Error('Expected pip outdated output to be an array.');
        }
        return parsed.map((entry, index) => {
            if (!entry || typeof entry !== 'object') {
                throw new Error(`Expected pip outdated entry ${index} to be an object.`);
            }
            const { name, latest_version: latestVersion } = entry as Record<string, unknown>;
            if (typeof name !== 'string' || typeof latestVersion !== 'string') {
                throw new Error(`Expected pip outdated entry ${index} to contain name and latest_version.`);
            }
            return { name, latest_version: latestVersion };
        });
    }

    private _formatPackageSpecs(packages: PackageSpec[]): string[] {
        return packages.map((pkg) => (pkg.version ? `${pkg.name}==${pkg.version}` : pkg.name));
    }

    private async _getWorkspaceRequirementsPath(): Promise<string | undefined> {
        if (
            vscode.workspace.getConfiguration?.('python')?.get<boolean>(USE_REQUIREMENTS_FILE_SETTING, true) === false
        ) {
            return undefined;
        }
        return findWorkspaceRequirementsFile(
            this._serviceContainer.get<IWorkspaceService>(IWorkspaceService),
            this._serviceContainer.get<IFileSystem>(IFileSystem),
        );
    }

    private async _getInstalledFreeze(token?: vscode.CancellationToken): Promise<string[]> {
        const result = await (await this._getPythonService()).execModule('pip', ['freeze', '--no-color'], { token });
        return result.stdout ? result.stdout.split(/\r?\n/).filter((line) => line.trim()) : [];
    }

    private async _installFromFrozenEnvironment(
        targets: PackageSpec[],
        upgrade: boolean,
        token?: vscode.CancellationToken,
    ): Promise<void> {
        const content = buildRequirementsFile(await this._getInstalledFreeze(token), targets);
        const fileSystem = this._serviceContainer.get<IFileSystem>(IFileSystem);
        const temporaryFile = await fileSystem.createTemporaryFile('.txt');
        try {
            await fileSystem.writeFile(temporaryFile.filePath, content);
            this._logChannel.debug(`[Python Packages] Resolver requirements '${temporaryFile.filePath}':\n${content}`);
            await this._executePipInTerminal(
                ['install', ...(upgrade ? ['--upgrade'] : []), '-r', temporaryFile.filePath, ...this._getProxyFlags()],
                token,
            );
        } finally {
            temporaryFile.dispose();
        }
    }

    private async _ensurePip(): Promise<void> {
        if (!(await this.isPipAvailable())) {
            throw new Error(
                'pip is not available in this Python environment. Please install pip to use package management features.',
            );
        }
    }

    private _getProxyFlags(): string[] {
        const proxy = vscode.workspace.getConfiguration?.('http')?.get<string>('proxy', '');
        return proxy ? ['--proxy', proxy] : [];
    }

    private async _executePipInTerminal(args: string[], token?: vscode.CancellationToken): Promise<void> {
        const terminal = this._serviceContainer
            .get<ITerminalServiceFactory>(ITerminalServiceFactory)
            .getTerminalService({ title: 'Python Packages' });
        await terminal.show();
        const cancellation = token?.onCancellationRequested(() => {
            void terminal.sendText('\x03');
        });
        try {
            await terminal.sendCommand(this._pythonPath, ['-m', 'pip', ...args], token, false);
        } finally {
            cancellation?.dispose();
        }
    }

    private _throwIfCancelled(token?: vscode.CancellationToken): void {
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
    }
}
