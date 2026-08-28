import { describe, expect, it, vi } from 'vitest';

import {
    formatVersionTimestamp,
    LATEST_VERSION_LABEL,
    LATEST_VERSION_VALUE,
    parseVersionList,
    VersionEntry,
    versionPickItems,
    versionSelectChoices,
} from './list';

/**
 * M, A, Z is none of: id-asc (A,M,Z), id-desc (Z,M,A), name-asc
 * (alpha, beta, gamma → A,M,Z), or name-desc (Z,M,A). Any of those
 * four sorts would change the order, so an assertion of this sequence
 * binds to "preserve input order".
 */
const CLI_ORDER: VersionEntry[] = [
    { id: '01M', name: 'beta', description: 'middle id, middle name', createdAt: '' },
    { id: '01A', name: 'alpha', description: 'lowest id, first name', createdAt: '' },
    { id: '01Z', name: 'gamma', description: 'highest id, last name', createdAt: '' },
];

describe('parseVersionList', () => {
    it('reads the VersionSummary envelope the CLI emits', () => {
        expect(
            parseVersionList({
                type: 'VersionSummary',
                items: [
                    { id: '01VERSION1', name: 'v1.2', description: 'shipped Tuesday' },
                    { id: '01VERSION2', name: 'v1.1', description: 'rollback target' },
                ],
            }),
        ).toEqual([
            { id: '01VERSION1', name: 'v1.2', description: 'shipped Tuesday', createdAt: '' },
            { id: '01VERSION2', name: 'v1.1', description: 'rollback target', createdAt: '' },
        ]);
    });

    it('accepts a bare array as well as the envelope', () => {
        expect(parseVersionList([{ id: '01VERSION', name: 'v1.2', description: 'd' }])).toEqual([
            { id: '01VERSION', name: 'v1.2', description: 'd', createdAt: '' },
        ]);
    });

    it('accepts the versions and results envelope keys', () => {
        expect(parseVersionList({ versions: [{ id: '01A', name: 'v1' }] })).toEqual([
            { id: '01A', name: 'v1', description: '', createdAt: '' },
        ]);
        expect(parseVersionList({ results: [{ id: '01B', name: 'v2' }] })).toEqual([
            { id: '01B', name: 'v2', description: '', createdAt: '' },
        ]);
    });

    it('drops a row with no id, because --version could only fail on it', () => {
        expect(
            parseVersionList({ items: [{ name: 'v1.2' }, { id: '01VERSION', name: 'v1.1' }] }),
        ).toEqual([{ id: '01VERSION', name: 'v1.1', description: '', createdAt: '' }]);
    });

    it('falls back to the id when a version has no usable name', () => {
        expect(parseVersionList({ items: [{ id: '01VERSION', name: '   ' }] })).toEqual([
            { id: '01VERSION', name: '01VERSION', description: '', createdAt: '' },
        ]);
    });

    it('gives a version with no description an empty one', () => {
        expect(parseVersionList({ items: [{ id: '01VERSION', name: 'v1.2' }] })).toEqual([
            { id: '01VERSION', name: 'v1.2', description: '', createdAt: '' },
        ]);
    });

    it('trims whitespace around every field', () => {
        expect(
            parseVersionList({
                items: [{ id: '  01VERSION  ', name: '  v1.2 ', description: '  shipped  ' }],
            }),
        ).toEqual([{ id: '01VERSION', name: 'v1.2', description: 'shipped', createdAt: '' }]);
    });

    it('reads the CLI\'s "(no items)" non-JSON outputs as no versions', () => {
        expect(parseVersionList(undefined)).toEqual([]);
        expect(parseVersionList(null)).toEqual([]);
        expect(parseVersionList('(no items)')).toEqual([]);
        expect(parseVersionList(0)).toEqual([]);
    });

    it('reads createdAt from either casing and defaults a missing one to empty', () => {
        expect(
            parseVersionList({
                items: [
                    { id: '01A', name: 'v2', createdAt: '2026-08-24T14:05:00Z' },
                    { id: '01B', name: 'v1', CreatedAt: '  2026-08-01T09:00:00Z  ' },
                    { id: '01C', name: 'v0' },
                ],
            }),
        ).toEqual([
            { id: '01A', name: 'v2', description: '', createdAt: '2026-08-24T14:05:00Z' },
            { id: '01B', name: 'v1', description: '', createdAt: '2026-08-01T09:00:00Z' },
            { id: '01C', name: 'v0', description: '', createdAt: '' },
        ]);
    });
});

