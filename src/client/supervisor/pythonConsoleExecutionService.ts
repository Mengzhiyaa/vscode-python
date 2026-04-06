import * as path from 'path';
import * as vscode from 'vscode';
import { IConfigurationService } from '../common/types';
import { IServiceContainer } from '../ioc/types';
import { ICodeExecutionHelper } from '../terminals/types';
import { PYTHON_LANGUAGE_ID } from './runtimeProvider';
import { PythonConsoleRuntimeRouter } from './pythonConsoleRuntimeRouter';
import type { IPositronConsoleService } from './types/supervisor-api';

const NO_RUNTIME_MESSAGE = 'No Python interpreter is available for the Supervisor console.';

export class PythonConsoleExecutionService {
    private readonly _codeExecutionHelper: ICodeExecutionHelper;
    private readonly _configurationService: IConfigurationService;

    constructor(
        private readonly _runtimeRouter: PythonConsoleRuntimeRouter,
        serviceContainer: IServiceContainer,
        private readonly _positronConsoleService: IPositronConsoleService,
    ) {
        this._codeExecutionHelper = serviceContainer.get<ICodeExecutionHelper>(ICodeExecutionHelper);
        this._configurationService = serviceContainer.get<IConfigurationService>(IConfigurationService);
    }

    async executeFile(source: string, resource?: vscode.Uri): Promise<void> {
        let fileToExecute =
            resource instanceof vscode.Uri ? resource : await this._codeExecutionHelper.getFileToExecute();
        if (!fileToExecute) {
            return;
        }

        const fileAfterSave = await this._codeExecutionHelper.saveFileIfDirty(fileToExecute);
        if (fileAfterSave instanceof vscode.Uri) {
            fileToExecute = fileAfterSave;
        }

        const target = await this._runtimeRouter.ensureConsoleSession(source, fileToExecute, true);
        if (!target) {
            void vscode.window.showWarningMessage(NO_RUNTIME_MESSAGE);
            return;
        }

        await this._positronConsoleService.executeCode(
            PYTHON_LANGUAGE_ID,
            target.sessionId || target.session?.sessionId,
            this.createRunFileCode(fileToExecute),
            {
                source,
                fileUri: fileToExecute,
                lineNumber: 1,
                metadata: {
                    executionTarget: 'file',
                },
            },
            true,
        );
    }

    async executeSelectionCommand(source: string, command: string, resource?: vscode.Uri): Promise<void> {
        // Match Ark/R editor execution semantics: once a Python console is live,
        // follow the current foreground console session instead of re-selecting a
        // runtime from the editor's active interpreter before every Ctrl+Enter.
        if (!this._runtimeRouter.getLiveConsoleSession()) {
            const target = await this._runtimeRouter.ensureConsoleSession(source, resource, false);
            if (!target) {
                void vscode.window.showWarningMessage(NO_RUNTIME_MESSAGE);
                return;
            }
        }

        await vscode.commands.executeCommand(command);
    }

    private createRunFileCode(file: vscode.Uri): string {
        const filePath = file.fsPath;
        const fileDirectory = path.dirname(filePath);
        const executeInFileDir = this._configurationService.getSettings(file).terminal.executeInFileDir;

        return [
            'import os as __vsc_py_os',
            'import runpy as __vsc_py_runpy',
            'import sys as __vsc_py_sys',
            `__vsc_py_file = ${JSON.stringify(filePath)}`,
            `__vsc_py_file_dir = ${JSON.stringify(fileDirectory)}`,
            `__vsc_py_chdir = ${executeInFileDir ? 'True' : 'False'}`,
            '__vsc_py_prev_cwd = __vsc_py_os.getcwd()',
            '__vsc_py_prev_argv = list(__vsc_py_sys.argv)',
            '__vsc_py_added_path = False',
            'try:',
            '    __vsc_py_sys.argv = [__vsc_py_file]',
            '    if not __vsc_py_sys.path or __vsc_py_sys.path[0] != __vsc_py_file_dir:',
            '        __vsc_py_sys.path.insert(0, __vsc_py_file_dir)',
            '        __vsc_py_added_path = True',
            '    if __vsc_py_chdir:',
            '        __vsc_py_os.chdir(__vsc_py_file_dir)',
            "    __vsc_py_runpy.run_path(__vsc_py_file, run_name='__main__')",
            'finally:',
            '    __vsc_py_sys.argv = __vsc_py_prev_argv',
            '    if __vsc_py_added_path and __vsc_py_sys.path and __vsc_py_sys.path[0] == __vsc_py_file_dir:',
            '        __vsc_py_sys.path.pop(0)',
            '    if __vsc_py_chdir:',
            '        __vsc_py_os.chdir(__vsc_py_prev_cwd)',
            '    del __vsc_py_file, __vsc_py_file_dir, __vsc_py_chdir, __vsc_py_prev_cwd, __vsc_py_prev_argv, __vsc_py_added_path',
            '    del __vsc_py_os, __vsc_py_runpy, __vsc_py_sys',
        ].join('\n');
    }
}
