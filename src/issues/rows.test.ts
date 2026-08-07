import { describe, expect, it } from 'vitest';

import { toIssueRows } from './rows';

// Shape from the Issue schema in versori-api.yaml: title and message are both
// required, severity is optional, seenCount and lastSeenAt are required.
const issue = {
    id: '01JISSUE0000000000000000',
    organisationId: '01JORG',
    projectId: '01JPROJECT',
    environmentId: '01JENV',
    status: 'open',
    reason: 'workflow_error',
    severity: 'critical',
    title: 'get-pricing failed',
    message: 'connect ECONNREFUSED 10.0.0.4:443',
    labels: { trigger: 'get-pricing' },
    annotations: {},
    createdAt: '2026-04-08T10:00:53Z',
    lastSeenAt: '2026-04-08T11:15:02Z',
    seenCount: 12,
};

describe('toIssueRows', () => {
    it('reads the identifying fields off an issue', () => {
        const [row] = toIssueRows({ type: 'Issue', items: [issue] });

        expect(row.id).toBe('01JISSUE0000000000000000');
        expect(row.title).toBe('get-pricing failed');
        expect(row.message).toBe('connect ECONNREFUSED 10.0.0.4:443');
        expect(row.status).toBe('open');
        expect(row.severity).toBe('critical');
        expect(row.seenCount).toBe('12');
    });

    it('maps severity to a chip class, reusing the log level colours', () => {
        expect(toIssueRows([issue])[0].severityLevel).toBe('error');
        expect(toIssueRows([{ ...issue, severity: 'medium' }])[0].severityLevel).toBe('info');
    });

    it('formats lastSeenAt for display', () => {
        expect(toIssueRows([issue])[0].lastSeen).toMatch(
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
        );
    });

    it('falls back to the message when an issue has no title', () => {
        const [row] = toIssueRows([{ ...issue, title: '' }]);
        expect(row.title).toBe('connect ECONNREFUSED 10.0.0.4:443');
    });

    it('never leaves the headline blank', () => {
        const [row] = toIssueRows([{ ...issue, title: '', message: '' }]);
        expect(row.title).toBe('(untitled issue)');
    });

    it('keeps the remaining detail as flattened fields, labels included', () => {
        const keys = toIssueRows([issue])[0].fields.map((f) => f.key);
        expect(keys).toContain('labels.trigger');
        expect(keys).toContain('reason');
        // Promoted to the headline, so not repeated below it.
        expect(keys).not.toContain('title');
        expect(keys).not.toContain('severity');
    });

    it('skips rows with no id — nothing can be done with an unaddressable issue', () => {
        expect(toIssueRows([{ ...issue, id: '' }])).toEqual([]);
    });

    it('returns an empty list when there are no issues', () => {
        expect(toIssueRows(undefined)).toEqual([]);
    });
});
