import { describe, expect, it } from 'vitest';

import {
    buildLogArgs,
    CUSTOM_RANGE,
    describeRange,
    environmentArgs,
    environmentControl,
    normaliseTime,
    RANGE_PRESETS,
    searchControl,
    validateLogRange,
} from './controls';

describe('RANGE_PRESETS', () => {
    it('never uses a day unit, which Go durations do not support', () => {
        for (const preset of RANGE_PRESETS) {
            if (preset.value === CUSTOM_RANGE) {
                continue;
            }
            expect(preset.value).toMatch(/^\d+(ns|us|ms|s|m|h)$/);
            expect(preset.value).not.toMatch(/d$/);
        }
    });

    it('expresses multi-day windows in hours', () => {
        expect(RANGE_PRESETS.find((p) => p.label === 'Last 7 days')?.value).toBe('168h');
    });
});

describe('normaliseTime', () => {
    it('pads a datetime-local value with seconds', () => {
        expect(normaliseTime('2026-07-31T14:30')).toBe('2026-07-31T14:30:00');
    });

    it('passes a date-only value through', () => {
        expect(normaliseTime('2026-07-31')).toBe('2026-07-31');
    });

    it('leaves a full RFC3339 value alone', () => {
        expect(normaliseTime('2026-07-31T14:30:09Z')).toBe('2026-07-31T14:30:09Z');
    });

    it('returns empty for blank input', () => {
        expect(normaliseTime('   ')).toBe('');
    });
});

describe('buildLogArgs', () => {
    it('uses --since for presets', () => {
        expect(buildLogArgs({ range: '6h', limit: 200 })).toEqual([
            '--since',
            '6h',
            '--limit',
            '200',
        ]);
    });

    it('uses --start/--end for a custom range', () => {
        expect(
            buildLogArgs({
                range: CUSTOM_RANGE,
                from: '2026-07-30T09:00',
                to: '2026-07-31T17:00',
                limit: 50,
            }),
        ).toEqual([
            '--start',
            '2026-07-30T09:00:00',
            '--end',
            '2026-07-31T17:00:00',
            '--limit',
            '50',
        ]);
    });

    it('never emits --since together with --start, which the CLI rejects', () => {
        const custom = buildLogArgs({ range: CUSTOM_RANGE, from: '2026-07-30' });
        expect(custom).toContain('--start');
        expect(custom).not.toContain('--since');

        const preset = buildLogArgs({ range: '1h' });
        expect(preset).toContain('--since');
        expect(preset).not.toContain('--start');
        expect(preset).not.toContain('--end');
    });

    it('omits --end when only a start is given', () => {
        const args = buildLogArgs({ range: CUSTOM_RANGE, from: '2026-07-30' });
        expect(args).not.toContain('--end');
    });

    it('drops a non-positive or unparseable limit', () => {
        expect(buildLogArgs({ range: '1h', limit: 0 })).not.toContain('--limit');
        expect(buildLogArgs({ range: '1h', limit: -5 })).not.toContain('--limit');
        expect(buildLogArgs({ range: '1h', limit: 'abc' })).not.toContain('--limit');
    });

    it('floors a fractional limit', () => {
        expect(buildLogArgs({ range: '1h', limit: 20.7 })).toContain('20');
    });

    it('defaults to the last hour and 200 rows', () => {
        expect(buildLogArgs({})).toEqual(['--since', '1h', '--limit', '200']);
    });
});

describe('validateLogRange', () => {
    it('accepts any preset', () => {
        expect(validateLogRange({ range: '24h' })).toBeUndefined();
    });

    it('requires a start time for a custom range', () => {
        expect(validateLogRange({ range: CUSTOM_RANGE })).toMatch(/start time/i);
    });

    it('rejects an end before the start', () => {
        expect(
            validateLogRange({
                range: CUSTOM_RANGE,
                from: '2026-07-31T12:00',
                to: '2026-07-30T12:00',
            }),
        ).toMatch(/before the start/i);
    });

    it('accepts a start with no end', () => {
        expect(validateLogRange({ range: CUSTOM_RANGE, from: '2026-07-30' })).toBeUndefined();
    });
});

describe('describeRange', () => {
    it('names the preset', () => {
        expect(describeRange({ range: '24h' })).toBe('Last 24 hours');
    });

    it('describes a bounded custom range', () => {
        expect(
            describeRange({ range: CUSTOM_RANGE, from: '2026-07-30', to: '2026-07-31' }),
        ).toBe('2026-07-30 to 2026-07-31');
    });

    it('describes an open-ended custom range', () => {
        expect(describeRange({ range: CUSTOM_RANGE, from: '2026-07-30' })).toBe(
            'since 2026-07-30',
        );
    });
});

describe('environmentControl', () => {
    it('defaults to the only environment when a project has one', () => {
        const control = environmentControl(['production']);
        expect(control).toEqual({
            kind: 'select',
            id: 'environment',
            label: 'Environment',
            value: 'production',
            options: [{ value: 'production', label: 'production' }],
        });
    });

    it('defaults to the first of several, leaving the rest selectable', () => {
        const control = environmentControl(['production', 'staging']);
        expect(control.value).toBe('production');
        expect(control.kind === 'select' && control.options.map((o) => o.value)).toEqual([
            'production',
            'staging',
        ]);
    });
});

describe('environmentArgs', () => {
    it('names the environment for the CLI', () => {
        expect(environmentArgs({ environment: 'staging' })).toEqual(['--environment', 'staging']);
    });

    it('emits nothing when unset, rather than an empty flag value', () => {
        expect(environmentArgs({})).toEqual([]);
        expect(environmentArgs({ environment: '' })).toEqual([]);
    });
});

describe('searchControl', () => {
    it('is a text control whose value becomes the CLI --search query', () => {
        expect(searchControl()).toEqual({
            kind: 'text',
            id: 'search',
            label: 'Search (server-side)',
            value: '',
            placeholder: 'passed to --search',
        });
    });
});

describe('buildLogArgs search', () => {
    it('passes a search query to the CLI', () => {
        expect(buildLogArgs({ range: '1h', limit: 200, search: 'get-pricing' })).toEqual([
            '--since',
            '1h',
            '--limit',
            '200',
            '--search',
            'get-pricing',
        ]);
    });

    it('omits --search when blank, rather than sending an empty query', () => {
        expect(buildLogArgs({ range: '1h', limit: 200, search: '   ' })).toEqual([
            '--since',
            '1h',
            '--limit',
            '200',
        ]);
    });
});
