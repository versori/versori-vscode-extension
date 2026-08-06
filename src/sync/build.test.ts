import { describe, expect, it } from 'vitest';

import { buildSyncArgs, parseProjectList, projectPickItems } from './build';

describe('buildSyncArgs', () => {
    it('keeps --confirm out of the default dry-run command', () => {
        const args = buildSyncArgs({
            projectId: '01PROJECT',
            directory: '/workspace/shopify-sync',
            assets: false,
            dryRun: true,
        });

        expect(args).toEqual([
            'projects',
            'sync',
            '--project',
            '01PROJECT',
            '--directory',
            '/workspace/shopify-sync',
        ]);
        expect(args).not.toContain('--confirm');
    });

    it('adds assets and --confirm only for the live command', () => {
        expect(
            buildSyncArgs({
                projectId: '01PROJECT',
                directory: '/workspace/shopify-sync',
                assets: true,
                dryRun: false,
            }),
        ).toEqual([
            'projects',
            'sync',
            '--project',
            '01PROJECT',
            '--directory',
            '/workspace/shopify-sync',
            '--assets',
            '--confirm',
        ]);
    });
});

describe('parseProjectList', () => {
    it('reads the projects wrapper returned by the CLI', () => {
        expect(
            parseProjectList({
                projects: [
                    { id: '01A', name: 'Orders sync' },
                    { id: '01B', name: 'Stock sync' },
                ],
            }),
        ).toEqual([
            { id: '01A', name: 'Orders sync' },
            { id: '01B', name: 'Stock sync' },
        ]);
    });

    it('accepts a bare array and skips entries without an id', () => {
        expect(
            parseProjectList([
                { id: '01A', name: 'Orders sync' },
                { name: 'missing id' },
                'not a project',
            ]),
        ).toEqual([{ id: '01A', name: 'Orders sync' }]);
    });
});

describe('projectPickItems', () => {
    it('labels and prioritises the currently synced project', () => {
        expect(
            projectPickItems(
                [
                    { id: '01B', name: 'Stock sync' },
                    { id: '01A', name: 'Orders sync' },
                ],
                '01A',
            ),
        ).toEqual([
            {
                label: 'Orders sync',
                description: '01A (current project)',
                projectId: '01A',
            },
            {
                label: 'Stock sync',
                description: '01B',
                projectId: '01B',
            },
        ]);
    });
});
