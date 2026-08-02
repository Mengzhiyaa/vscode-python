import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { PythonConsoleRuntimeRouter } from './pythonConsoleRuntimeRouter';
import { PythonRuntimeInstallation, PYTHON_LANGUAGE_ID } from './runtimeProvider';
import type {
    ILanguageContributionServices,
    ILanguageRuntimeSession,
    RuntimeCodeExecutionMode,
    RuntimeErrorBehavior,
    RuntimeErrorMessage,
    RuntimeIPyWidgetMessage,
    RuntimeInputMessage,
    RuntimeOutputMessage,
    RuntimePromptMessage,
    RuntimeResultMessage,
    RuntimeStateMessage,
    RuntimeStreamMessage,
    RuntimeUpdateOutputMessage,
} from './types/supervisor-api';

const NOTEBOOK_CONTROLLER_ID = 'python-supervisor';
const NOTEBOOK_TYPE = 'jupyter-notebook';
const EXECUTION_SOURCE = 'python.supervisor.notebook';

function getCellId(cell: vscode.NotebookCell): string {
    const metadataId = (cell.metadata as { id?: unknown }).id;
    return typeof metadataId === 'string' && metadataId.length > 0 ? metadataId : cell.document.uri.toString();
}

function outputItems(data: Record<string, unknown>): vscode.NotebookCellOutputItem[] {
    return Object.entries(data).map(([mime, value]) => {
        if (value instanceof Uint8Array) {
            return new vscode.NotebookCellOutputItem(value, mime);
        }
        if (typeof value === 'string') {
            if (mime.startsWith('image/')) {
                return new vscode.NotebookCellOutputItem(Buffer.from(value, 'base64'), mime);
            }
            return vscode.NotebookCellOutputItem.text(value, mime);
        }
        return vscode.NotebookCellOutputItem.json(value, mime);
    });
}

function outputFromData(data: Record<string, unknown>, outputId?: string): vscode.NotebookCellOutput {
    return new vscode.NotebookCellOutput(outputItems(data), {
        outputId,
    });
}

export class PythonSupervisorNotebookController implements vscode.Disposable {
    private readonly _controller: vscode.NotebookController;
    private readonly _ownership: vscode.Disposable;

    constructor(
        private readonly _runtimeRouter: PythonConsoleRuntimeRouter,
        private readonly _services: ILanguageContributionServices,
    ) {
        this._controller = vscode.notebooks.createNotebookController(
            NOTEBOOK_CONTROLLER_ID,
            NOTEBOOK_TYPE,
            'Python (Supervisor)',
        );
        this._controller.supportedLanguages = [PYTHON_LANGUAGE_ID];
        this._controller.description = 'Execute Python notebooks with vscode-supervisor';
        this._controller.supportsExecutionOrder = true;
        this._controller.executeHandler = (cells, notebook) => this.executeCells(cells, notebook);
        this._controller.interruptHandler = (notebook) => this.interruptNotebook(notebook);
        this._ownership = this._services.runtimeSessionService.registerNotebookController(this._controller, [
            PYTHON_LANGUAGE_ID,
        ]);
    }

    dispose(): void {
        this._ownership.dispose();
        this._controller.dispose();
    }

    private async executeCells(cells: vscode.NotebookCell[], notebook: vscode.NotebookDocument): Promise<void> {
        let session: ILanguageRuntimeSession;
        try {
            session = await this.getOrCreateSession(notebook);
        } catch (error) {
            const message = error instanceof Error ? error : new Error(String(error));
            this._services.logChannel.error(`[Python Supervisor] Cannot execute notebook cells: ${message.message}`);
            await Promise.all(cells.map((cell) => this.failCell(cell, message)));
            return;
        }

        for (const cell of cells) {
            await this.executeCell(session, cell, notebook);
        }
    }

