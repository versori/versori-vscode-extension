import {
    Control,
    ControlValues,
    environmentArgs,
    environmentControl,
    SelectOption,
} from '../results/controls';

/** The friendly scopes `kv list --scope` accepts. */
export const KV_SCOPES: SelectOption[] = [
    { value: 'organization', label: 'Organisation' },
    { value: 'workspace', label: 'Workspace' },
    { value: 'project', label: 'Project' },
    { value: 'user', label: 'End user' },
    { value: 'execution', label: 'Execution' },
];

/** Server maximum for one page. */
const MAX_LIMIT = 100;

/**
 * A page position, expressed with the CLI's own opaque cursors.
 *
 * Both fields hold a cursor copied **verbatim** from a previous response's
 * `pagination`. The CLI's help is explicit that these are opaque and must never
 * be a key, so nothing here parses, trims or derives one — a synthesised cursor
 * would silently return the wrong page rather than fail.
 *
 * The two are mutually exclusive; only one is ever set.
 */
export interface KvCursor {
    /** A previous response's `nextCursor`, for the following page. */
    after?: string;
    /** A previous response's `prevCursor`, for the preceding page. */
    before?: string;
}

export function kvControls(environments: string[]): Control[] {
    return [
        environmentControl(environments),
        { kind: 'select', id: 'scope', label: 'Scope', value: 'project', options: KV_SCOPES },
        {
            kind: 'text',
            id: 'externalId',
            label: 'End-user external id',
            value: '',
            placeholder: 'required for this scope',
            showWhen: { field: 'scope', equals: 'user' },
        },
        {
            kind: 'text',
            id: 'executionId',
            label: 'Execution id',
            value: '',
            placeholder: 'required for this scope',
            showWhen: { field: 'scope', equals: 'execution' },
        },
        {
            kind: 'text',
            id: 'prefix',
            label: 'Key prefix',
            value: '',
            placeholder: 'e.g. orders/cursor',
        },
        { kind: 'number', id: 'limit', label: 'Page size', value: 50, min: 0 },
        {
            kind: 'select',
            id: 'keys',
            label: 'Keys',
            value: 'stripped',
            options: [
                { value: 'stripped', label: 'Scope prefix stripped' },
                { value: 'full', label: 'Full resolved keys' },
            ],
        },
        {
            kind: 'select',
            id: 'values',
            label: 'Values',
            value: 'unwrapped',
            options: [
                { value: 'unwrapped', label: 'Unwrapped (as workflows read them)' },
                { value: 'raw', label: 'Exactly as stored' },
            ],
        },
    ];
}

/**
 * What both read commands aim at: the scope, its environment, the identifier
 * that scope requires, and the key prefix.
 *
 * Shared rather than restated so a count can never answer for a different slice
 * of the store than the list on screen. `--prefix` is a repeatable **segment**
 * flag, not a single path, so a slash-delimited entry is split. `--scope` and
 * `--store` are mutually exclusive; this only ever uses `--scope`.
 */
function targetArgs(values: ControlValues): string[] {
    const scope = String(values.scope ?? 'project');
    const args = ['--scope', scope, ...environmentArgs(values)];

    // Only send the identifier the chosen scope actually uses — a leftover value
    // from a previous scope would otherwise narrow the query invisibly.
    if (scope === 'user') {
        const externalId = String(values.externalId ?? '').trim();
        if (externalId) {
            args.push('--external-id', externalId);
        }
    }
    if (scope === 'execution') {
        const executionId = String(values.executionId ?? '').trim();
        if (executionId) {
            args.push('--execution-id', executionId);
        }
    }

    for (const segment of String(values.prefix ?? '')
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean)) {
        args.push('--prefix', segment);
    }

    return args;
}

/**
 * Flags for `kv list` in friendly mode.
 *
 * Read-only by construction: `kv list` is the only subcommand this builds for,
 * and no flag here writes anything.
 */
export function buildKvListArgs(values: ControlValues, cursor: KvCursor = {}): string[] {
    const args = targetArgs(values);

    const limit = Number(values.limit ?? 0);
    if (Number.isFinite(limit) && limit > 0) {
        args.push('--limit', String(Math.min(Math.floor(limit), MAX_LIMIT)));
    }

    if (String(values.keys ?? '') === 'full') {
        args.push('--full-keys');
    }
    if (String(values.values ?? '') === 'raw') {
        args.push('--raw-values');
    }

    // Passed through byte-for-byte. An empty cursor is the CLI's own "no more
    // entries" signal, so it is dropped rather than sent as an empty flag.
    if (cursor.after) {
        args.push('--after', cursor.after);
    } else if (cursor.before) {
        args.push('--before', cursor.before);
    }

    return args;
}

/**
 * Flags for `kv count` — the authoritative total under a prefix.
 *
 * Targeting only. Verified against `cli/pkg/cmd/kv/count.go`, which registers
 * just the scope flags and `--prefix`:
 *
 * - **No `--limit`.** The command returns a total, not a capped page, and the
 *   flag is not registered — passing it is an unknown-flag error.
 * - **No `--after` / `--before`.** `kv count` does not paginate, which is
 *   precisely why it is worth a second call.
 * - **No `--raw-values`.** Also unregistered here; it only affects how `list`
 *   renders a value.
 * - **No `--full-keys`.** Registered (it comes with the scope flags) but
 *   display-only, so it cannot change a number.
 */
export function buildKvCountArgs(values: ControlValues): string[] {
    return targetArgs(values);
}

/** Human-readable problem with the current selection, or undefined when valid. */
export function validateKvScope(values: ControlValues): string | undefined {
    const scope = String(values.scope ?? 'project');

    if (scope === 'user' && !String(values.externalId ?? '').trim()) {
        return 'The end-user scope needs an external id.';
    }
    if (scope === 'execution' && !String(values.executionId ?? '').trim()) {
        return 'The execution scope needs an execution id.';
    }

    return undefined;
}
