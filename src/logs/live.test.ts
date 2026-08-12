import { describe, expect, it } from 'vitest';

import { buildLogArgs, CUSTOM_RANGE } from '../results/controls';
import {
    liveUnavailableReason,
    POLL_INTERVAL_MS,
    POLL_OVERLAP_MS,
    pollValues,
    pollWindow,
    shouldPoll,
    timerShouldRun,
    truncationWarning,
} from './live';

const values = { environment: 'production', range: '1h', limit: 200, search: 'orders' };

describe('POLL_INTERVAL_MS', () => {
    it('is the specified 10 seconds', () => {
        expect(POLL_INTERVAL_MS).toBe(10_000);
    });
});

describe('liveUnavailableReason', () => {
    it('allows a relative range', () => {
        expect(liveUnavailableReason(values)).toBeUndefined();
    });

    it('refuses a custom absolute range, because that window does not advance', () => {
        const reason = liveUnavailableReason({ ...values, range: CUSTOM_RANGE });
        expect(reason).toMatch(/relative/i);
    });
});

describe('timerShouldRun', () => {
    it('runs while enabled and visible', () => {
        expect(timerShouldRun({ enabled: true, visible: true, inFlight: false })).toBe(true);
    });

    it('stops when disabled', () => {
        expect(timerShouldRun({ enabled: false, visible: true, inFlight: false })).toBe(false);
    });

    it('stops while the panel is hidden, so a background panel does not keep spawning the CLI', () => {
        expect(timerShouldRun({ enabled: true, visible: false, inFlight: false })).toBe(false);
    });

    it('stops when both disabled and hidden', () => {
        expect(timerShouldRun({ enabled: false, visible: false, inFlight: false })).toBe(false);
    });
});

describe('shouldPoll', () => {
    it('polls on a tick when idle', () => {
        expect(shouldPoll({ enabled: true, visible: true, inFlight: false })).toBe(true);
    });

    it('skips a tick while the previous request is still running, so polls cannot overlap', () => {
        expect(shouldPoll({ enabled: true, visible: true, inFlight: true })).toBe(false);
    });

    it('does not poll when live mode is off', () => {
        expect(shouldPoll({ enabled: false, visible: true, inFlight: false })).toBe(false);
    });
});

describe('pollWindow', () => {
    it('covers from just before the last successful poll to now, so a log written on the seam is not lost', () => {
        const state = { enabled: true, visible: true, inFlight: false, lastPollMs: 1_000_000 };
        expect(pollWindow(state, 1_010_000)).toEqual({
            fromMs: 1_000_000 - POLL_OVERLAP_MS,
            toMs: 1_010_000,
        });
    });

    it('falls back to one interval plus the overlap when no poll has succeeded yet', () => {
        const state = { enabled: true, visible: true, inFlight: false };
        expect(pollWindow(state, 1_010_000)).toEqual({
            fromMs: 1_010_000 - POLL_INTERVAL_MS - POLL_OVERLAP_MS,
            toMs: 1_010_000,
        });
    });
});

describe('pollValues', () => {
    it('turns the moving window into an absolute range while keeping limit and server-side search', () => {
        const next = pollValues(values, Date.parse('2026-08-12T10:00:00Z'), Date.parse('2026-08-12T10:00:10Z'));

        expect(next.range).toBe(CUSTOM_RANGE);
        expect(buildLogArgs(next)).toEqual([
            '--start',
            '2026-08-12T10:00:00.000Z',
            '--end',
            '2026-08-12T10:00:10.000Z',
            '--limit',
            '200',
            '--search',
            'orders',
        ]);
    });

    it("does not mutate the panel's own control values", () => {
        const held = { ...values };
        const next = pollValues(held, 0, 1);
        // Identity check: a mutate-in-place impl that returned `held` would fail this.
        expect(next).not.toBe(held);
        expect(held).toEqual(values);
        expect(next.range).toBe(CUSTOM_RANGE);
    });
});

describe('truncationWarning', () => {
    it('warns when a poll came back exactly full, because the interval may be cut short', () => {
        expect(truncationWarning(200, 200)).toMatch(/Limit/);
    });

    it('says nothing when the response was not full', () => {
        expect(truncationWarning(12, 200)).toBeUndefined();
    });
});
