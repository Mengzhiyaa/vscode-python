// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IServiceContainer } from '../../ioc/types';
import { EnvironmentType } from '../../pythonEnvironments/info';
import { PythonRuntimeInstallation } from '../runtimeProvider';
import type { ILanguageRuntimePackageManager, ILanguageRuntimeSession } from '../types/supervisor-api';
import { CondaPackageManager } from './condaPackageManager';
import { PipPackageManager } from './pipPackageManager';

export class PackageManagerFactory {
    static create(
        installation: PythonRuntimeInstallation,
        serviceContainer: IServiceContainer,
        session: ILanguageRuntimeSession,
        logChannel: vscode.LogOutputChannel,
    ): ILanguageRuntimePackageManager {
        if (installation.envType === EnvironmentType.Conda) {
            return new CondaPackageManager(installation, serviceContainer, session, logChannel);
        }
        return new PipPackageManager(installation.pythonPath, serviceContainer, session, logChannel);
    }
}
