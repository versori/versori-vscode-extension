import { unwrapRows } from '../results/rows';

/** Runtime store naming: ORG_<org>, PROJECT_<project>, EXECUTION_<project>. */
export type KvStoreKind = 'organization' | 'project' | 'execution' | 'unknown';

export interface KvStoreRecord {
    id: string;
    name: string;
}

export interface ParsedKvStoreName {
    kind: KvStoreKind;
    /** Organisation id for ORG_ stores; project id for PROJECT_/EXECUTION_. */
    subjectId: string;
    rawName: string;
}

export interface ProjectRef {
    id: string;
    name: string;
}

export interface EnrichedKvStore extends KvStoreRecord {
    kind: KvStoreKind;
    /** Present for PROJECT_ / EXECUTION_ stores. */
    projectId?: string;
    /** Best-effort join from `projects list`; falls back to the project id. */
    projectName?: string;
    /** Label used for grouping in the panel. */
    group: string;
    storeType: string;
}

export interface KvStoreGroup {
    label: string;
    stores: EnrichedKvStore[];
}

const STORE_NAME =
    /^(ORG|PROJECT|EXECUTION)_(.+)$/;

/**
 * Parse a runtime store name into kind + subject id.
 *
 * Unknown shapes keep `kind: 'unknown'` and leave the whole name as the subject
 * so the panel can still list them without inventing a project.
 */
export function parseKvStoreName(name: string): ParsedKvStoreName {
    const trimmed = name.trim();
    const match = STORE_NAME.exec(trimmed);
    if (!match) {
        return { kind: 'unknown', subjectId: trimmed, rawName: trimmed };
    }

    const kindToken = match[1];
    const subjectId = match[2];
    if (kindToken === 'ORG') {
        return { kind: 'organization', subjectId, rawName: trimmed };
    }
    if (kindToken === 'PROJECT') {
        return { kind: 'project', subjectId, rawName: trimmed };
    }
    return { kind: 'execution', subjectId, rawName: trimmed };
}

/**
 * Pull `{ name, id }` rows out of `kv stores list -o json`.
 *
 * Accepts a bare array, `{ items }`, `{ stores }`, or `{ results }` — Print()
 * may wrap a slice, and the API envelope uses `stores`.
 */
export function parseKvStoresList(raw: unknown): KvStoreRecord[] {
    const rows = storeRows(raw);

    return rows
        .map((row) => {
            const id = text(row.id ?? row.Id ?? row.ID);
            const name = text(row.name ?? row.Name);
            if (!id && !name) {
                return undefined;
            }
            return { id: id || name, name: name || id };
        })
        .filter((row): row is KvStoreRecord => row !== undefined);
}

/**
 * Pull `{ id, name }` from `projects list -o json`.
 *
 * Mirrors the sync panel's tolerant envelope handling without importing that
 * module (keeps this track self-contained under `src/kv`).
 */
export function parseProjectRefs(raw: unknown): ProjectRef[] {
    const rows = projectRows(raw);

    return rows
        .map((row) => {
            const id = text(row.id ?? row.Id ?? row.ID);
            if (!id) {
                return undefined;
            }
            return { id, name: text(row.name ?? row.Name) || id };
        })
        .filter((row): row is ProjectRef => row !== undefined);
}

/** Join store prefixes to project names when possible. */
export function enrichKvStores(
    stores: KvStoreRecord[],
    projects: ProjectRef[],
): EnrichedKvStore[] {
    const names = new Map(projects.map((project) => [project.id, project.name]));

    return stores.map((store) => {
        const parsed = parseKvStoreName(store.name);
        const storeType = storeTypeLabel(parsed.kind);

        if (parsed.kind === 'organization') {
            return {
                ...store,
                kind: parsed.kind,
                group: `Organisation · ${parsed.subjectId || store.name}`,
                storeType,
            };
        }

        if (parsed.kind === 'project' || parsed.kind === 'execution') {
            const projectId = parsed.subjectId;
            const projectName = names.get(projectId) || projectId || store.name;
            return {
                ...store,
                kind: parsed.kind,
                projectId,
                projectName,
                group: projectName,
                storeType,
            };
        }

        return {
            ...store,
            kind: 'unknown',
            group: store.name || store.id || 'Unknown store',
            storeType,
        };
    });
}

/**
 * Group enriched stores by their display label (project name, or org / fallback).
 *
 * Groups are sorted alphabetically; stores inside a group keep the CLI order.
 */
export function groupKvStores(stores: EnrichedKvStore[]): KvStoreGroup[] {
    const groups = new Map<string, EnrichedKvStore[]>();

    for (const store of stores) {
        const list = groups.get(store.group) ?? [];
        list.push(store);
        groups.set(store.group, list);
    }

    return [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, grouped]) => ({ label, stores: grouped }));
}

/** Flatten groups into table rows with an explicit `group` column. */
export function kvStoreTableRows(groups: KvStoreGroup[]): Array<Record<string, string>> {
    const rows: Array<Record<string, string>> = [];

    for (const group of groups) {
        for (const store of group.stores) {
            rows.push({
                group: group.label,
                storeType: store.storeType,
                name: store.name,
                id: store.id,
                projectId: store.projectId ?? '',
                projectName: store.projectName ?? '',
            });
        }
    }

    return rows;
}

function storeTypeLabel(kind: KvStoreKind): string {
    switch (kind) {
        case 'organization':
            return 'Organisation';
        case 'project':
            return 'Project';
        case 'execution':
            return 'Execution';
        default:
            return 'Unknown';
    }
}

function storeRows(raw: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(raw)) {
        return raw.filter(isRecord);
    }
    if (!raw || typeof raw !== 'object') {
        return [];
    }

    const record = raw as Record<string, unknown>;
    for (const key of ['stores', 'items', 'results', 'data']) {
        if (Array.isArray(record[key])) {
            return (record[key] as unknown[]).filter(isRecord);
        }
    }

    // Last resort: unwrapRows treats a single object as one row.
    return unwrapRows(raw);
}

function projectRows(raw: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(raw)) {
        return raw.filter(isRecord);
    }
    if (!raw || typeof raw !== 'object') {
        return [];
    }

    const record = raw as Record<string, unknown>;
    for (const key of ['projects', 'items', 'results', 'data']) {
        if (Array.isArray(record[key])) {
            return (record[key] as unknown[]).filter(isRecord);
        }
    }

    return unwrapRows(raw);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}
