// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IServiceContainer } from '../../ioc/types';
import { PackageManagerFactory } from './packageManagerFactory';
import { PythonRuntimeProvider, PYTHON_LANGUAGE_ID } from '../runtimeProvider';
import type {
    ILanguageRuntimePackageManager,
    ILanguageRuntimePackageManagerProvider,
    ILanguageRuntimeSession,
} from '../types/supervisor-api';

export class PythonPackageManagerProvider implements ILanguageRuntimePackageManagerProvider {
    readonly languageId = PYTHON_LANGUAGE_ID;

    constructor(
        private readonly _runtimeProvider: PythonRuntimeProvider,
        private readonly _serviceContainer: IServiceContainer,
        private readonly _logChannel: vscode.LogOutputChannel,
    ) {}

    createPackageManager(session: ILanguageRuntimeSession): ILanguageRuntimePackageManager | undefined {
        const installation = this._runtimeProvider.restoreInstallationFromMetadata(session.runtimeMetadata);
        if (!installation) {
            this._logChannel.warn(
                `[Python Packages] Cannot restore runtime installation for session '${session.sessionId}'.`,
            );
            return undefined;
        }
        return PackageManagerFactory.create(installation, this._serviceContainer, session, this._logChannel);
    }
}
