import { describe, expect, it } from 'vitest';

import {
    buildSyncArgs,
    normalizeSyncDirectory,
    parseProjectList,
    projectPickItems,
    syncState,
} from './build';

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

describe('normalizeSyncDirectory', () => {
    it('accepts a blank non-Versori target directory path', () => {
        expect(normalizeSyncDirectory('/tmp/empty-project')).toBe('/tmp/empty-project');
    });

    it('resolves a relative target under the workspace root', () => {
        expect(normalizeSyncDirectory('new-project', '/workspace')).toBe('/workspace/new-project');
    });

    it('rejects a blank target path', () => {
        expect(() => normalizeSyncDirectory('   ', '/workspace')).toThrow(/target directory/i);
    });
});

describe('syncState', () => {
    const pinnedState = {
        projectId: '01PROJECT',
        projectDir: '/workspace/current',
        contextName: 'project-context',
        activeContextName: 'active-context',
        source: 'versori-file' as const,
        overridesActive: true,
    };

    it('preserves project metadata only for the same project and directory', () => {
        expect(syncState(pinnedState, '01PROJECT', '/workspace/current')).toEqual(pinnedState);
    });

    it('rebuilds changed-directory state from the active context', () => {
        expect(syncState(pinnedState, '01PROJECT', '/workspace/other')).toEqual({
            projectId: '01PROJECT',
            projectDir: '/workspace/other',
            contextName: 'active-context',
            activeContextName: 'active-context',
            source: 'active',
            overridesActive: false,
        });
    });
});
