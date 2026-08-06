export interface SelectOption {
    value: string;
    label: string;
}

/** Show a control only while another control holds a given value. */
export interface ShowWhen {
    field: string;
    equals: string;
}

export type Control =
    | { kind: 'select'; id: string; label: string; value: string; options: SelectOption[] }
    | { kind: 'datetime'; id: string; label: string; value: string; showWhen?: ShowWhen }
    | { kind: 'number'; id: string; label: string; value: number; min?: number }
    | {
          kind: 'text';
          id: string;
          label: string;
          value: string;
          placeholder?: string;
          showWhen?: ShowWhen;
      };

export type ControlValues = Record<string, string | number>;

/**
 * Reconcile held control values against a freshly built control set.
 *
 * Every panel keeps its control values across a reuse (reveal-and-reload), which
 * is what lets a chosen time range or search survive reopening the panel. But
 * reopening from a *different* project rebuilds the controls, and a value that
 * was valid for project A need not exist in project B. Left alone, the
 * environment select rendered B's options while the held value was still A's
 * name: no `<option>` matched, so the browser displayed option[0] while the host
 * queried A — the panel querying an environment it was not displaying, producing
 * an error the UI could not explain.
 *
 * So, per control:
 * - a still-valid held value is kept, because losing a deliberate choice on
 *   every reopen would be its own annoyance;
 * - anything else falls back to the new control's own default;
 * - controls that no longer exist have their values dropped, since keying the
 *   result off `controls` means only live ids survive.
 *
 * Only `select` can be invalid — it is the one kind with a closed set of
 * options. Free-text, number and datetime controls (prefix, externalId, search,
 * limit, a custom time range) mean the same thing in any project, so they are
 * deliberately passed through untouched.
 */
export function retargetValues(controls: Control[], values: ControlValues): ControlValues {
    return Object.fromEntries(
        controls.map((control): [string, string | number] => {
            const held = values[control.id];
            // String() on both sides: a select's options are strings, while a
            // held value may have arrived as a number.
            const valid =
                control.kind !== 'select' ||
                control.options.some((option) => option.value === String(held));

            return [control.id, valid && held !== undefined ? held : control.value];
        }),
    );
}

export const CUSTOM_RANGE = 'custom';

/**
 * Trailing-window presets for `--since`.
 *
 * Values are Go durations: `time.ParseDuration` supports ns/us/ms/s/m/h and
 * **no day unit**, so multi-day windows are expressed in hours.
 */
export const RANGE_PRESETS: SelectOption[] = [
    { value: '15m', label: 'Last 15 minutes' },
    { value: '1h', label: 'Last hour' },
    { value: '6h', label: 'Last 6 hours' },
    { value: '24h', label: 'Last 24 hours' },
    { value: '72h', label: 'Last 3 days' },
    { value: '168h', label: 'Last 7 days' },
    { value: CUSTOM_RANGE, label: 'Custom range...' },
];

/**
 * Coerce a browser datetime-local value into a format the CLI accepts.
 *
 * `--start`/`--end` take RFC3339, `YYYY-MM-DDTHH:MM:SS`, or `YYYY-MM-DD`.
 * A datetime-local input yields `YYYY-MM-DDTHH:MM`, one field short.
 */
export function normaliseTime(value: string): string {
    const text = value.trim();

    if (!text) {
        return '';
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return text;
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) {
        return `${text}:00`;
    }

    return text;
}

/**
 * Time and limit flags for `projects logs`.
 *
 * `--since` and `--start`/`--end` are mutually exclusive, so exactly one branch
 * runs and the pair can never both be emitted.
 */
export function buildLogArgs(values: ControlValues): string[] {
    const args: string[] = [];
    const range = String(values.range ?? '1h');

    if (range === CUSTOM_RANGE) {
        const start = normaliseTime(String(values.from ?? ''));
        if (start) {
            args.push('--start', start);
        }

        // Omitting --end is valid: the CLI defaults it to 7 days after --start.
        const end = normaliseTime(String(values.to ?? ''));
        if (end) {
            args.push('--end', end);
        }
    } else {
        args.push('--since', range);
    }

    const limit = Number(values.limit ?? 200);
    if (Number.isFinite(limit) && limit > 0) {
        args.push('--limit', String(Math.floor(limit)));
    }

    // Server-side and include-only — the CLI has no exclude flag, which is why
    // exclusion lives in src/logs/filter.ts and runs over the fetched page.
    const search = String(values.search ?? '').trim();
    if (search) {
        args.push('--search', search);
    }

    return args;
}

/** Human-readable problem with the current selection, or undefined when valid. */
export function validateLogRange(values: ControlValues): string | undefined {
    if (String(values.range ?? '') !== CUSTOM_RANGE) {
        return undefined;
    }

    const from = normaliseTime(String(values.from ?? ''));
    if (!from) {
        return 'Choose a start time, or pick a preset range.';
    }

    const to = normaliseTime(String(values.to ?? ''));
    if (to && new Date(to).getTime() < new Date(from).getTime()) {
        return 'The end time is before the start time.';
    }

    return undefined;
}

/** Window description for the panel heading. */
export function describeRange(values: ControlValues): string {
    const range = String(values.range ?? '1h');

    if (range !== CUSTOM_RANGE) {
        return RANGE_PRESETS.find((p) => p.value === range)?.label ?? range;
    }

    const from = normaliseTime(String(values.from ?? ''));
    const to = normaliseTime(String(values.to ?? ''));

    if (!from) {
        return 'Custom range';
    }

    return to ? `${from} to ${to}` : `since ${from}`;
}

export const ENVIRONMENT_ID = 'environment';

/**
 * Environment picker for a panel's control row.
 *
 * Defaulting to `names[0]` is what makes a single-environment project need no
 * choice at all, while keeping the value changeable in place — the reason this
 * is a control rather than a QuickPick shown before the panel opens.
 */
export function environmentControl(names: string[]): Control {
    return {
        kind: 'select',
        id: ENVIRONMENT_ID,
        label: 'Environment',
        value: names[0] ?? '',
        options: names.map((name) => ({ value: name, label: name })),
    };
}

export function environmentArgs(values: ControlValues): string[] {
    const name = String(values[ENVIRONMENT_ID] ?? '').trim();
    return name ? ['--environment', name] : [];
}

export function logControls(): Control[] {
    return [
        { kind: 'select', id: 'range', label: 'Time range', value: '1h', options: RANGE_PRESETS },
        {
            kind: 'datetime',
            id: 'from',
            label: 'From',
            value: '',
            showWhen: { field: 'range', equals: CUSTOM_RANGE },
        },
        {
            kind: 'datetime',
            id: 'to',
            label: 'To',
            value: '',
            showWhen: { field: 'range', equals: CUSTOM_RANGE },
        },
        { kind: 'number', id: 'limit', label: 'Limit', value: 200, min: 1 },
    ];
}

export function searchControl(): Control {
    return {
        kind: 'text',
        id: 'search',
        label: 'Search (server-side)',
        value: '',
        placeholder: 'passed to --search',
    };
}
