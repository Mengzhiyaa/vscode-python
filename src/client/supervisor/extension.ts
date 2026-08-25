import * as vscode from 'vscode';
import { IExtensionContext, ILogOutputChannel } from '../common/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';
import { traceWarn } from '../logging';
import { PythonBinaryProvider } from './binaryProvider';
import { registerApkDebugAdapterFactory } from './apkDebugger';
import { registerSupervisorEnvironmentContributions } from './environmentContributions';
import { PythonLanguageContribution } from './pythonLanguageContribution';
import { disposePythonLspOutputChannel } from './pythonLsp';
import type {
    ILanguageRegistrationHandle,
    ILanguageContributionServices,
    ISupervisorFrameworkApi,
} from './types/supervisor-api';

const SUPERVISOR_EXTENSION_ID = 'mengzhiya.vscode-supervisor';

let supervisorRegistration:
    | { readonly state: 'registering'; readonly promise: Promise<void>; readonly attempt: object }
    | { readonly state: 'ready'; readonly handle: ILanguageRegistrationHandle; readonly attempt: object }
    | undefined;

function ensureCurrentSupervisorApi(api: ISupervisorFrameworkApi): void {
    if (
        api.apiVersion !== 2 ||
        api.protocolVersion?.major !== 2 ||
        !api.capabilities?.includes('languageCapabilityRegistry') ||
        typeof api.languages?.forExtension !== 'function' ||
        typeof api.registerEnvironmentContributions !== 'function'
    ) {
        throw new Error(
            `Extension '${SUPERVISOR_EXTENSION_ID}' does not expose the required Supervisor Language API. ` +
                'Update vscode-supervisor and retry.',
        );
    }
}

export async function activateSupervisor(
    context: IExtensionContext,
    serviceContainer: IServiceContainer,
): Promise<void> {
    if (supervisorRegistration?.state === 'ready') {
        return;
    }
    if (supervisorRegistration?.state === 'registering') {
        return supervisorRegistration.promise;
    }

    const attempt = {};
    let registered = false;
    let registrationHandle: ILanguageRegistrationHandle | undefined;
    const registrationPromise = (async () => {
        const supervisorExtension = vscode.extensions.getExtension<ISupervisorFrameworkApi>(SUPERVISOR_EXTENSION_ID);
        if (!supervisorExtension) {
            traceWarn(`Required extension '${SUPERVISOR_EXTENSION_ID}' is not installed.`);
            return;
        }

        const api = await supervisorExtension.activate();
        ensureCurrentSupervisorApi(api);
        const dapEnabled =
            vscode.workspace.getConfiguration('python')?.get<boolean>('supervisor.enableDap', true) ?? true;
        // Supervisor creates an internal `apk` attach configuration for the
        // Console DAP. Register the descriptor before language capabilities are
        // committed so restored sessions can attach immediately.
        if (dapEnabled) {
            const dapRegistration = registerApkDebugAdapterFactory();
            if (dapRegistration) {
                context.subscriptions.push(dapRegistration);
            }
        }
        const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
        const languageLogChannel = serviceContainer.get<ILogOutputChannel>(ILogOutputChannel);
        const contribution = new PythonLanguageContribution(
            context,
            api,
            interpreterService,
            serviceContainer,
            dapEnabled,
        );
        const binaryProvider = new PythonBinaryProvider(context);
        const contributionServices: ILanguageContributionServices = {
            ...api.services,
            logChannel: languageLogChannel,
            languageLogChannel,
        };
        let notebookController: ReturnType<PythonLanguageContribution['getNotebookController']> | undefined;
        try {
            notebookController = contribution.getNotebookController(contributionServices);
        } catch (error) {
            traceWarn('Failed to create the Python Supervisor notebook controller.', error);
        }
        const builder = api.languages
            .forExtension(context.extension.id)
            .begin({
                languageId: contribution.runtimeProvider.languageId,
                registrationId: 'core',
                revision: 1,
            })
            .setLogChannel(languageLogChannel)
            .setRuntimeProvider(contribution.runtimeProvider)
            .setSessionManager(contribution.getRuntimeSessionManager(languageLogChannel))
            .setLspFactory(contribution.runtimeProvider.lspFactory)
            .setBinaryProvider(binaryProvider);
        if (notebookController) {
            builder.addNotebookController('notebook.python', notebookController.controller, [
                contribution.runtimeProvider.languageId,
            ]);
        }
        for (const descriptor of contribution.getOptionalCapabilities()) {
            builder.addOptionalCapability(descriptor);
        }
        let handle: ILanguageRegistrationHandle;
        try {
            handle = builder.commit();
        } catch (error) {
            notebookController?.dispose();
            throw error;
        }
        context.subscriptions.push(handle);
        context.subscriptions.push(new vscode.Disposable(disposePythonLspOutputChannel));
        if (notebookController) {
            context.subscriptions.push(notebookController);
        }
        context.subscriptions.push(registerSupervisorEnvironmentContributions(context, api));
        registered = true;
        registrationHandle = handle;
        context.subscriptions.push(
            new vscode.Disposable(() => {
                if (supervisorRegistration?.state === 'ready' && supervisorRegistration.attempt === attempt) {
                    supervisorRegistration = undefined;
                }
            }),
        );
    })().then(
        () => {
            if (supervisorRegistration?.state === 'registering' && supervisorRegistration.attempt === attempt) {
                supervisorRegistration = registered
                    ? { state: 'ready', handle: registrationHandle!, attempt }
                    : undefined;
            }
        },
        (error) => {
            if (supervisorRegistration?.state === 'registering' && supervisorRegistration.attempt === attempt) {
                supervisorRegistration = undefined;
            }
            throw error;
        },
    );

    supervisorRegistration = { state: 'registering', promise: registrationPromise, attempt };
    return registrationPromise;
}