    private async getOrCreateSession(notebook: vscode.NotebookDocument): Promise<ILanguageRuntimeSession> {
        const existing = this._services.runtimeSessionService.getNotebookSessionForNotebookUri(notebook.uri);
        if (existing && String(existing.state) !== 'exited') {
            return existing;
        }

        let metadata = await this._runtimeRouter.resolveRuntimeMetadata(EXECUTION_SOURCE, notebook.uri);
        if (!metadata) {
            const activeInstallation = await this._runtimeRouter.resolveActiveInstallation(notebook.uri);
            const installation = await this._services.runtimeSessionService.selectInstallation<
                PythonRuntimeInstallation
            >(PYTHON_LANGUAGE_ID, {
                allowBrowse: true,
                forcePick: true,
                persistSelection: true,
                preselectRuntimePath: activeInstallation?.pythonPath,
                placeHolder: 'Select a Python interpreter for this notebook',
                title: 'Python Supervisor Runtime',
            });
            if (!installation) {
                throw new Error('No Python interpreter was selected for the notebook.');
            }
            metadata = this._runtimeRouter.registerInstallation(installation);
        }

        await this._services.runtimeSessionService.selectRuntime(metadata.runtimeId, EXECUTION_SOURCE, notebook.uri);
        const session = this._services.runtimeSessionService.getNotebookSessionForNotebookUri(notebook.uri);
        if (!session) {
            throw new Error(`Supervisor did not create a notebook session for ${notebook.uri.toString()}.`);
        }
        return session;
    }

