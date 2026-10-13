import * as vscode from 'vscode';
import type { PackageRepositoryRequest, PackageRepositoryResponse } from '../types/supervisor-api';

/** Runs on the language extension Host, including the remote session machine. */
export async function requestPackageRepository(
    request: PackageRepositoryRequest,
    token?: vscode.CancellationToken,
): Promise<PackageRepositoryResponse> {
    if (token?.isCancellationRequested) { throw new vscode.CancellationError(); }
    const url = new URL(request.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Package repository requests require an HTTP or HTTPS URL.');
    }
    const controller = new AbortController();
    const cancellation = token?.onCancellationRequested(() => controller.abort());
    if (token?.isCancellationRequested) { controller.abort(); }
    const timeoutMs = request.timeoutMs !== undefined && Number.isFinite(request.timeoutMs) && request.timeoutMs > 0
        ? request.timeoutMs : 15000;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
        const response = await fetch(url, {
            method: request.method ?? 'GET',
            headers: request.headers,
            body: request.body,
            signal: controller.signal,
        });
        const body = await response.text();
        if (token?.isCancellationRequested) { throw new vscode.CancellationError(); }
        return { status: response.status, body };
    } catch (error) {
        if (token?.isCancellationRequested) { throw new vscode.CancellationError(); }
        if (timedOut) { throw new Error(`Package repository request timed out after ${timeoutMs}ms.`); }
        throw error;
    } finally {
        clearTimeout(timer);
        cancellation?.dispose();
    }
}
