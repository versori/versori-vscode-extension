import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MenuRow, menuLayout } from './layout';

interface Contribution {
    command: string;
    when?: string;
    group?: string;
}

const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'),
) as {
    contributes: {
        commands: Array<{ command: string; title: string; icon?: string }>;
        menus: {
            'explorer/context': Contribution[];
            'editor/title': Contribution[];
        };
    };
};

function commands(rows: MenuRow[]): string[] {
    return rows.flatMap((row) => (row.kind === 'action' ? [row.command] : []));
}

describe('command contributions', () => {
    it('declares every command the menu can run', () => {
        const declared = new Set(manifest.contributes.commands.map((entry) => entry.command));
        for (const command of commands(menuLayout(true))) {
            expect(declared).toContain(command);
        }
    });

    it('declares Compare Version with its palette title', () => {
        expect(manifest.contributes.commands).toContainEqual({
            command: 'versori.compareVersion',
            title: 'Versori: Compare Version',
        });
    });

    it('offers Compare Version on the Explorer folder menu', () => {
        expect(manifest.contributes.menus['explorer/context']).toContainEqual({
            command: 'versori.compareVersion',
            when: 'explorerResourceIsFolder',
            group: 'versori',
        });
    });

    it('declares Swap Compare Sides with its palette title and swap icon', () => {
        expect(manifest.contributes.commands).toContainEqual({
            command: 'versori.compareSwapSides',
            title: 'Versori: Swap Compare Sides',
            icon: '$(arrow-swap)',
        });
    });

    it('offers Swap Compare Sides on the multi-diff editor title bar', () => {
        expect(manifest.contributes.menus['editor/title']).toContainEqual({
            command: 'versori.compareSwapSides',
            when: "activeEditor == 'multiDiffEditor'",
            group: 'navigation',
        });
    });
});
