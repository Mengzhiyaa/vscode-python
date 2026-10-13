import * as vscode from 'vscode';
import type { IDataImporter, ISupervisorFrameworkApi } from '../types/supervisor-api';
import { escapePythonString, generatePandasImportCode, PYTHON_KEYWORDS } from './pandasCodeGenerator';

export function createPandasDataImporter(): IDataImporter {
    return {
        id: 'python.pandas',
        languageId: 'python',
        displayName: 'Python (pandas)',
        fileExtensions: ['csv', 'tsv', 'xlsx', 'parquet', 'parq'],
        reservedNames: [...PYTHON_KEYWORDS],
        generateCode: async (request) => {
            const uri = request.fileUri;
            const filePath = vscode.workspace.getWorkspaceFolder(uri)
                ? vscode.workspace.asRelativePath(uri, false)
                : uri.fsPath;
            return generatePandasImportCode({
                pathLiteral: `"${escapePythonString(filePath.replace(/\\/g, '/'))}"`,
                variableName: request.variableName,
                hasHeaderRow: request.options.hasHeaderRow,
                sheetName: request.options.sheetName,
                view: request.view,
            });
        },
    };
}

export function registerPandasDataImporter(api: ISupervisorFrameworkApi): vscode.Disposable {
    return api.registerDataImporter(createPandasDataImporter());
}
