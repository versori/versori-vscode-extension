import { ControlValues, CUSTOM_RANGE } from '../results/controls';

/** Fixed by the design: a follow mode that is cheap enough to leave running. */
export const POLL_INTERVAL_MS = 10_000;

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
 * Advice when a poll came back exactly full.
 *
 * A response at the limit means the interval probably held more than was
 * returned, so the page may have a hole the merge cannot see.
 */
export function truncationWarning(received: number, limit: number): string | undefined {
    return limit > 0 && received >= limit
        ? `This interval returned the full ${limit}-entry Limit, so some logs may be missing. Raise Limit or narrow the server-side Search.`
        : undefined;
}
