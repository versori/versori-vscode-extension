import { describe, expect, it } from 'vitest';

import {
    buildDeployArgs,
    buildVersionArgs,
    interpolate,
    missingRequired,
    resolveFormMessage,
    splitConfirmDialog,
} from './build';
import { Field } from './types';

describe('buildDeployArgs', () => {
    it('omits optional flags when blank', () => {
        expect(
            buildDeployArgs({ environment: 'production', dryRun: false }),
        ).toEqual(['projects', 'deploy', '--environment', 'production']);
    });

    it('passes --project explicitly when the id is known', () => {
        expect(
            buildDeployArgs({ projectId: '01PROJ', environment: 'production', dryRun: false }),
        ).toEqual([
            'projects',
            'deploy',
            '--project',
            '01PROJ',
            '--environment',
            'production',
        ]);
    });

    it('treats whitespace-only input as blank', () => {
        expect(
            buildDeployArgs({
                name: '   ',
                description: '\n\t ',
                environment: 'staging',
                dryRun: false,
            }),
        ).toEqual(['projects', 'deploy', '--environment', 'staging']);
    });

    it('includes name and description when given', () => {
        expect(
            buildDeployArgs({
                name: 'v12',
                description: 'adds order webhook',
                environment: 'production',
                dryRun: false,
            }),
        ).toEqual([
            'projects',
            'deploy',
            '--environment',
            'production',
            '--version',
            'v12',
            '--description',
            'adds order webhook',
        ]);
    });

    it('appends --dry-run last when ticked', () => {
        const args = buildDeployArgs({ environment: 'production', dryRun: true });

        expect(args).toContain('--dry-run');
        expect(args[args.length - 1]).toBe('--dry-run');
    });

    it('never emits --dry-run when unticked', () => {
        expect(buildDeployArgs({ environment: 'production', dryRun: false })).not.toContain(
            '--dry-run',
        );
    });
});

describe('buildVersionArgs', () => {
    it('always passes name and description', () => {
        expect(
            buildVersionArgs({ name: 'checkpoint', description: 'wip', dryRun: false }),
        ).toEqual([
            'projects',
            'versions',
            'create',
            '--name',
            'checkpoint',
            '--description',
            'wip',
        ]);
    });

    it('refuses a blank name, which would hang the CLI on an editor prompt', () => {
        expect(() =>
            buildVersionArgs({ name: '  ', description: 'wip', dryRun: false }),
        ).toThrow(/required/);
    });

    it('refuses a blank description for the same reason', () => {
        expect(() =>
            buildVersionArgs({ name: 'checkpoint', description: '', dryRun: false }),
        ).toThrow(/required/);
    });

    it('appends --dry-run when ticked', () => {
        expect(
            buildVersionArgs({ name: 'a', description: 'b', dryRun: true }),
        ).toContain('--dry-run');
    });

    it('passes --project explicitly when the id is known', () => {
        expect(
            buildVersionArgs({
                projectId: '01PROJ',
                name: 'a',
                description: 'b',
                dryRun: false,
            }),
        ).toEqual([
            'projects',
            'versions',
            'create',
            '--project',
            '01PROJ',
            '--name',
            'a',
            '--description',
            'b',
        ]);
    });
});

describe('missingRequired', () => {
    const fields: Field[] = [
        { kind: 'text', id: 'name', label: 'Name', value: '', required: true },
        { kind: 'textarea', id: 'description', label: 'Description', value: '', required: true },
        { kind: 'text', id: 'optional', label: 'Optional', value: '' },
        { kind: 'checkbox', id: 'dryRun', label: 'Dry run', value: true },
    ];

    it('reports every blank required field', () => {
        expect(missingRequired(fields, { name: '', description: '' })).toEqual([
            'name',
            'description',
        ]);
    });

    it('ignores optional fields and checkboxes', () => {
        expect(missingRequired(fields, { name: 'a', description: 'b' })).toEqual([]);
    });

    it('counts whitespace as blank', () => {
        expect(missingRequired(fields, { name: '   ', description: 'b' })).toEqual(['name']);
    });

    it('supports fields required only for a matching form value', () => {
        const conditionalFields: Field[] = [
            {
                kind: 'text',
                id: 'subfolderName',
                label: 'Subfolder name',
                value: 'orders-sync',
                required: (values) => values.createSubfolder === true,
            },
        ];

        expect(
            missingRequired(conditionalFields, {
                createSubfolder: false,
                subfolderName: '',
            }),
        ).toEqual([]);
        expect(
            missingRequired(conditionalFields, {
                createSubfolder: true,
                subfolderName: ' ',
            }),
        ).toEqual(['subfolderName']);
    });
});

describe('interpolate', () => {
    it('substitutes field values', () => {
        expect(interpolate('Deploy to {environment}', { environment: 'production' })).toBe(
            'Deploy to production',
        );
    });

    it('leaves unknown placeholders untouched', () => {
        expect(interpolate('Deploy to {nope}', {})).toBe('Deploy to {nope}');
    });
});

describe('resolveFormMessage', () => {
    it('keeps interpolating legacy string messages', () => {
        expect(resolveFormMessage('Deploy to {environment}', { environment: 'production' })).toBe(
            'Deploy to production',
        );
    });

    it('evaluates callback messages with the latest form values', () => {
        expect(
            resolveFormMessage(
                (values) => `Target folder: ${values.directory}`,
                { directory: '/workspace/orders-sync' },
            ),
        ).toBe('Target folder: /workspace/orders-sync');
    });
});

describe('splitConfirmDialog', () => {
    it('uses the first line as the modal headline and the rest as detail', () => {
        expect(
            splitConfirmDialog(
                [
                    'THIS WILL DELETE FILES IN THIS FOLDER',
                    '/workspace/orders-sync',
                    '',
                    'Remote project: Orders sync (01PROJECT)',
                ].join('\n'),
            ),
        ).toEqual({
            message: 'THIS WILL DELETE FILES IN THIS FOLDER',
            detail: ['/workspace/orders-sync', '', 'Remote project: Orders sync (01PROJECT)'].join(
                '\n',
            ),
        });
    });
});
