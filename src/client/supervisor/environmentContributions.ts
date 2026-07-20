// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as vscode from 'vscode';

import type { IExtensionContext } from '../common/types';
import { traceWarn } from '../logging';
import type { ISupervisorEnvironmentVariableAction, ISupervisorFrameworkApi } from './types/supervisor-api';

let activeRefresh: (() => void) | undefined;

function snapshotEnvironmentContributions(context: IExtensionContext): ISupervisorEnvironmentVariableAction[] {
    const actions: ISupervisorEnvironmentVariableAction[] = [];
    context.environmentVariableCollection.forEach((name, mutator) => {
        actions.push({
            action: mutator.type,
            name,
            value: mutator.value,
        });
    });
    return actions;
}

/**
 * Mirrors the extension's global terminal environment collection into the
 * Supervisor compatibility API. Scope-specific collections are intentionally
 * omitted because Positron's public EnvironmentVariableAction has no scope.
 */
export function registerSupervisorEnvironmentContributions(
    context: IExtensionContext,
    api: Pick<ISupervisorFrameworkApi, 'registerEnvironmentContributions'>,
): vscode.Disposable {
    let registration: vscode.Disposable | undefined;

    const refresh = () => {
        try {
            const nextRegistration = api.registerEnvironmentContributions(
                context.extension.id,
                snapshotEnvironmentContributions(context),
            );
            registration?.dispose();
            registration = nextRegistration;
        } catch (error) {
            traceWarn('Failed to register Python environment contributions with Supervisor.', error);
        }
    };

    activeRefresh = refresh;
    refresh();

    return new vscode.Disposable(() => {
        if (activeRefresh === refresh) {
            activeRefresh = undefined;
        }
        registration?.dispose();
        registration = undefined;
    });
}

/** Refreshes the bridge after Python mutates its global environment collection. */
export function notifySupervisorEnvironmentContributionsChanged(): void {
    activeRefresh?.();
}
