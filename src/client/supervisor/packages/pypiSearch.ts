// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import type { LanguageRuntimePackage } from '../types/supervisor-api';

const PYPI_INDEX_TTL_MS = 60 * 60 * 1000;
const PYPI_MAX_RESULTS = 100;

interface PyPIIndex {
    names: string[];
    normalizedNames: string[];
}

interface CachedPyPIIndex extends PyPIIndex {
    fetchedAt: number;
}

interface PyPIFile {
    filename: string;
    'requires-python'?: string | null;
    yanked?: boolean | string;
}

interface VersionFile {
    spec: string | null;
    yanked: boolean;
}

let cachedIndex: CachedPyPIIndex | undefined;
let indexRequest: Promise<PyPIIndex> | undefined;

async function fetchPyPIIndex(): Promise<PyPIIndex> {
    const response = await fetch('https://pypi.org/simple/', {
        headers: { Accept: 'application/vnd.pypi.simple.v1+json' },
    });
    if (!response.ok) {
        throw new Error(`Could not load the PyPI project index (HTTP ${response.status}).`);
    }
    const body = (await response.json()) as { projects?: Array<{ name?: unknown }> };
    const names = (body.projects ?? [])
        .map((project) => project.name)
        .filter((name): name is string => typeof name === 'string');
    const index = { names, normalizedNames: names.map((name) => name.toLowerCase()) };
    cachedIndex = { ...index, fetchedAt: Date.now() };
    return index;
}

async function getPyPIIndex(): Promise<PyPIIndex> {
    if (cachedIndex && Date.now() - cachedIndex.fetchedAt < PYPI_INDEX_TTL_MS) {
        return cachedIndex;
    }
    indexRequest ??= fetchPyPIIndex().finally(() => {
        indexRequest = undefined;
    });
    return indexRequest;
}

export function resetPyPIIndexCacheForTests(): void {
    cachedIndex = undefined;
    indexRequest = undefined;
}

export async function searchPyPI(query: string, token?: vscode.CancellationToken): Promise<LanguageRuntimePackage[]> {
    const { names, normalizedNames } = await getPyPIIndex();
    if (token?.isCancellationRequested) {
        throw new vscode.CancellationError();
    }

    const normalizedQuery = query.toLowerCase();
    const prefix: string[] = [];
    const contains: string[] = [];
    let exact: string | undefined;
    for (let index = 0; index < normalizedNames.length; index += 1) {
        const normalizedName = normalizedNames[index];
        if (normalizedName === normalizedQuery) {
            exact = names[index];
        }
        if (normalizedName.startsWith(normalizedQuery)) {
            if (prefix.length < PYPI_MAX_RESULTS) {
                prefix.push(names[index]);
            }
        } else if (normalizedName.includes(normalizedQuery) && contains.length < PYPI_MAX_RESULTS) {
            contains.push(names[index]);
        }
    }

    const results = prefix.concat(contains).slice(0, PYPI_MAX_RESULTS);
    if (exact && !results.includes(exact)) {
        results[Math.max(0, results.length - 1)] = exact;
    }
    return results.map((name) => ({
        id: name,
        name,
        displayName: name,
        version: '0',
    }));
}

function aggregateFilesByVersion(versions: string[], files: PyPIFile[]): Map<string, VersionFile[]> {
    const candidates = [...versions].sort((left, right) => right.length - left.length);
    const result = new Map<string, VersionFile[]>();
    for (const file of files) {
        const filename = file.filename.toLowerCase();
        const version = candidates.find((candidate) => {
            const marker = `-${candidate.toLowerCase()}`;
            const position = filename.indexOf(marker);
            if (position < 0) {
                return false;
            }
            const boundary = filename[position + marker.length];
            return boundary === undefined || boundary === '-' || boundary === '.' || boundary === '+';
        });
        if (!version) {
            continue;
        }
        const versionFiles = result.get(version) ?? [];
        versionFiles.push({
            spec: file['requires-python'] || null,
            yanked: file.yanked !== undefined && file.yanked !== false,
        });
        result.set(version, versionFiles);
    }
    return result;
}

function cancellationSignal(token?: vscode.CancellationToken): {
    signal?: AbortSignal;
    dispose(): void;
} {
    if (!token) {
        return { dispose: () => undefined };
    }
    const controller = new AbortController();
    const listener = token.onCancellationRequested(() => controller.abort());
    if (token.isCancellationRequested) {
        controller.abort();
    }
    return { signal: controller.signal, dispose: () => listener.dispose() };
}

export async function searchPyPIVersions(
    name: string,
    resolveSpecs?: (specs: string[]) => Promise<Record<string, boolean>>,
    token?: vscode.CancellationToken,
): Promise<string[]> {
    const cancellation = cancellationSignal(token);
    try {
        const response = await fetch(`https://pypi.org/simple/${encodeURIComponent(name)}/`, {
            headers: { Accept: 'application/vnd.pypi.simple.v1+json' },
            signal: cancellation.signal,
        });
        if (response.status === 404) {
            return [];
        }
        if (!response.ok) {
            throw new Error(`Could not look up versions of '${name}' on PyPI (HTTP ${response.status}).`);
        }

        const body = (await response.json()) as { versions?: string[]; files?: PyPIFile[] };
        const versions = body.versions ?? [];
        const files = body.files ?? [];
        if (files.length === 0) {
            return versions;
        }

        const byVersion = aggregateFilesByVersion(versions, files);
        let compatibility: Record<string, boolean> | undefined;
        if (resolveSpecs) {
            const specs = [
                ...new Set(
                    [...byVersion.values()]
                        .flat()
                        .map((file) => file.spec)
                        .filter((spec): spec is string => spec !== null),
                ),
            ];
            try {
                compatibility = specs.length === 0 ? {} : await resolveSpecs(specs);
            } catch {
                compatibility = undefined;
            }
        }

        return versions.filter((version) => {
            const versionFiles = byVersion.get(version);
            if (!versionFiles?.length) {
                return true;
            }
            return versionFiles.some(
                (file) => !file.yanked && (!compatibility || file.spec === null || compatibility[file.spec] === true),
            );
        });
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new vscode.CancellationError();
        }
        throw error;
    } finally {
        cancellation.dispose();
    }
}
