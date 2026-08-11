// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IProcessServiceFactory } from '../../common/process/types';
import { ITerminalServiceFactory } from '../../common/terminal/types';
import { IComponentAdapter, ICondaService } from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { PythonRuntimeInstallation } from '../runtimeProvider';
import type { LanguageRuntimePackage, PackageSpec } from '../types/supervisor-api';
import { KernelPackageRpc } from './kernelPackageRpc';
import type { IPackageManager, PackageSession } from './types';

interface CondaPackageInfo {
    version: string;
    timestamp: number;
}

type CondaSearchResult = Record<string, CondaPackageInfo[]>;

export function parseCondaSearchResult(json: string): CondaSearchResult {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Expected conda search result to be an object.');
    }
    const result: CondaSearchResult = {};
    for (const [name, entries] of Object.entries(parsed)) {
        if (!Array.isArray(entries)) {
            throw new Error(`Expected conda packages for '${name}' to be an array.`);
        }
        result[name] = entries.map((entry, index) => {
            if (!entry || typeof entry !== 'object') {
                throw new Error(`Expected conda package ${name}[${index}] to be an object.`);
            }
            const { version, timestamp } = entry as Record<string, unknown>;
            if (typeof version !== 'string' || typeof timestamp !== 'number') {
                throw new Error(`Expected conda package ${name}[${index}] to contain version and timestamp.`);
            }
            return { version, timestamp };
        });
    }
    return result;
}

export class CondaPackageManager implements IPackageManager {
    private readonly _kernelRpc: KernelPackageRpc;

    constructor(
        private readonly _installation: PythonRuntimeInstallation,
        private readonly _serviceContainer: IServiceContainer,
        session: PackageSession,
        logChannel: vscode.LogOutputChannel,
    ) {
        this._kernelRpc = new KernelPackageRpc(session, logChannel);
    }

    getPackages(token?: vscode.CancellationToken): Promise<LanguageRuntimePackage[]> {
        return this._kernelRpc.call<LanguageRuntimePackage[]>('getPackagesInstalled', token);
    }

    async isCondaAvailable(): Promise<boolean> {
        try {
            return await this._serviceContainer.get<ICondaService>(ICondaService).isCondaAvailable();
        } catch {
            return false;
        }
    }

    async installPackages(packages: PackageSpec[], token?: vscode.CancellationToken): Promise<void> {
        this._throwIfCancelled(token);
        if (packages.length === 0) {
            return;
        }
        await this._ensureConda();
        await this._executeCondaInTerminal(
            ['install', '--prefix', await this._getEnvironmentPrefix(), '-y', ...this._formatPackageSpecs(packages)],
            token,
        );
    }

    async uninstallPackages(packageNames: string[], token?: vscode.CancellationToken): Promise<void> {
        this._throwIfCancelled(token);
        if (packageNames.length === 0) {
            return;
        }
        await this._ensureConda();
        await this._executeCondaInTerminal(
            ['remove', '--prefix', await this._getEnvironmentPrefix(), '-y', ...packageNames],
            token,
        );
    }

    updatePackages(packages: PackageSpec[], token?: vscode.CancellationToken): Promise<void> {
        return this.installPackages(packages, token);
    }

    async updateAllPackages(token?: vscode.CancellationToken): Promise<void> {
        this._throwIfCancelled(token);
        await this._ensureConda();
        await this._executeCondaInTerminal(
            ['update', '--prefix', await this._getEnvironmentPrefix(), '--all', '-y'],
            token,
        );
    }

    async searchPackages(query: string, token?: vscode.CancellationToken): Promise<LanguageRuntimePackage[]> {
        this._throwIfCancelled(token);
        await this._ensureConda();
        try {
            const result = parseCondaSearchResult(
                await this._executeCondaWithOutput(['search', `*${query}*`, '--json'], token),
            );
            return Object.entries(result).map(([name, entries]) => {
                const latest = entries.reduce((left, right) => (left.timestamp > right.timestamp ? left : right));
                return { id: name, name, displayName: name, version: latest.version };
            });
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                throw error;
            }
            return [];
        }
    }

    async searchPackageVersions(name: string, token?: vscode.CancellationToken): Promise<string[]> {
        this._throwIfCancelled(token);
        await this._ensureConda();
        try {
            const result = parseCondaSearchResult(
                await this._executeCondaWithOutput(['search', name, '--json'], token),
            );
            const entries = result[name];
            if (!entries) {
                return [];
            }
            return [
                ...new Set(
                    [...entries].sort((left, right) => right.timestamp - left.timestamp).map((entry) => entry.version),
                ),
            ];
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                throw error;
            }
            return [];
        }
    }

    private async _ensureConda(): Promise<void> {
        if (!(await this.isCondaAvailable())) {
            throw new Error('conda is not available. Please install conda to use package management features.');
        }
    }

    private async _getEnvironmentPrefix(): Promise<string> {
        const prefix = this._installation.envPath ?? this._installation.sysPrefix;
        if (prefix) {
            return prefix;
        }
        const environment = await this._serviceContainer
            .get<IComponentAdapter>(IComponentAdapter)
            .getCondaEnvironment(this._installation.pythonPath);
        if (!environment?.path) {
            throw new Error('Could not determine the conda environment path for the session interpreter.');
        }
        return environment.path;
    }

    private _formatPackageSpecs(packages: PackageSpec[]): string[] {
        return packages.map((pkg) => (pkg.version ? `${pkg.name}==${pkg.version}` : pkg.name));
    }

    private async _getCondaFile(): Promise<string> {
        return this._serviceContainer.get<ICondaService>(ICondaService).getCondaFile(true);
    }

    private async _executeCondaInTerminal(args: string[], token?: vscode.CancellationToken): Promise<void> {
        const terminal = this._serviceContainer
            .get<ITerminalServiceFactory>(ITerminalServiceFactory)
            .getTerminalService({ title: 'Python Packages' });
        await terminal.show();
        const cancellation = token?.onCancellationRequested(() => {
            void terminal.sendText('\x03');
        });
        try {
            await terminal.sendCommand(await this._getCondaFile(), args, token, false);
        } finally {
            cancellation?.dispose();
        }
    }

    private async _executeCondaWithOutput(args: string[], token?: vscode.CancellationToken): Promise<string> {
        const processService = await this._serviceContainer
            .get<IProcessServiceFactory>(IProcessServiceFactory)
            .create();
        return (await processService.exec(await this._getCondaFile(), args, { token })).stdout;
    }

    private _throwIfCancelled(token?: vscode.CancellationToken): void {
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
    }
}
