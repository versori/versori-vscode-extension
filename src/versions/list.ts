import { envelopeItems, text } from '../cli-json';
import { SelectChoice } from '../forms/types';

export interface VersionEntry {
    id: string;
    name: string;
    description: string;
    createdAt: string;
}

/**
 * `YYYY-MM-DD HH:mm` in local time, or `''` when `iso` is empty or unparseable.
 *
 * Digits and separators only — `toLocaleString` is not used, so the string is
 * the same on a machine whose locale would otherwise spell the month.
 */
export function formatVersionTimestamp(iso: string): string {
    const value = iso.trim();
    if (!value) {
        return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    const pad = (n: number) => String(n).padStart(2, '0');
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
}

function versionDetail(version: VersionEntry): string {
    const timestamp = formatVersionTimestamp(version.createdAt);
    const parts = [timestamp, version.description].filter((part) => part !== '');
    return parts.join(' · ') || version.id;
}

export interface VersionPickItem {
    label: string;
    description: string;
    value: VersionEntry;
}

/** The Sync form's default: no `--version`, so the CLI syncs current files. */
export const LATEST_VERSION_VALUE = '';
export const LATEST_VERSION_LABEL = 'Latest (current files)';

/**
 * Parse the `{ type, items: [...] }` envelope `projects versions list -o json`
 * emits.
 *
 * A row with no id is dropped rather than surfaced: `--version` takes an id, so
 * an unidentifiable row could only produce a command that fails.
 */
export function parseVersionList(raw: unknown): VersionEntry[] {
    return envelopeItems(raw, ['items', 'versions', 'results'])
        .map((entry) => {
            if (!entry || typeof entry !== 'object') {
                return undefined;
            }

            const record = entry as Record<string, unknown>;
            const id = text(record.id ?? record.Id ?? record.ID);
            if (!id) {
                return undefined;
            }

            return {
                id,
                name: text(record.name ?? record.Name) || id,
                description: text(record.description ?? record.Description),
                createdAt: text(record.createdAt ?? record.CreatedAt),
            };
        })
        .filter((entry): entry is VersionEntry => entry !== undefined);
}

/**
 * Choices for the Sync form's Version select.
 *
 * Latest is first and its value is the empty string, which is what keeps
 * `--version` off the argv entirely for the default pick.
 */
export function versionSelectChoices(versions: VersionEntry[]): SelectChoice[] {
    return [
        {
            label: LATEST_VERSION_LABEL,
            description: "the project's current files",
            value: LATEST_VERSION_VALUE,
        },
        ...versions.map((version) => ({
            label: version.name,
            description: versionDetail(version),
            value: version.id,
        })),
    ];
}

/**
 * Rows for the Compare Version QuickPick, in the order the CLI returned them
 * (newest first). Deliberately not re-sorted.
 */
export function versionPickItems(versions: VersionEntry[]): VersionPickItem[] {
    return versions.map((version) => ({
        label: `$(history) ${version.name}`,
        description: versionDetail(version),
        value: version,
    }));
}
