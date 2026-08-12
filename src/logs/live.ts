import { ControlValues, CUSTOM_RANGE } from '../results/controls';

/** Fixed by the design: a follow mode that is cheap enough to leave running. */
export const POLL_INTERVAL_MS = 10_000;

/** The UI default, also used when a browser number input is blank or invalid. */
export const DEFAULT_LOG_LIMIT = 200;

/** Hard host-side retention/request bound for workflow-authored log records. */
export const MAX_LOG_LIMIT = 10_000;

/**
 * Maximum CLI pages drained by one tick. An incomplete catch-up resumes from
 * its proven boundary on the next tick instead of monopolising the extension.
 */
export const MAX_POLL_PAGES = 10;

/**
 * How far back before the previous poll's start the next window reaches.
 *
 * Request boundaries and clock differences between this machine and the platform
 * mean two exactly abutting windows can drop a record that landed on the seam.
 * Overlapping is free because the merge is occurrence-aware and removes the
 * repeat (src/logs/merge.ts).
 */
export const POLL_OVERLAP_MS = 2_000;

/** Everything the schedule depends on. Held by the panel, never by this module. */
export interface LiveState {
    enabled: boolean;
    /** Whether the webview panel is currently visible. */
    visible: boolean;
    /** Whether a CLI request is already in flight. */
    inFlight: boolean;
    /** When the last **successful** poll started, ms since epoch. */
    lastPollMs?: number;
    /**
     * Inclusive timestamp boundary for an incomplete full-page catch-up.
     * Unlike lastPollMs, this has already had overlap accounted for.
     */
    catchUpFromMs?: number;
}

/** What the webview shows beside the Live logs checkbox. */
export interface LiveStatus {
    enabled: boolean;
    /** Local time of the last successful poll, already formatted. */
    updatedAt?: string;
    /** Non-blocking poll failure. The entries on screen stay. */
    error?: string;
    /** Advice, e.g. a poll that came back exactly full. */
    warning?: string;
    /** Why live mode cannot run with the current controls. */
    disabledReason?: string;
}

/**
 * Why live mode is unavailable, or undefined when it can run.
 *
 * A custom absolute range is the one case: its window does not advance, so
 * polling it would return the same page forever and read as a broken feature.
 */
export function liveUnavailableReason(values: ControlValues): string | undefined {
    return String(values.range ?? '') === CUSTOM_RANGE
        ? 'Live logs needs a relative time range — a custom window does not advance.'
        : undefined;
}

/**
 * A browser number input can still post an empty string despite `min=1`.
 * Invalid/non-positive values return to the documented default; valid values
 * are integral and capped so both CLI responses and retained DOM stay bounded.
 */
export function normaliseLogLimit(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_LOG_LIMIT;
    }
    return Math.min(Math.max(1, Math.floor(parsed)), MAX_LOG_LIMIT);
}

export function normaliseLogValues(values: ControlValues): ControlValues {
    return { ...values, limit: normaliseLogLimit(values.limit) };
}

/** The interval only exists while the panel can actually show what it fetches. */
export function timerShouldRun(state: LiveState): boolean {
    return state.enabled && state.visible;
}

/** Whether this tick fetches. A tick that would overlap a running request is dropped. */
export function shouldPoll(state: LiveState): boolean {
    return state.enabled && !state.inFlight;
}

/**
 * The window for a poll starting at `nowMs`.
 *
 * Deliberately **not** the selected range. The CLI returns one ascending page
 * capped by `--limit`, so re-querying a wide old window in a busy environment
 * keeps returning that window's earliest entries and never reaches the newest
 * ones — the live view would sit frozen on old logs.
 */
export function pollWindow(state: LiveState, nowMs: number): { fromMs: number; toMs: number } {
    if (state.catchUpFromMs !== undefined) {
        return { fromMs: state.catchUpFromMs, toMs: nowMs };
    }

    const start = state.lastPollMs ?? nowMs - POLL_INTERVAL_MS;
    return { fromMs: start - POLL_OVERLAP_MS, toMs: nowMs };
}

/**
 * Control values describing an absolute poll window.
 *
 * Reuses the existing custom-range path rather than adding a second argument
 * builder: `buildLogArgs` already emits `--start`/`--end` for `range: 'custom'`,
 * and `normaliseTime` passes an RFC3339 instant through untouched.
 */
export function pollValues(values: ControlValues, fromMs: number, toMs: number): ControlValues {
    return {
        ...values,
        range: CUSTOM_RANGE,
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
    };
}

/**
 * Inclusive start for the next ascending CLI page.
 *
 * A full page proves only that records through its newest timestamp were
 * consumed. Returning that boundary (rather than the poll start/"now") lets the
 * next page overlap safely; mergeEntries removes repeats. No finite timestamp
 * strictly after `fromMs` means the CLI cannot paginate this page without a
 * cursor, so the caller must stop rather than skip same-timestamp records.
 */
export function nextPollCursor(
    entries: Array<{ rawTimestamp: string }>,
    fromMs: number,
): number | undefined {
    let boundary = Number.NEGATIVE_INFINITY;
    for (const entry of entries) {
        const timestamp = Date.parse(entry.rawTimestamp);
        if (Number.isFinite(timestamp)) {
            boundary = Math.max(boundary, timestamp);
        }
    }

    return boundary > fromMs ? boundary : undefined;
}

/**
 * Advice when a full poll could not be completely drained this tick.
 *
 * The cursor remains at the last consumed boundary, so later records have not
 * been skipped; the next tick continues from there.
 */
export function truncationWarning(received: number, limit: number): string | undefined {
    return limit > 0 && received >= limit
        ? `This interval returned the full ${limit}-entry Limit. Live is still catching up from the last consumed timestamp; raise Limit or narrow the server-side Search.`
        : undefined;
}
