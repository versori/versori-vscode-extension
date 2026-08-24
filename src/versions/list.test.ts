import { describe, expect, it } from 'vitest';

import {
    LATEST_VERSION_LABEL,
    LATEST_VERSION_VALUE,
    parseVersionList,
    versionPickItems,
    versionSelectChoices,
} from './list';

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
            { id: '01VERSION1', name: 'v1.2', description: 'shipped Tuesday' },
            { id: '01VERSION2', name: 'v1.1', description: 'rollback target' },
        ]);
    });

    it('accepts a bare array as well as the envelope', () => {
        expect(parseVersionList([{ id: '01VERSION', name: 'v1.2', description: 'd' }])).toEqual([
            { id: '01VERSION', name: 'v1.2', description: 'd' },
        ]);
    });

    it('accepts the versions and results envelope keys', () => {
        expect(parseVersionList({ versions: [{ id: '01A', name: 'v1' }] })).toEqual([
            { id: '01A', name: 'v1', description: '' },
        ]);
        expect(parseVersionList({ results: [{ id: '01B', name: 'v2' }] })).toEqual([
            { id: '01B', name: 'v2', description: '' },
        ]);
    });

    it('drops a row with no id, because --version could only fail on it', () => {
        expect(
            parseVersionList({ items: [{ name: 'v1.2' }, { id: '01VERSION', name: 'v1.1' }] }),
        ).toEqual([{ id: '01VERSION', name: 'v1.1', description: '' }]);
    });

    it('falls back to the id when a version has no usable name', () => {
        expect(parseVersionList({ items: [{ id: '01VERSION', name: '   ' }] })).toEqual([
            { id: '01VERSION', name: '01VERSION', description: '' },
        ]);
    });

    it('gives a version with no description an empty one', () => {
        expect(parseVersionList({ items: [{ id: '01VERSION', name: 'v1.2' }] })).toEqual([
            { id: '01VERSION', name: 'v1.2', description: '' },
        ]);
    });

    it('trims whitespace around every field', () => {
        expect(
            parseVersionList({
                items: [{ id: '  01VERSION  ', name: '  v1.2 ', description: '  shipped  ' }],
            }),
        ).toEqual([{ id: '01VERSION', name: 'v1.2', description: 'shipped' }]);
    });

    it('reads the CLI\'s "(no items)" non-JSON outputs as no versions', () => {
        expect(parseVersionList(undefined)).toEqual([]);
        expect(parseVersionList(null)).toEqual([]);
        expect(parseVersionList('(no items)')).toEqual([]);
        expect(parseVersionList(0)).toEqual([]);
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
        const choices = versionSelectChoices([
            { id: '01VERSION1', name: 'v1.2', description: 'shipped Tuesday' },
            { id: '01VERSION2', name: 'v1.1', description: '' },
        ]);

        expect(choices[0].label).toBe(LATEST_VERSION_LABEL);
        expect(choices[0].value).toBe('');
        expect(choices.slice(1)).toEqual([
            { label: 'v1.2', description: 'shipped Tuesday', value: '01VERSION1' },
            { label: 'v1.1', description: '01VERSION2', value: '01VERSION2' },
        ]);
    });
});

describe('versionPickItems', () => {
    it('preserves the CLI order rather than re-sorting newest-first rows', () => {
        expect(
            versionPickItems([
                { id: '01NEW', name: 'v2.0', description: 'newest' },
                { id: '01OLD', name: 'v1.0', description: 'oldest' },
            ]).map((item) => item.value.id),
        ).toEqual(['01NEW', '01OLD']);
    });

    it('labels each row with the history icon and carries the whole entry', () => {
        const version = { id: '01VERSION', name: 'v1.2', description: 'shipped Tuesday' };

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
            versionPickItems([{ id: '01VERSION', name: 'v1.2', description: '' }])[0].description,
        ).toBe('01VERSION');
    });

    it('returns no rows for no versions', () => {
        expect(versionPickItems([])).toEqual([]);
    });
});
