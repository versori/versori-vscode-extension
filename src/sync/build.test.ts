import { describe, expect, it } from 'vitest';

import {
    buildSyncConfirmationMessage,
    buildSyncArgs,
    buildSyncTargetDirectory,
    defaultSyncCreateSubfolder,
    fixedSyncDirectory,
    normalizeSyncDirectory,
    parseProjectList,
    projectPickItems,
    safeSyncSubfolderName,
    selectSyncDefaultDirectory,
    syncState,
    validateSyncSubfolderName,
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

    it('leaves --version off the argv for the Latest pick', () => {
        const latest = {
            projectId: '01PROJECT',
            directory: '/workspace/shopify-sync',
            assets: false,
            dryRun: false,
        };

        expect(buildSyncArgs(latest)).not.toContain('--version');
        expect(buildSyncArgs({ ...latest, versionId: '' })).not.toContain('--version');
        expect(buildSyncArgs({ ...latest, versionId: '   ' })).not.toContain('--version');
    });

    it('pins a chosen version between the directory and the assets flag', () => {
        expect(
            buildSyncArgs({
                projectId: '01PROJECT',
                directory: '/workspace/shopify-sync',
                assets: true,
                dryRun: false,
                versionId: '01VERSION',
            }),
        ).toEqual([
            'projects',
            'sync',
            '--project',
            '01PROJECT',
            '--directory',
            '/workspace/shopify-sync',
            '--version',
            '01VERSION',
            '--assets',
            '--confirm',
        ]);
    });

    it('never emits --no-pin, because a Sync is a real checkout that must pin', () => {
        for (const assets of [true, false]) {
            for (const dryRun of [true, false]) {
                for (const versionId of [undefined, '', '   ', '01VERSION']) {
                    expect(
                        buildSyncArgs({
                            projectId: '01PROJECT',
                            directory: '/workspace/shopify-sync',
                            assets,
                            dryRun,
                            versionId,
                        }),
                    ).not.toContain('--no-pin');
                }
            }
        }
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

describe('fixedSyncDirectory', () => {
    it('normalizes the clicked Explorer folder for a fixed-target sync', () => {
        expect(fixedSyncDirectory('clicked', '/workspace')).toBe('/workspace/clicked');
    });

    it('returns no fixed target when the Explorer folder is absent', () => {
        expect(fixedSyncDirectory('   ', '/workspace')).toBeUndefined();
    });
});

describe('validateSyncSubfolderName', () => {
    it('accepts and trims a single safe path component', () => {
        expect(validateSyncSubfolderName('  orders-sync  ')).toBe('orders-sync');
    });

    it.each(['', '   ', '.', '..', '/absolute', '\\absolute', 'C:\\absolute', 'nested/name', 'nested\\name'])(
        'rejects unsafe subfolder name %j',
        (name) => {
            expect(() => validateSyncSubfolderName(name)).toThrow(/subfolder name/i);
        },
    );
});

describe('buildSyncTargetDirectory', () => {
    it('appends a validated subfolder when creation is enabled', () => {
        expect(buildSyncTargetDirectory('/workspace', true, 'orders-sync')).toBe(
            '/workspace/orders-sync',
        );
    });

    it('ignores the subfolder name when creation is disabled', () => {
        expect(buildSyncTargetDirectory('/workspace', false, '')).toBe('/workspace');
        expect(buildSyncTargetDirectory('/workspace', false, '../unsafe')).toBe('/workspace');
    });

    it('rejects a missing subfolder when creation is enabled', () => {
        expect(() => buildSyncTargetDirectory('/workspace', true, '  ')).toThrow(
            /subfolder name/i,
        );
    });
});

describe('safeSyncSubfolderName', () => {
    it('turns remote project path separators into a safe single component', () => {
        const name = safeSyncSubfolderName(' Orders / Inventory ');

        expect(name).toBe('Orders - Inventory');
        expect(() => validateSyncSubfolderName(name)).not.toThrow();
    });

    it('falls back when the remote project name cannot produce a safe component', () => {
        expect(safeSyncSubfolderName('..')).toBe('versori-project');
    });
});

describe('defaultSyncCreateSubfolder', () => {
    it('defaults off when the selected folder is the current project folder', () => {
        expect(
            defaultSyncCreateSubfolder({
                currentProjectId: '01PROJECT',
                selectedProjectId: '01PROJECT',
                currentProjectDirectory: '/workspace/project',
                selectedDirectory: '/workspace/project',
            }),
        ).toBe(false);
    });

    it('defaults on for another remote project or another target folder', () => {
        expect(
            defaultSyncCreateSubfolder({
                currentProjectId: '01CURRENT',
                selectedProjectId: '01OTHER',
                currentProjectDirectory: '/workspace/current',
                selectedDirectory: '/workspace/other',
            }),
        ).toBe(true);
        expect(
            defaultSyncCreateSubfolder({
                currentProjectId: '01PROJECT',
                selectedProjectId: '01PROJECT',
                currentProjectDirectory: '/workspace/project',
                selectedDirectory: '/workspace/new-target',
            }),
        ).toBe(true);
    });
});

describe('selectSyncDefaultDirectory', () => {
    it('prefers an explicit Explorer folder when one is supplied', () => {
        expect(
            selectSyncDefaultDirectory({
                preferredDirectory: '/workspace/clicked',
                currentProjectId: '01PROJECT',
                selectedProjectId: '01PROJECT',
                currentProjectDirectory: '/workspace/current',
                activeEditorWorkspaceDirectory: '/workspace/editor',
                firstWorkspaceDirectory: '/workspace/first',
            }),
        ).toBe('/workspace/clicked');
    });

    it('prefers the current project directory for the current project', () => {
        expect(
            selectSyncDefaultDirectory({
                currentProjectId: '01PROJECT',
                selectedProjectId: '01PROJECT',
                currentProjectDirectory: '/workspace/current',
                activeEditorWorkspaceDirectory: '/workspace/editor',
                firstWorkspaceDirectory: '/workspace/first',
            }),
        ).toBe('/workspace/current');
    });

    it('ignores the current directory for another project', () => {
        expect(
            selectSyncDefaultDirectory({
                currentProjectId: '01CURRENT',
                selectedProjectId: '01OTHER',
                currentProjectDirectory: '/workspace/current',
                activeEditorWorkspaceDirectory: '/workspace/editor',
                firstWorkspaceDirectory: '/workspace/first',
            }),
        ).toBe('/workspace/editor');
    });

    it('skips missing candidates and falls back to the first workspace', () => {
        expect(
            selectSyncDefaultDirectory({
                currentProjectId: '01PROJECT',
                selectedProjectId: '01PROJECT',
                currentProjectDirectory: '   ',
                activeEditorWorkspaceDirectory: undefined,
                firstWorkspaceDirectory: '/workspace/first',
            }),
        ).toBe('/workspace/first');
    });
});

describe('buildSyncConfirmationMessage', () => {
    it('leads with a delete warning naming the target folder', () => {
        expect(
            buildSyncConfirmationMessage(
                'Orders sync',
                '01PROJECT',
                '/workspace/orders-sync',
            ),
        ).toBe(
            [
                'THIS WILL DELETE FILES IN THIS FOLDER',
                '/workspace/orders-sync',
                '',
                'Remote project: Orders sync (01PROJECT)',
                '',
                'Live sync replaces local project files with the remote project.',
                'Local-only files can be removed and local edits can be overwritten.',
            ].join('\n'),
        );
    });

    it('shows the computed final target rather than only its selected parent', () => {
        const finalTarget = buildSyncTargetDirectory('/workspace', true, 'orders-sync');

        expect(buildSyncConfirmationMessage('Orders sync', '01PROJECT', finalTarget)).toContain(
            '/workspace/orders-sync',
        );
    });

    it('names the version being checked out when one was picked', () => {
        expect(
            buildSyncConfirmationMessage(
                'Orders sync',
                '01PROJECT',
                '/workspace/orders-sync',
                'v1.2',
            ),
        ).toBe(
            [
                'THIS WILL DELETE FILES IN THIS FOLDER',
                '/workspace/orders-sync',
                '',
                'Remote project: Orders sync (01PROJECT)',
                'Version: v1.2',
                '',
                'Live sync replaces local project files with the remote project.',
                'Local-only files can be removed and local edits can be overwritten.',
            ].join('\n'),
        );
    });

    it('leaves the message byte-identical when no version label is given', () => {
        expect(
            buildSyncConfirmationMessage('Orders sync', '01PROJECT', '/workspace/orders-sync', ''),
        ).toBe(
            buildSyncConfirmationMessage('Orders sync', '01PROJECT', '/workspace/orders-sync'),
        );
        expect(
            buildSyncConfirmationMessage('Orders sync', '01PROJECT', '/workspace/orders-sync'),
        ).not.toContain('Version:');
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
