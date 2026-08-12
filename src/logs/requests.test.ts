import { describe, expect, it } from 'vitest';

import { RequestGate } from './requests';

describe('RequestGate', () => {
    it('rejects a stale response after the control generation changes', () => {
        const gate = new RequestGate();
        const stale = gate.begin('project-a|production', false);

        gate.invalidate();
        const current = gate.begin('project-a|production', false);

        expect(stale.signal.aborted).toBe(true);
        expect(gate.isCurrent(stale, 'project-a|production', false)).toBe(false);
        expect(gate.isCurrent(current, 'project-a|production', false)).toBe(true);
    });

    it('rejects a response whose target no longer matches', () => {
        const gate = new RequestGate();
        const request = gate.begin('project-a|production', false);

        expect(gate.isCurrent(request, 'project-b|production', false)).toBe(false);
    });

    it('rejects a live response after live mode is disabled', () => {
        const gate = new RequestGate();
        const poll = gate.begin('project-a|production', true);

        expect(gate.isCurrent(poll, 'project-a|production', false)).toBe(false);
    });

    it('aborts every active child and rejects its continuation on disposal', () => {
        const gate = new RequestGate();
        const load = gate.begin('project-a|production', false);
        const poll = gate.begin('project-a|production', true);

        gate.dispose();

        expect(load.signal.aborted).toBe(true);
        expect(poll.signal.aborted).toBe(true);
        expect(gate.isCurrent(load, 'project-a|production', true)).toBe(false);
        expect(gate.isCurrent(poll, 'project-a|production', true)).toBe(false);
    });

    it('does not let a stale completion release a newer generation', () => {
        const gate = new RequestGate();
        const stale = gate.begin('project-a|production', true);
        gate.invalidate();
        const current = gate.begin('project-a|production', true);

        expect(gate.finish(stale)).toBe(false);
        expect(gate.finish(current)).toBe(true);
    });
});
