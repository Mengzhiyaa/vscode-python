import * as os from 'os';
import * as vscode from 'vscode';

/** Removes common credentials and the user home path before diagnostics reach VS Code. */
export function redactLogMessage(message: string): string {
    let redacted = message
        .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer <redacted>')
        .replace(
            /((?:bearer[_-]?token|access[_-]?token|api[_-]?key|password|passwd|secret)\s*[=:]\s*["']?)[^"'\s,;}]+/gi,
            '$1<redacted>',
        )
        .replace(
            /((?:--?(?:bearer[-_]?token|access[-_]?token|api[-_]?key|token|password|passwd|secret))(?:\s+|=))[^\s]+/gi,
            '$1<redacted>',
        );
    const home = os.homedir();
    if (home && home !== '/') {
        redacted = redacted.split(home).join('<home>');
    }
    return redacted;
}

/** Applies redaction to producer-formatted text without adding log-channel formatting. */
export class RedactingOutputChannel implements vscode.OutputChannel {
    constructor(private readonly channel: vscode.OutputChannel) {}

    get name(): string {
        return this.channel.name;
    }
    append(value: string): void {
        this.channel.append(redactLogMessage(value));
    }
    appendLine(value: string): void {
        this.channel.appendLine(redactLogMessage(value));
    }
    replace(value: string): void {
        this.channel.replace(redactLogMessage(value));
    }
    clear(): void {
        this.channel.clear();
    }
    show(preserveFocus?: boolean): void;
    show(column?: vscode.ViewColumn, preserveFocus?: boolean): void;
    show(columnOrPreserveFocus?: vscode.ViewColumn | boolean, preserveFocus?: boolean): void {
        if (typeof columnOrPreserveFocus === 'boolean' || columnOrPreserveFocus === undefined) {
            this.channel.show(columnOrPreserveFocus);
        } else {
            this.channel.show(preserveFocus);
        }
    }
    hide(): void {
        this.channel.hide();
    }
    dispose(): void {
        this.channel.dispose();
    }
}

/** Applies redaction to every Python LogOutputChannel write. */
export class RedactingLogOutputChannel implements vscode.LogOutputChannel {
    constructor(private readonly channel: vscode.LogOutputChannel) {}

    get name(): string {
        return this.channel.name;
    }
    get logLevel(): vscode.LogLevel {
        return this.channel.logLevel;
    }
    get onDidChangeLogLevel(): vscode.Event<vscode.LogLevel> {
        return this.channel.onDidChangeLogLevel;
    }
    append(value: string): void {
        this.channel.append(redactLogMessage(value));
    }
    appendLine(value: string): void {
        this.channel.appendLine(redactLogMessage(value));
    }
    replace(value: string): void {
        this.channel.replace(redactLogMessage(value));
    }
    clear(): void {
        this.channel.clear();
    }
    show(preserveFocus?: boolean): void;
    show(column?: vscode.ViewColumn, preserveFocus?: boolean): void;
    show(columnOrPreserveFocus?: vscode.ViewColumn | boolean, preserveFocus?: boolean): void {
        if (typeof columnOrPreserveFocus === 'boolean' || columnOrPreserveFocus === undefined) {
            this.channel.show(columnOrPreserveFocus);
        } else {
            this.channel.show(preserveFocus);
        }
    }
    hide(): void {
        this.channel.hide();
    }
    trace(message: string, ...args: unknown[]): void {
        this.channel.trace(redactLogMessage(message), ...redactArgs(args));
    }
    debug(message: string, ...args: unknown[]): void {
        this.channel.debug(redactLogMessage(message), ...redactArgs(args));
    }
    info(message: string, ...args: unknown[]): void {
        this.channel.info(redactLogMessage(message), ...redactArgs(args));
    }
    warn(message: string, ...args: unknown[]): void {
        this.channel.warn(redactLogMessage(message), ...redactArgs(args));
    }
    error(message: string | Error, ...args: unknown[]): void {
        this.channel.error(
            typeof message === 'string' ? redactLogMessage(message) : redactError(message),
            ...redactArgs(args),
        );
    }
    dispose(): void {
        this.channel.dispose();
    }
}

function redactArgs(args: readonly unknown[]): unknown[] {
    return args.map((argument) => {
        if (typeof argument === 'string') {
            return redactLogMessage(argument);
        }
        if (argument instanceof Error) {
            return redactError(argument);
        }
        return argument;
    });
}

function redactError(error: Error): Error {
    const redacted = new Error(redactLogMessage(error.message));
    redacted.name = error.name;
    redacted.stack = error.stack ? redactLogMessage(error.stack) : undefined;
    return redacted;
}
