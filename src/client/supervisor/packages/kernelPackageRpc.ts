// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import type { PackageSession } from './types';
import type { LanguageRuntimePackage } from '../types/supervisor-api';

/** Calls package RPC methods on the APK session and owns cancellation cleanup. */
export class KernelPackageRpc {
    constructor(private readonly _session: PackageSession, private readonly _logChannel: vscode.LogOutputChannel) {}

    async getPackageDetail(name: string, token?: vscode.CancellationToken): Promise<Partial<LanguageRuntimePackage> | undefined> {
        if (token?.isCancellationRequested) { throw new vscode.CancellationError(); }
        if (!name.trim()) { return undefined; }
        const detail = await this.call<(Partial<LanguageRuntimePackage> & { sourceRepository?: string }) | null>(
            'getPackageDetail', token, name,
        );
        if (!detail) { return undefined; }
        return {
            ...detail,
            ...(detail.sourceRepository && !detail.source ? { source: detail.sourceRepository } : {}),
        };
    }

    async call<T>(method: string, token?: vscode.CancellationToken, ...args: unknown[]): Promise<T> {
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        const call = Promise.resolve(this._session.callMethod(method, ...args)) as Promise<T>;
        if (!token) {
            return call;
        }

        return new Promise<T>((resolve, reject) => {
            let settled = false;
            let cancellation: vscode.Disposable | undefined;

            const finish = (callback: () => void): void => {
                if (settled) {
                    return;
                }
                settled = true;
                cancellation?.dispose();
                callback();
            };

            const cancel = (): void => {
                if (settled) {
                    return;
                }
                settled = true;
                cancellation?.dispose();
                void this._session
                    .interrupt()
                    .catch((error) => {
                        this._logChannel.warn(
                            `[Python Packages] Failed to interrupt cancelled RPC '${method}': ${error}`,
                        );
                    })
                    .finally(() => reject(new vscode.CancellationError()));
            };

            cancellation = token.onCancellationRequested(cancel);
            if (settled) {
                cancellation.dispose();
            } else if (token.isCancellationRequested) {
                cancel();
            }

            call.then(
                (result) => finish(() => resolve(result)),
                (error) => finish(() => reject(error)),
            );
        });
    }
}
