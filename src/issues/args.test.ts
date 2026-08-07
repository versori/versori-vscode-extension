import { describe, expect, it } from 'vitest';

import {
    ANY,
    buildIssueGetArgs,
    buildIssueListArgs,
    buildIssueUpdateArgs,
    ISSUE_SEVERITIES,
    ISSUE_STATUSES,
    issueControls,
} from './args';

describe('issue enums', () => {
    // These are the server's accepted values (IssueStatusEnum / IssueSeverityEnum
    // in versori-api.yaml). A typo here becomes a CLI error the user cannot fix.
    it('lists the four statuses the API accepts', () => {
        expect(ISSUE_STATUSES).toEqual(['open', 'acked', 'resolved', 'closed']);
    });

    it('lists the four severities the API accepts, worst first', () => {
        expect(ISSUE_SEVERITIES).toEqual(['critical', 'high', 'medium', 'low']);
    });
});

describe('issueControls', () => {
    it('offers environment, status, severity and a page size', () => {
        expect(issueControls(['production']).map((c) => c.id)).toEqual([
            'environment',
            'status',
            'severity',
            'first',
        ]);
    });

    it('defaults status and severity to "any", so nothing is hidden on open', () => {
        const controls = issueControls(['production']);
        expect(controls.find((c) => c.id === 'status')?.value).toBe(ANY);
        expect(controls.find((c) => c.id === 'severity')?.value).toBe(ANY);
    });

    it('offers every status as an option alongside "any"', () => {
        const status = issueControls(['production']).find((c) => c.id === 'status');
        expect(status?.kind === 'select' && status.options.map((o) => o.value)).toEqual([
            ANY,
            'open',
            'acked',
            'resolved',
            'closed',
        ]);
    });
});

describe('buildIssueListArgs', () => {
    it('names the environment and page size', () => {
        expect(
            buildIssueListArgs({ environment: 'production', status: ANY, severity: ANY, first: 50 }),
        ).toEqual(['--environment', 'production', '--first', '50']);
    });

    it('filters by status and severity when they are not "any"', () => {
        expect(
            buildIssueListArgs({
                environment: 'production',
                status: 'open',
                severity: 'critical',
                first: 50,
            }),
        ).toEqual([
            '--environment',
            'production',
            '--status',
            'open',
            '--severity',
            'critical',
            '--first',
            '50',
        ]);
    });

    it('omits --first when zero, which lets the server default apply', () => {
        expect(
            buildIssueListArgs({ environment: 'production', status: ANY, severity: ANY, first: 0 }),
        ).toEqual(['--environment', 'production']);
    });
});

describe('buildIssueUpdateArgs', () => {
    it('acknowledges an issue', () => {
        expect(buildIssueUpdateArgs('01JISSUE', { status: 'acked' })).toEqual([
            'projects',
            'issues',
            'update',
            '01JISSUE',
            '--status',
            'acked',
        ]);
    });

    it('changes severity and status together', () => {
        expect(buildIssueUpdateArgs('01JISSUE', { status: 'resolved', severity: 'low' })).toEqual([
            'projects',
            'issues',
            'update',
            '01JISSUE',
            '--status',
            'resolved',
            '--severity',
            'low',
        ]);
    });

    it('refuses an empty change rather than running a no-op mutation', () => {
        expect(() => buildIssueUpdateArgs('01JISSUE', {})).toThrow(/nothing to change/i);
    });

    it('refuses a status the API does not accept', () => {
        expect(() => buildIssueUpdateArgs('01JISSUE', { status: 'done' })).toThrow(/status/i);
    });

    it('refuses a severity the API does not accept', () => {
        expect(() => buildIssueUpdateArgs('01JISSUE', { severity: 'urgent' })).toThrow(/severity/i);
    });
});

describe('buildIssueGetArgs', () => {
    it('names the environment so the lookup is deterministic', () => {
        expect(buildIssueGetArgs('01JISSUE', 'production')).toEqual([
            'projects',
            'issues',
            'get',
            '01JISSUE',
            '--environment',
            'production',
        ]);
    });

    it('omits the flag when no environment is known', () => {
        expect(buildIssueGetArgs('01JISSUE', '')).toEqual([
            'projects',
            'issues',
            'get',
            '01JISSUE',
        ]);
    });
});
