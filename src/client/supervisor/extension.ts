import * as vscode from 'vscode';
import { IExtensionContext } from '../common/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';
import { traceWarn } from '../logging';
import { PythonLanguageContribution } from './pythonLanguageContribution';
import type { ISupervisorFrameworkApi } from './types/supervisor-api';

const SUPERVISOR_EXTENSION_ID = 'mengzhiya.vscode-supervisor';

let supervisorRegistrationPromise: Promise<void> | undefined;

export async function activateSupervisor(
    context: IExtensionContext,
    serviceContainer: IServiceContainer,
): Promise<void> {
    if (supervisorRegistrationPromise) {
        return supervisorRegistrationPromise;
    }

    supervisorRegistrationPromise = (async () => {
        const supervisorExtension = vscode.extensions.getExtension<ISupervisorFrameworkApi>(SUPERVISOR_EXTENSION_ID);
        if (!supervisorExtension) {
            traceWarn(`Required extension '${SUPERVISOR_EXTENSION_ID}' is not installed.`);
            return;
        }

        const api = await supervisorExtension.activate();
        const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
        const contribution = new PythonLanguageContribution(context, api, interpreterService, serviceContainer);
        await api.registerLanguageSupport({
            runtimeProvider: contribution.runtimeProvider,
            languageContribution: contribution,
        });
    })().catch((error) => {
        supervisorRegistrationPromise = undefined;
        throw error;
    });

    return supervisorRegistrationPromise;
}
