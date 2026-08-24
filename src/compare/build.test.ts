import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    buildCompareArgs,
    collidingSidecarNames,
    compareSidecarDirectory,
    compareSidecarName,
} from './build';

describe('buildCompareArgs', () => {
    it('builds the full sidecar checkout command', () => {
        expect(
            buildCompareArgs({
                projectId: '01PROJECT',
                directory: '/w/p-v1',
                versionId: '01VERSION',
            }),
        ).toEqual([
            'projects',
            'sync',
            '--project',
            '01PROJECT',
            '--directory',
            '/w/p-v1',
            '--version',
            '01VERSION',
            '--confirm',
            '--no-pin',
        ]);
    });

    it('always confirms, never pins, and always names a version', () => {
        const args = buildCompareArgs({
            projectId: '01PROJECT',
            directory: '/w/p-v1',
            versionId: '01VERSION',
        });

        expect(args).toContain('--confirm');
        expect(args).toContain('--no-pin');
        expect(args).toContain('--version');
    });

    it('trims each value before using it', () => {
        expect(
            buildCompareArgs({
                projectId: '  01PROJECT ',
                directory: ' /w/p-v1 ',
                versionId: ' 01VERSION ',
            }),
        ).toEqual([
            'projects',
            'sync',
            '--project',
            '01PROJECT',
            '--directory',
            '/w/p-v1',
            '--version',
            '01VERSION',
            '--confirm',
            '--no-pin',
        ]);
    });

    it('refuses to build a command missing the project, directory, or version', () => {
        const complete = {
            projectId: '01PROJECT',
            directory: '/w/p-v1',
            versionId: '01VERSION',
        };

        for (const field of ['projectId', 'directory', 'versionId'] as const) {
            for (const blank of ['', '   ']) {
                expect(() => buildCompareArgs({ ...complete, [field]: blank })).toThrow(
                    /project, target directory, and version are required/,
                );
            }
        }
    });
});

describe('collidingSidecarNames', () => {
    it('finds nothing to disambiguate when every name sanitises differently', () => {
        expect(
            collidingSidecarNames([
                { id: '01A', name: 'v1.2', description: '' },
                { id: '01B', name: 'v1.1', description: '' },
            ]),
        ).toEqual(new Set());
    });

    it('reports the one sanitised name two different version names collapse onto', () => {
        expect(
            collidingSidecarNames([
                { id: '01A', name: 'a/b', description: '' },
                { id: '01B', name: 'a / b', description: '' },
                { id: '01C', name: 'solo', description: '' },
            ]),
        ).toEqual(new Set(['a - b']));
    });

    it('has nothing to report for no versions', () => {
        expect(collidingSidecarNames([])).toEqual(new Set());
    });
});

describe('compareSidecarName', () => {
    it('keeps the readable sanitised name when nothing else claims it', () => {
        expect(compareSidecarName('v1.2', '01VERSIONLONGID', false)).toBe('v1.2');
    });

    it('disambiguates a colliding name with the first 8 characters of the id', () => {
        expect(compareSidecarName('a/b', '01VERSIONLONGID', true)).toBe('a - b-01VERSIO');
    });
});

describe('compareSidecarDirectory', () => {
    it('checks a version out beside the project, never inside it', () => {
        expect(compareSidecarDirectory('/w/shopify', 'v1.2', '01VERSION', false)).toBe(
            path.resolve('/w/shopify-v1.2'),
        );
    });

    it('normalises a trailing separator on the project directory', () => {
        expect(compareSidecarDirectory('/w/shopify/', 'v1.2', '01VERSION', false)).toBe(
            path.resolve('/w/shopify-v1.2'),
        );
    });

    it('stays a sibling of the project for every unusable version name', () => {
        const projectDir = '/w/shopify';
        const project = path.resolve(projectDir);
        const hostileNames = ['', '   ', '.', '..', '/', 'a/b', 'a:b*c?', 'a\u0001b', 'plain'];

        for (const name of hostileNames) {
            const sidecar = compareSidecarDirectory(projectDir, name, '01VERSION', false);

            expect(sidecar).not.toBe(project);
            expect(path.dirname(sidecar)).toBe(path.dirname(project));
            expect(path.basename(sidecar).startsWith(`${path.basename(project)}-`)).toBe(true);
            expect(path.basename(sidecar).length).toBeGreaterThan(
                path.basename(project).length + 1,
            );
        }
    });

    it('falls back to the placeholder folder name for a name that sanitises away', () => {
        for (const name of ['', '   ', '.', '..']) {
            expect(compareSidecarDirectory('/w/shopify', name, '01VERSION', false)).toBe(
                path.resolve('/w/shopify-versori-project'),
            );
        }
    });

    it('replaces separators and reserved characters rather than nesting on them', () => {
        expect(compareSidecarDirectory('/w/shopify', 'a/b', '01VERSION', false)).toBe(
            path.resolve('/w/shopify-a - b'),
        );
        expect(compareSidecarDirectory('/w/shopify', 'a:b*c?', '01VERSION', false)).toBe(
            path.resolve('/w/shopify-a-b-c-'),
        );
    });

    it('appends the id suffix to the sibling name when the version name collides', () => {
        expect(compareSidecarDirectory('/w/shopify', 'a/b', '01VERSIONLONGID', true)).toBe(
            path.resolve('/w/shopify-a - b-01VERSIO'),
        );
    });
});