    private async executeCell(
        session: ILanguageRuntimeSession,
        cell: vscode.NotebookCell,
        notebook: vscode.NotebookDocument,
    ): Promise<void> {
        const execution = this._controller.createNotebookCellExecution(cell);
        const executionId = crypto.randomUUID();
        const outputsById = new Map<string, vscode.NotebookCellOutput>();
        const disposables: vscode.Disposable[] = [];
        let failed = false;
        let finished = false;
        let clearOnNextOutput = false;
        let outputQueue = Promise.resolve();
        let resolveCompletion: () => void;
        const completion = new Promise<void>((resolve) => {
            resolveCompletion = resolve;
        });

        const enqueueOutput = (update: () => Thenable<void> | Promise<void>): void => {
            outputQueue = outputQueue
                .then(async () => {
                    if (clearOnNextOutput) {
                        clearOnNextOutput = false;
                        outputsById.clear();
                        await execution.clearOutput();
                    }
                    await update();
                })
                .catch((error) => {
                    failed = true;
                    this._services.logChannel.error(
                        `[Python Supervisor] Failed to update notebook output: ${
                            error instanceof Error ? error.message : String(error)
                        }`,
                    );
                });
        };

        const finish = async (success: boolean | undefined): Promise<void> => {
            if (finished) {
                return;
            }
            finished = true;
            disposables.forEach((disposable) => disposable.dispose());
            await outputQueue;
            execution.end(success, Date.now());
            resolveCompletion();
        };

        const isCurrentExecution = (message: { parent_id: string }): boolean => message.parent_id === executionId;

        disposables.push(
            session.onDidReceiveRuntimeMessageStream((message: RuntimeStreamMessage) => {
                if (!isCurrentExecution(message)) {
                    return;
                }
                enqueueOutput(() =>
                    execution.appendOutput(
                        new vscode.NotebookCellOutput([
                            message.name === 'stderr'
                                ? vscode.NotebookCellOutputItem.stderr(message.text)
                                : vscode.NotebookCellOutputItem.stdout(message.text),
                        ]),
                    ),
                );
            }),
            session.onDidReceiveRuntimeMessageInput((message: RuntimeInputMessage) => {
                if (isCurrentExecution(message)) {
                    execution.executionOrder = message.execution_count;
                }
            }),
            session.onDidReceiveRuntimeMessageError((message: RuntimeErrorMessage) => {
                if (!isCurrentExecution(message)) {
                    return;
                }
                failed = true;
                const error = new Error(message.message);
                error.name = message.name;
                error.stack = message.traceback.join('\n');
                enqueueOutput(() =>
                    execution.appendOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(error)])),
                );
            }),
            session.onDidReceiveRuntimeMessageOutput((message: RuntimeOutputMessage) => {
                if (!isCurrentExecution(message)) {
                    return;
                }
                const output = outputFromData(message.data, message.output_id);
                if (message.output_id) {
                    outputsById.set(message.output_id, output);
                }
                enqueueOutput(() => execution.appendOutput(output));
            }),
            session.onDidReceiveRuntimeMessageResult((message: RuntimeResultMessage) => {
                if (!isCurrentExecution(message)) {
                    return;
                }
                execution.executionOrder = message.execution_count;
                const output = outputFromData(message.data, message.output_id);
                if (message.output_id) {
                    outputsById.set(message.output_id, output);
                }
                enqueueOutput(() => execution.appendOutput(output));
            }),
            session.onDidReceiveRuntimeMessagePrompt((message: RuntimePromptMessage) => {
                if (!isCurrentExecution(message)) {
                    return;
                }
                void (async () => {
                    try {
                        const reply = await vscode.window.showInputBox({
                            ignoreFocusOut: true,
                            password: message.password,
                            prompt: message.prompt,
                        });
                        if (reply === undefined) {
                            failed = true;
                            await session.interrupt();
                            return;
                        }
                        await session.replyToPrompt(message.id, reply);
                    } catch (error) {
                        failed = true;
                        this._services.logChannel.error(
                            `[Python Supervisor] Failed to answer notebook prompt: ${
                                error instanceof Error ? error.message : String(error)
                            }`,
                        );
                    }
                })();
            }),
            session.onDidReceiveRuntimeMessageClearOutput((message) => {
                if (!isCurrentExecution(message)) {
                    return;
                }
                if (message.wait) {
                    clearOnNextOutput = true;
                    return;
                }
                enqueueOutput(async () => {
                    outputsById.clear();
                    await execution.clearOutput();
                });
            }),
            session.onDidReceiveRuntimeMessageUpdateOutput((message: RuntimeUpdateOutputMessage) => {
                if (!isCurrentExecution(message)) {
                    return;
                }
                const output = outputsById.get(message.output_id);
                if (output) {
                    enqueueOutput(() => execution.replaceOutputItems(outputItems(message.data ?? {}), output));
                    return;
                }
                const nextOutput = outputFromData(message.data ?? {}, message.output_id);
                outputsById.set(message.output_id, nextOutput);
                enqueueOutput(() => execution.appendOutput(nextOutput));
            }),
            session.onDidReceiveRuntimeMessageIPyWidget((message: RuntimeIPyWidgetMessage) => {
                const original = message.original_message;
                if (!isCurrentExecution(original) || !original.data) {
                    return;
                }
                const output = outputFromData(original.data, original.output_id);
                if (original.output_id) {
                    outputsById.set(original.output_id, output);
                }
                enqueueOutput(() => execution.appendOutput(output));
            }),
            session.onDidReceiveRuntimeMessageState((message: RuntimeStateMessage) => {
                if (isCurrentExecution(message) && message.state === 'idle') {
                    void finish(!failed);
                }
            }),
            session.onDidEndSession(() => {
                failed = true;
                void finish(false);
            }),
            execution.token.onCancellationRequested(() => {
                failed = true;
                void (async () => {
                    try {
                        await session.interrupt();
                    } catch (error) {
                        this._services.logChannel.error(
                            `[Python Supervisor] Failed to interrupt notebook execution: ${
                                error instanceof Error ? error.message : String(error)
                            }`,
                        );
                    } finally {
                        await finish(false);
                    }
                })();
            }),
        );

        execution.start(Date.now());
        await execution.clearOutput();
        try {
            session.execute(
                cell.document.getText(),
                executionId,
                'interactive' as RuntimeCodeExecutionMode,
                'stop' as RuntimeErrorBehavior,
                {
                    source: EXECUTION_SOURCE,
                    fileUri: notebook.uri,
                    metadata: { cellId: getCellId(cell) },
                },
            );
        } catch (error) {
            failed = true;
            enqueueOutput(() =>
                execution.appendOutput(
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.error(error instanceof Error ? error : new Error(String(error))),
                    ]),
                ),
            );
            await finish(false);
            return;
        }

        await completion;
    }

    private async failCell(cell: vscode.NotebookCell, error: Error): Promise<void> {
        const execution = this._controller.createNotebookCellExecution(cell);
        execution.start(Date.now());
        await execution.replaceOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(error)]));
        execution.end(false, Date.now());
    }

    private async interruptNotebook(notebook: vscode.NotebookDocument): Promise<void> {
        await this._services.runtimeSessionService.getNotebookSessionForNotebookUri(notebook.uri)?.interrupt();
    }
}
