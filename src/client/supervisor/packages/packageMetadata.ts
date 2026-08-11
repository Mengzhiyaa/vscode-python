// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import type { LanguageRuntimePackage } from '../types/supervisor-api';

/** Merge resolver-owned outdated state without replacing APK package fields. */
export async function fetchMetadataWithOutdated(
    packageNames: string[],
    getOutdatedVersions: (token?: vscode.CancellationToken) => Promise<Map<string, string>>,
    logChannel: vscode.LogOutputChannel,
    token?: vscode.CancellationToken,
): Promise<Map<string, Partial<LanguageRuntimePackage>>> {
    const outdated = await getOutdatedVersions(token).catch((error) => {
        logChannel.warn(`[Python Packages] Failed to query outdated packages: ${error}`);
        return new Map<string, string>();
    });

    return new Map(
        packageNames.map((name) => {
            const key = name.toLowerCase();
            const latestVersion = outdated.get(key);
            return [
                key,
                {
                    outdated: outdated.has(key),
                    ...(latestVersion ? { latestVersion } : {}),
                },
            ];
        }),
    );
}
