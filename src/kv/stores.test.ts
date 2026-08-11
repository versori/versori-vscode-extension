import { describe, expect, it } from 'vitest';

import {
    enrichKvStores,
    groupKvStores,
    kvStoreTableRows,
    parseKvStoreName,
    parseKvStoresList,
    parseProjectRefs,
} from './stores';

describe('parseKvStoreName', () => {
    it('parses organisation, project and execution store names', () => {
        expect(parseKvStoreName('ORG_01JORG')).toEqual({
            kind: 'organization',
            subjectId: '01JORG',
            rawName: 'ORG_01JORG',
        });
        expect(parseKvStoreName('PROJECT_01JPROJ')).toEqual({
            kind: 'project',
            subjectId: '01JPROJ',
            rawName: 'PROJECT_01JPROJ',
        });
        expect(parseKvStoreName('EXECUTION_01JPROJ')).toEqual({
            kind: 'execution',
            subjectId: '01JPROJ',
            rawName: 'EXECUTION_01JPROJ',
        });
    });

    it('keeps unknown names without inventing a kind', () => {
        expect(parseKvStoreName('custom-store')).toEqual({
            kind: 'unknown',
            subjectId: 'custom-store',
            rawName: 'custom-store',
        });
    });
});

describe('parseKvStoresList', () => {
    it('reads a bare array of printable stores', () => {
        expect(
            parseKvStoresList([
                { name: 'PROJECT_01JA', id: 'store-a' },
                { name: 'ORG_01JORG', id: 'store-org' },
            ]),
        ).toEqual([
            { name: 'PROJECT_01JA', id: 'store-a' },
            { name: 'ORG_01JORG', id: 'store-org' },
        ]);
    });

    it('reads the API stores envelope and items envelope', () => {
        expect(
            parseKvStoresList({
                stores: [{ name: 'PROJECT_01JA', id: 'store-a' }],
            }),
        ).toEqual([{ name: 'PROJECT_01JA', id: 'store-a' }]);

        expect(
            parseKvStoresList({
                items: [{ name: 'EXECUTION_01JA', id: 'store-e' }],
            }),
        ).toEqual([{ name: 'EXECUTION_01JA', id: 'store-e' }]);
    });

    it('treats blank JSON shapes as no stores', () => {
        expect(parseKvStoresList(null)).toEqual([]);
        expect(parseKvStoresList({})).toEqual([]);
        expect(parseKvStoresList([])).toEqual([]);
    });
});

describe('parseProjectRefs', () => {
    it('reads projects list envelopes', () => {
        expect(
            parseProjectRefs({
                projects: [
                    { id: '01JA', name: 'Acme Orders' },
                    { id: '01JB', name: '' },
                ],
            }),
        ).toEqual([
            { id: '01JA', name: 'Acme Orders' },
            { id: '01JB', name: '01JB' },
        ]);
    });
});

describe('enrichKvStores + groupKvStores', () => {
    const stores = [
        { name: 'PROJECT_01JA', id: 's1' },
        { name: 'EXECUTION_01JA', id: 's2' },
        { name: 'PROJECT_01JB', id: 's3' },
        { name: 'ORG_01JORG', id: 's4' },
        { name: 'odd-store', id: 's5' },
    ];
    const projects = [
        { id: '01JA', name: 'Acme Orders' },
        { id: '01JB', name: 'Billing' },
    ];

    it('joins project names and falls back to project id when missing', () => {
        const enriched = enrichKvStores(
            [...stores, { name: 'PROJECT_01JMISSING', id: 's6' }],
            projects,
        );

        expect(enriched.find((s) => s.id === 's1')).toMatchObject({
            projectId: '01JA',
            projectName: 'Acme Orders',
            group: 'Acme Orders',
            storeType: 'Project',
        });
        expect(enriched.find((s) => s.id === 's6')).toMatchObject({
            projectId: '01JMISSING',
            projectName: '01JMISSING',
            group: '01JMISSING',
        });
        expect(enriched.find((s) => s.id === 's4')?.group).toMatch(/Organisation/);
        expect(enriched.find((s) => s.id === 's5')?.group).toBe('odd-store');
    });

    it('groups by project name with org and unknown fallbacks', () => {
        const groups = groupKvStores(enrichKvStores(stores, projects));
        const labels = groups.map((g) => g.label);

        expect(labels).toContain('Acme Orders');
        expect(labels).toContain('Billing');
        expect(labels.some((label) => label.includes('Organisation'))).toBe(true);
        expect(labels).toContain('odd-store');

        const acme = groups.find((g) => g.label === 'Acme Orders');
        expect(acme?.stores.map((s) => s.id)).toEqual(['s1', 's2']);
    });

    it('flattens groups into table rows with a group column', () => {
        const rows = kvStoreTableRows(groupKvStores(enrichKvStores(stores, projects)));
        expect(rows[0]).toEqual(
            expect.objectContaining({
                group: expect.any(String),
                storeType: expect.any(String),
                name: expect.any(String),
                id: expect.any(String),
            }),
        );
        expect(rows.some((row) => row.group === 'Acme Orders' && row.id === 's1')).toBe(true);
    });
});
