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
 * True when the platform rejected a `kv list` because the response exceeded the
 * gRPC max message size (~4 MiB). Values travel with every key on the page, so
 * a few large blobs — or one huge one — trip this even at a modest `--limit`.
 */
export function isKvMessageTooLarge(message: string): boolean {
    return /received message larger than max/i.test(message);
}

/**
 * The `--limit` we would send, or `0` when the flag is omitted (server default).
 */
export function effectiveKvLimit(values: ControlValues): number {
    const limit = Number(values.limit ?? 0);
    if (!Number.isFinite(limit) || limit <= 0) {
        return 0;
    }
    return Math.min(Math.floor(limit), MAX_LIMIT);
}

/**
 * Whether a failed list should be retried as a single-entry page.
 *
 * Skips the retry when the request was already `--limit 1` — that cannot shrink
 * further, and the error then means one value alone exceeds the API ceiling.
 */
export function shouldRetryKvListWithLimitOne(
    values: ControlValues,
    errorMessage: string,
): boolean {
    return isKvMessageTooLarge(errorMessage) && effectiveKvLimit(values) !== 1;
}

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
 * Non-empty `--prefix` segments from a slash-delimited control value.
 *
 * Empty segments from a stray slash are dropped so they cannot widen a wipe or
 * silently change a list query.
 */
export function kvPrefixSegments(values: ControlValues): string[] {
    return String(values.prefix ?? '')
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean);
}

/**
 * Friendly-mode scope targeting shared by every KV command: `--scope`,
 * `--environment`, and the identifier that scope requires.
 *
 * Deliberately omits `--prefix` — that flag is only registered on list / count /
 * wipe. Passing it to set or delete is an unknown-flag error.
 */
export function buildKvScopeArgs(values: ControlValues): string[] {
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

    return args;
}

/**
 * Scope targeting plus optional `--prefix` segments for list / count / wipe.
 *
 * Shared rather than restated so a count or wipe can never answer for a
 * different slice of the store than the list on screen. `--prefix` is a
 * repeatable **segment** flag, not a single path, so a slash-delimited entry is
 * split. `--scope` and `--store` are mutually exclusive; this only ever uses
 * `--scope`.
 */
export function buildKvTargetArgs(values: ControlValues): string[] {
    const args = buildKvScopeArgs(values);

    for (const segment of kvPrefixSegments(values)) {
        args.push('--prefix', segment);
    }

    return args;
}

/** Reject blank keys before they reach `kv set` / `kv delete`. */
export function validateKvKey(key: string): string | undefined {
    if (!key.trim()) {
        return 'Key must not be blank.';
    }
    return undefined;
}

/**
 * Refuse an empty wipe prefix in the extension.
 *
 * Friendly `--scope` already prepends org/project/env segments in the CLI, so a
 * blank control prefix would still wipe an entire scope. That is never an
 * accidental click we want to allow from the panel.
 */
export function validateKvWipePrefix(values: ControlValues): string | undefined {
    if (kvPrefixSegments(values).length === 0) {
        return 'Wipe requires a non-empty key prefix — refusing to target an entire scope.';
    }
    return undefined;
}

export interface KvSetOptions {
    /** Slash-delimited key relative to the selected scope. */
    key: string;
    /** Stored as JSON when valid, otherwise as a string — same as the CLI. */
    value: string;
    /** TTL in milliseconds; omitted or ≤0 means no expiry. */
    expireInMs?: number;
    /** Only set when the key does not already exist. */
    ifNotExists?: boolean;
}

/**
 * The CLI rejects an empty `--value` flag before it reaches its JSON encoder.
 * Encode an intentional empty string as JSON so the mutation still round-trips
 * as a valid blank value; all other input is left byte-for-byte unchanged.
 */
export function encodeKvValue(value: string): string {
    return value === '' ? '""' : value;
}

/**
 * Flags for `kv set` (non-interactive).
 *
 * Always includes `--yes`: the extension has already confirmed via a VS Code
 * modal, and a spawned CLI has no TTY for the interactive prompt.
 */
export function buildKvSetArgs(values: ControlValues, options: KvSetOptions): string[] {
    const keyError = validateKvKey(options.key);
    if (keyError) {
        throw new Error(keyError);
    }

    const args = [
        ...buildKvScopeArgs(values),
        '--key',
        options.key.trim(),
        '--value',
        encodeKvValue(options.value),
        '--yes',
    ];

    if (
        options.expireInMs !== undefined &&
        Number.isFinite(options.expireInMs) &&
        options.expireInMs > 0
    ) {
        args.push('--expire-in', String(Math.floor(options.expireInMs)));
    }
    if (options.ifNotExists) {
        args.push('--if-not-exists');
    }

    return args;
}

/**
 * Flags for `kv delete` (non-interactive). Always includes `--yes` after a
 * host-side modal confirmation.
 */
export function buildKvDeleteArgs(values: ControlValues, key: string): string[] {
    const keyError = validateKvKey(key);
    if (keyError) {
        throw new Error(keyError);
    }

    return [...buildKvScopeArgs(values), '--key', key.trim(), '--yes'];
}

/**
 * Flags for `kv wipe`.
 *
 * Pass `confirm: false` for the safe dry-run preview (CLI counts and prints
 * what would be deleted). Pass `confirm: true` only after the host modal.
 */
export function buildKvWipeArgs(values: ControlValues, confirm: boolean): string[] {
    const wipeError = validateKvWipePrefix(values);
    if (wipeError) {
        throw new Error(wipeError);
    }

    const args = buildKvTargetArgs(values);
    if (confirm) {
        args.push('--confirm');
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
    const args = buildKvTargetArgs(values);

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
    return buildKvTargetArgs(values);
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
