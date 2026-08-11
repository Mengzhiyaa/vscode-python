// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const IGNORED_FREEZE_LINES = new Set(['pkg-resources==0.0.0']);

export function normalizePackageName(name: string): string {
    return name.toLowerCase().replace(/[-_.]+/g, '-');
}

export function extractRequirementName(line: string): string | undefined {
    const value = line.trim();
    if (!value || value.startsWith('#') || value.startsWith('-')) {
        return undefined;
    }
    return value.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/)?.[1];
}

export function buildRequirementsFile(
    freezeLines: string[],
    targets: Array<{ name: string; version?: string }>,
): string {
    const targetSpecs = new Map(
        targets.map((target) => [
            normalizePackageName(target.name),
            target.version ? `${target.name}==${target.version}` : target.name,
        ]),
    );
    const usedTargets = new Set<string>();
    const output: string[] = [];

    for (const rawLine of freezeLines) {
        const line = rawLine.trimEnd();
        const trimmed = line.trim();
        if (!trimmed || IGNORED_FREEZE_LINES.has(trimmed)) {
            continue;
        }
        const name = extractRequirementName(line);
        if (name) {
            const normalizedName = normalizePackageName(name);
            const target = targetSpecs.get(normalizedName);
            if (target) {
                output.push(target);
                usedTargets.add(normalizedName);
                continue;
            }
            if (!line.includes('@')) {
                output.push(name);
                continue;
            }
        }
        output.push(line);
    }

    for (const [name, spec] of targetSpecs) {
        if (!usedTargets.has(name)) {
            output.push(spec);
        }
    }
    return `${output.join('\n')}\n`;
}
