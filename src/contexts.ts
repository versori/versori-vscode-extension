export interface ContextEntry {
    /** Context name, with the active-marker asterisk stripped. */
    name: string;
    /** True when the CLI marked this as the active context. */
    active: boolean;
}

/**
 * Parse `versori context list -o json`.
 *
 * The CLI wraps rows as `{"type":"Context","items":[{"Name":...}]}`, and the
 * table formatter's active marker leaks into the JSON: the active row's `Name`
 * is literally `"*rithum"`. That asterisk is not part of the name — passing it
 * to `context select` would fail — so it is stripped here and surfaced as
 * {@link ContextEntry.active} instead.
 *
 * Other shapes are tolerated so a future CLI change degrades to an empty list
 * rather than throwing.
 */
export function parseContextList(raw: unknown): ContextEntry[] {
    return toArray(raw)
        .map(toName)
        .filter((name): name is string => Boolean(name))
        .map((name) =>
            name.startsWith('*')
                ? { name: name.slice(1), active: true }
                : { name, active: false },
        );
}

function toArray(raw: unknown): unknown[] {
    if (Array.isArray(raw)) {
        return raw;
    }

    const record = raw as { items?: unknown; contexts?: unknown } | null | undefined;

    if (Array.isArray(record?.items)) {
        return record.items;
    }
    if (Array.isArray(record?.contexts)) {
        return record.contexts;
    }

    return [];
}

function toName(entry: unknown): string | undefined {
    if (typeof entry === 'string') {
        return entry;
    }

    const record = entry as { Name?: unknown; name?: unknown } | null | undefined;
    const name = record?.Name ?? record?.name;

    return typeof name === 'string' && name ? name : undefined;
}
