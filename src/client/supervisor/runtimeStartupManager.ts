import * as vscode from 'vscode';
import type {
    IDiscoveredLanguageRuntime,
    IRuntimeManager,
    IRuntimeStartupService,
    LanguageRuntimeMetadata,
} from './types/supervisor-api';
import { PythonRuntimeInstallation, PythonRuntimeProvider } from './runtimeProvider';

export class PythonRuntimeStartupManager implements vscode.Disposable, IRuntimeManager {
    private static _nextRuntimeManagerId = 1;

    private readonly _onDidDiscoverRuntimeEmitter =
        new vscode.EventEmitter<IDiscoveredLanguageRuntime<PythonRuntimeInstallation>>();

    private readonly _onDidFinishDiscoveryEmitter = new vscode.EventEmitter<void>();

    private _discoverAllRuntimesPromise: Promise<void> | undefined;

    readonly id = PythonRuntimeStartupManager._nextRuntimeManagerId++;
    readonly onDidDiscoverRuntime = this._onDidDiscoverRuntimeEmitter.event;
    readonly onDidFinishDiscovery = this._onDidFinishDiscoveryEmitter.event;

    constructor(
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _runtimeProvider: PythonRuntimeProvider,
        private readonly _runtimeManager: IRuntimeManager,
        private readonly _runtimeStartupService: IRuntimeStartupService,
        private readonly _logChannel: vscode.LogOutputChannel,
    ) {}

    discoverAllRuntimes(disabledLanguageIds: string[]): Promise<void> {
        if (this._discoverAllRuntimesPromise) {
            return this._discoverAllRuntimesPromise;
        }

        this._discoverAllRuntimesPromise = this._doDiscoverAllRuntimes(disabledLanguageIds).finally(() => {
            this._discoverAllRuntimesPromise = undefined;
            this._runtimeStartupService.completeDiscovery?.(this.id);
            this._onDidFinishDiscoveryEmitter.fire();
        });

        return this._discoverAllRuntimesPromise;
    }

    async recommendWorkspaceRuntimes(disabledLanguageIds: string[]): Promise<LanguageRuntimeMetadata[]> {
        if (disabledLanguageIds.includes(this._runtimeProvider.languageId) ||
            !this._runtimeProvider.shouldRecommendForWorkspace) {
            return [];
        }

        if (!(await this._runtimeProvider.shouldRecommendForWorkspace())) {
            return [];
        }

        const installation = await this._runtimeProvider.resolveInitialInstallation(this._logChannel);
        if (!installation) {
            return [];
        }

        const metadata = this._runtimeProvider.createRuntimeMetadata(
            this._extensionContext,
            installation,
            this._logChannel,
        );
        this._runtimeManager.registerDiscoveredRuntime?.(
            this._runtimeProvider.languageId,
            installation,
            metadata,
        );

        return [metadata];
    }

    dispose(): void {
        this._onDidDiscoverRuntimeEmitter.dispose();
        this._onDidFinishDiscoveryEmitter.dispose();
    }

    private async _doDiscoverAllRuntimes(disabledLanguageIds: string[]): Promise<void> {
        if (disabledLanguageIds.includes(this._runtimeProvider.languageId)) {
            this._logChannel.debug(
                `[PythonRuntimeStartupManager] Skipping discovery for disabled language ${this._runtimeProvider.languageId}`,
            );
            return;
        }

        for await (const installation of this._runtimeProvider.discoverInstallations(this._logChannel)) {
            const metadata = this._runtimeProvider.createRuntimeMetadata(
                this._extensionContext,
                installation,
                this._logChannel,
            );
            const wasRegistered = this._runtimeManager.registerDiscoveredRuntime?.(
                this._runtimeProvider.languageId,
                installation,
                metadata,
            ) ?? false;

            if (!wasRegistered) {
                continue;
            }

            this._onDidDiscoverRuntimeEmitter.fire({
                provider: this._runtimeProvider,
                installation,
                metadata,
            });
        }
    }
}
