import * as vscode from 'vscode';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { PythonRuntimeInstallation, PythonRuntimeProvider, PYTHON_LANGUAGE_ID } from './runtimeProvider';
import type {
    ILanguageContributionServices,
    ILanguageRuntimeSession,
    ISupervisorFrameworkApi,
    LanguageRuntimeMetadata,
} from './types/supervisor-api';

export interface PythonConsoleSessionTarget {
    runtimeMetadata: LanguageRuntimeMetadata;
    sessionId: string;
    session?: ILanguageRuntimeSession;
}

export class PythonConsoleRuntimeRouter {
    constructor(
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _api: ISupervisorFrameworkApi,
        private readonly _runtimeProvider: PythonRuntimeProvider,
        private readonly _services: ILanguageContributionServices,
    ) {}

    async ensureRuntimeForConsole(
        source: string,
        resource?: vscode.Uri,
        runtimeMetadata?: LanguageRuntimeMetadata,
    ): Promise<LanguageRuntimeMetadata | undefined> {
        const metadata = runtimeMetadata ?? (await this.resolveRuntimeMetadata(source, resource));
        if (!metadata) {
            return undefined;
        }

        await this.selectRuntimeForLiveConsole(metadata, source);
        return metadata;
    }

    async ensureConsoleSession(
        source: string,
        resource?: vscode.Uri,
        activate: boolean = false,
        runtimeMetadata?: LanguageRuntimeMetadata,
    ): Promise<PythonConsoleSessionTarget | undefined> {
        const metadata = await this.ensureRuntimeForConsole(source, resource, runtimeMetadata);
        if (!metadata) {
            return undefined;
        }

        const liveSession = this.getLiveConsoleSession();
        if (liveSession) {
            return {
                runtimeMetadata: metadata,
                sessionId: liveSession.sessionId,
                session: liveSession,
            };
        }

        const sessionId = await this._api.startRuntime(metadata, source, activate);
        const session =
            (sessionId ? this._services.runtimeSessionService.getSession(sessionId) : undefined) ??
            this._services.runtimeSessionService.getConsoleSessionForRuntime(metadata.runtimeId) ??
            this.getLiveConsoleSession();

        return {
            runtimeMetadata: metadata,
            sessionId: sessionId || session?.sessionId || '',
            session,
        };
    }

    async resolveRuntimeMetadata(
        _source: string,
        resource?: vscode.Uri,
    ): Promise<LanguageRuntimeMetadata | undefined> {
        const installation = await this._runtimeProvider.resolveActiveInstallation(
            this._services.logChannel,
            resource,
        );
        if (installation) {
            return this.registerInstallation(installation);
        }

        return this._services.runtimeStartupService.getPreferredRuntime(PYTHON_LANGUAGE_ID);
    }

    registerInstallation(installation: PythonRuntimeInstallation): LanguageRuntimeMetadata {
        const metadata = this._runtimeProvider.createRuntimeMetadata(
            this._extensionContext,
            installation,
            this._services.logChannel,
        );
        this._services.runtimeManager.registerDiscoveredRuntime?.(
            this._runtimeProvider.languageId,
            installation,
            metadata,
        );
        return metadata;
    }

    async syncActiveInterpreter(
        source: string,
        workspaceUri?: vscode.Uri,
    ): Promise<LanguageRuntimeMetadata | undefined> {
        const installation = await this._runtimeProvider.resolveActiveInstallation(
            this._services.logChannel,
            workspaceUri,
        );
        if (!installation) {
            return undefined;
        }

        const metadata = this.registerInstallation(installation);
        await this.selectRuntimeForLiveConsole(metadata, source);
        return metadata;
    }

    getLiveConsoleSession(): ILanguageRuntimeSession | undefined {
        const session = this._services.runtimeSessionService.getConsoleSessionForLanguage(PYTHON_LANGUAGE_ID);
        if (!session || String(session.state) === 'exited') {
            return undefined;
        }

        return session;
    }

    isActiveInstallation(installation: PythonRuntimeInstallation): boolean {
        return this._runtimeProvider.isActiveInstallation(installation);
    }

    installationFromInterpreter(interpreter: PythonEnvironment): PythonRuntimeInstallation {
        return this._runtimeProvider.installationFromEnvironment(interpreter);
    }

    async resolveActiveInstallation(resource?: vscode.Uri): Promise<PythonRuntimeInstallation | undefined> {
        return this._runtimeProvider.resolveActiveInstallation(this._services.logChannel, resource);
    }

    private async selectRuntimeForLiveConsole(
        metadata: LanguageRuntimeMetadata,
        source: string,
    ): Promise<void> {
        const existingSession = this.getLiveConsoleSession();
        if (!existingSession || existingSession.runtimeMetadata.runtimeId === metadata.runtimeId) {
            return;
        }

        await this._services.runtimeSessionService.selectRuntime(metadata.runtimeId, source);
    }
}
