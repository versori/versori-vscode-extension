import { describe, expect, it } from 'vitest';

import { groupDryRunChanges, parseDryRunOutput, summarizeDryRun } from './dry-run';

describe('parseDryRunOutput', () => {
    it('parses sync create/update/delete and asset lines', () => {
        const preview = parseDryRunOutput(
            [
                'No --confirm flag: running in dry-run mode. Re-run with --confirm to actually sync.',
                'Would create: src/main.ts',
                'Would update: package.json',
                'Files that would be deleted:',
                '  old/file.ts',
                '  leftover.md',
                'Would delete asset: logo.png',
                'Would download asset: readme.pdf',
                'Dry-run complete. Re-run with --confirm to apply these changes.',
            ].join('\n'),
        );

        expect(preview.changes).toEqual([
            { action: 'create', path: 'src/main.ts' },
            { action: 'update', path: 'package.json' },
            { action: 'delete', path: 'old/file.ts' },
            { action: 'delete', path: 'leftover.md' },
            { action: 'asset-delete', path: 'logo.png' },
            { action: 'asset-download', path: 'readme.pdf' },
        ]);
        expect(preview.notes).toEqual([
            'No --confirm flag: running in dry-run mode. Re-run with --confirm to actually sync.',
            'Dry-run complete. Re-run with --confirm to apply these changes.',
        ]);
        expect(summarizeDryRun(preview)).toBe(
            '1 create · 1 update · 2 deletes · 1 asset download · 1 asset delete',
        );
    });

    it('parses deploy/save upload lists', () => {
        const preview = parseDryRunOutput(
            [
                'Files that would be uploaded:',
                '  src/main.ts',
                '  package.json',
                'Assets that would be uploaded:',
                '  logo.png',
            ].join('\n'),
        );

        expect(preview.changes).toEqual([
            { action: 'upload', path: 'src/main.ts' },
            { action: 'upload', path: 'package.json' },
            { action: 'asset-upload', path: 'logo.png' },
        ]);
        expect(summarizeDryRun(preview)).toBe('2 uploads · 1 asset upload');
    });

    it('reports no file changes when the dry run is empty', () => {
        expect(parseDryRunOutput('(no output)')).toEqual({ changes: [], notes: [] });
        expect(summarizeDryRun({ changes: [], notes: [] })).toBe('No file changes');
    });

    it('groups interleaved create/update lines into stable sections', () => {
        expect(
            groupDryRunChanges([
                { action: 'update', path: 'b.ts' },
                { action: 'create', path: 'a.ts' },
                { action: 'update', path: 'c.ts' },
                { action: 'delete', path: 'old.ts' },
            ]),
        ).toEqual([
            { action: 'create', paths: ['a.ts'] },
            { action: 'update', paths: ['b.ts', 'c.ts'] },
            { action: 'delete', paths: ['old.ts'] },
        ]);
    });
});
