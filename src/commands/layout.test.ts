import { describe, expect, it } from 'vitest';

import { MenuRow, menuLayout } from './layout';

function commands(rows: MenuRow[]): string[] {
    return rows.flatMap((row) => (row.kind === 'action' ? [row.command] : []));
}

function sections(rows: MenuRow[]): string[] {
    return rows.flatMap((row) => (row.kind === 'section' ? [row.label] : []));
}

describe('menuLayout in a project', () => {
    const rows = menuLayout(true);

    it('keeps the established section order', () => {
        expect(sections(rows)).toEqual([
            'Project management',
            'KV',
            'Connectors and connections',
            'Users and variables',
            'Observe',
            'Context',
        ]);
    });

    it('lists every project action', () => {
        expect(commands(rows)).toEqual([
            'versori.deployProject',
            'versori.saveVersion',
            'versori.syncProjectHere',
            'versori.showVersions',
            'versori.resources',
            'versori.kvEntries',
            'versori.kvStores',
            'versori.connectors',
            'versori.staticConnections',
            'versori.connections',
            'versori.activations',
            'versori.variables',
            'versori.logs',
            'versori.issues',
            'versori.switchContext',
            'versori.showOutput',
            'versori.configureKeybindings',
        ]);
    });

    it('shows no no-project notice', () => {
        expect(rows.some((row) => row.kind === 'notice')).toBe(false);
    });

    it('never lists the menu command as a row inside the menu', () => {
        expect(commands(rows)).not.toContain('versori.showMenu');
    });
});

describe('menuLayout outside a project', () => {
    const rows = menuLayout(false);

    it('opens with the notice', () => {
        expect(rows[0]).toEqual({ kind: 'notice' });
    });

    it('offers only the actions that work without a project', () => {
        expect(commands(rows)).toEqual([
            'versori.syncProjectHere',
            'versori.kvStores',
            'versori.connections',
            'versori.switchContext',
            'versori.showOutput',
            'versori.configureKeybindings',
        ]);
    });

    it('uses the narrower section labels', () => {
        expect(sections(rows)).toEqual([
            'Project management',
            'KV',
            'Connections',
            'Context',
        ]);
    });
});

describe('both layouts', () => {
    it('end with the configure row, which is always reachable', () => {
        for (const rows of [menuLayout(true), menuLayout(false)]) {
            expect(rows[rows.length - 1]).toEqual({
                kind: 'action',
                command: 'versori.configureKeybindings',
            });
        }
    });

    it('list each command at most once', () => {
        for (const rows of [menuLayout(true), menuLayout(false)]) {
            const listed = commands(rows);
            expect(new Set(listed).size).toBe(listed.length);
        }
    });
});
