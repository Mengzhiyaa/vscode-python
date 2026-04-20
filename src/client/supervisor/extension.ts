import * as vscode from 'vscode';
import { IExtensionContext } from '../common/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';
import { traceWarn } from '../logging';
import { PythonBinaryProvider } from './binaryProvider';
import { PythonLanguageContribution } from './pythonLanguageContribution';
import type { ILanguageWebviewAssets, ISupervisorFrameworkApi } from './types/supervisor-api';

const SUPERVISOR_EXTENSION_ID = 'mengzhiya.vscode-supervisor';

let supervisorRegistrationPromise: Promise<void> | undefined;

export function createSupervisorWebviewAssets(context: IExtensionContext): ILanguageWebviewAssets {
    const supervisorResourceRoot = vscode.Uri.joinPath(context.extensionUri, 'resources', 'supervisor');
    const syntaxRoot = vscode.Uri.joinPath(context.extensionUri, 'syntaxes');

    return {
        localResourceRoots: [supervisorResourceRoot, syntaxRoot],
        monacoSupportModule: vscode.Uri.joinPath(supervisorResourceRoot, 'pythonMonacoSupport.js'),
        textMateGrammar: {
            scopeName: 'source.python',
            grammarUri: vscode.Uri.joinPath(syntaxRoot, 'MagicPython.tmLanguage.json'),
        },
    };
}

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
        const binaryProvider = new PythonBinaryProvider(context);
        await api.registerLanguageSupport({
            runtimeProvider: contribution.runtimeProvider,
            binaryProvider,
            languageContribution: contribution,
            webviewAssets: createSupervisorWebviewAssets(context),
        });
    })().catch((error) => {
        supervisorRegistrationPromise = undefined;
        throw error;
    });

    return supervisorRegistrationPromise;
}