describe('formatVersionTimestamp', () => {
    it('renders a valid ISO timestamp as local YYYY-MM-DD HH:mm', () => {
        const iso = '2026-01-15T14:30:00Z';
        const date = new Date(iso);
        const pad = (n: number) => String(n).padStart(2, '0');

        expect(formatVersionTimestamp(iso)).toBe(
            `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
                `${pad(date.getHours())}:${pad(date.getMinutes())}`,
        );
    });

    it('returns empty for an empty value', () => {
        expect(formatVersionTimestamp('')).toBe('');
        expect(formatVersionTimestamp('   ')).toBe('');
    });

    it('returns empty for an unparseable value', () => {
        expect(formatVersionTimestamp('not-a-date')).toBe('');
        expect(formatVersionTimestamp('2026-99-99T99:99:99Z')).toBe('');
    });

    it('does not depend on the host locale', () => {
        const spy = vi.spyOn(Date.prototype, 'toLocaleString');
        const formatted = formatVersionTimestamp('2026-08-24T15:30:00.000Z');

        expect(spy).not.toHaveBeenCalled();
        expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
        expect(formatted).not.toMatch(/[A-Za-z]/);
        spy.mockRestore();
    });
});

describe('versionSelectChoices', () => {
    it('offers only Latest when the project has no versions', () => {
        expect(versionSelectChoices([])).toEqual([
            {
                label: LATEST_VERSION_LABEL,
                description: "the project's current files",
                value: LATEST_VERSION_VALUE,
            },
        ]);
    });

    it('keeps Latest first and its value blank so --version stays off the argv', () => {
        const choices = versionSelectChoices(CLI_ORDER);

        expect(choices[0].label).toBe(LATEST_VERSION_LABEL);
        expect(choices[0].value).toBe('');
        expect(choices.slice(1).map((choice) => choice.value)).toEqual(['01M', '01A', '01Z']);
    });

    it('labels a row by name and falls back to the id when it has no description', () => {
        const choices = versionSelectChoices([
            { id: '01WITHDESC', name: 'v2.0', description: 'shipped the webhook fix', createdAt: '' },
            { id: '01NODESC', name: 'v1.9', description: '', createdAt: '' },
        ]);

        // choices[0] is Latest; the version rows follow in input order.
        expect(choices[1]).toEqual({
            label: 'v2.0',
            description: 'shipped the webhook fix',
            value: '01WITHDESC',
        });
        expect(choices[2]).toEqual({
            label: 'v1.9',
            description: '01NODESC',
            value: '01NODESC',
        });
    });

    it('shows the timestamp with the description, and without one', () => {
        const stamped = formatVersionTimestamp('2026-08-24T14:05:00Z');
        const choices = versionSelectChoices([
            {
                id: '01WITH',
                name: 'v2.0',
                description: 'shipped the webhook fix',
                createdAt: '2026-08-24T14:05:00Z',
            },
            { id: '01NONE', name: 'v1.9', description: '', createdAt: '2026-08-24T14:05:00Z' },
        ]);

        expect(choices[1]).toEqual({
            label: 'v2.0',
            description: `${stamped} · shipped the webhook fix`,
            value: '01WITH',
        });
        expect(choices[2]).toEqual({
            label: 'v1.9',
            description: stamped,
            value: '01NONE',
        });
    });
});

describe('versionPickItems', () => {
    it('preserves the CLI order rather than re-sorting newest-first rows', () => {
        expect(versionPickItems(CLI_ORDER).map((item) => item.value.id)).toEqual([
            '01M',
            '01A',
            '01Z',
        ]);
    });

    it('labels each row with the history icon and carries the whole entry', () => {
        const version = {
            id: '01VERSION',
            name: 'v1.2',
            description: 'shipped Tuesday',
            createdAt: '',
        };

        expect(versionPickItems([version])).toEqual([
            {
                label: '$(history) v1.2',
                description: 'shipped Tuesday',
                value: version,
            },
        ]);
    });

    it('shows the id when a version has no description to show', () => {
        expect(
            versionPickItems([{ id: '01VERSION', name: 'v1.2', description: '', createdAt: '' }])[0]
                .description,
        ).toBe('01VERSION');
    });

    it('returns no rows for no versions', () => {
        expect(versionPickItems([])).toEqual([]);
    });

    it('shows the timestamp with the description, and without one', () => {
        const stamped = formatVersionTimestamp('2026-08-24T14:05:00Z');
        const withDescription = {
            id: '01WITH',
            name: 'v1.2',
            description: 'shipped Tuesday',
            createdAt: '2026-08-24T14:05:00Z',
        };
        const noDescription = {
            id: '01NONE',
            name: 'v1.1',
            description: '',
            createdAt: '2026-08-24T14:05:00Z',
        };

        expect(versionPickItems([withDescription, noDescription])).toEqual([
            {
                label: '$(history) v1.2',
                description: `${stamped} · shipped Tuesday`,
                value: withDescription,
            },
            {
                label: '$(history) v1.1',
                description: stamped,
                value: noDescription,
            },
        ]);
    });
});
