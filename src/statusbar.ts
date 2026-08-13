import * as path from 'node:path';
import * as vscode from 'vscode';

import { ResolvedState } from './resolver/types';

const WARNING_BG = new vscode.ThemeColor('statusBarItem.warningBackground');
const ERROR_BG = new vscode.ThemeColor('statusBarItem.errorBackground');

/**
 * The single status bar item.
 *
 * Renders {@link ResolvedState} only — it never resolves anything itself, and it
 * depends on no concrete resolver, which is what keeps the resolver swappable.
 */
export class VersoriStatusBar implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;

    constructor(
        commandId: string,
        private readonly menuChord: () => string | undefined,
    ) {
        this.item = vscode.window.createStatusBarItem(
            'versori.context',
            vscode.StatusBarAlignment.Right,
            100,
        );
        this.item.name = 'Versori';
        this.item.command = commandId;
        this.item.show();
    }

    /** Terminal state: nothing else works until the binary is found. */
    renderCliMissing(configuredPath: string | undefined): void {
        this.item.text = '$(error) Versori: CLI not found';
        this.item.backgroundColor = ERROR_BG;
        this.item.tooltip = this.markdown([
            '**Versori CLI not found**',
            '',
            configuredPath
                ? `\`versori.cliPath\` is set to \`${configuredPath}\`, but no executable is there.`
                : 'Searched `PATH` and `~/go/bin/versori`.',
            '',
            'VS Code does not see shell aliases, so an aliased `versori` is invisible here.',
            'Set `versori.cliPath` to the absolute path of the binary.',
        ]);
    }

    render(state: ResolvedState): void {
        const project = state.projectDir ? path.basename(state.projectDir) : undefined;

        if (state.source === 'none') {
            this.item.text = '$(plug) Versori: no context';
            this.item.backgroundColor = WARNING_BG;
            this.item.tooltip = this.markdown([
                '**No Versori context configured**',
                '',
                'Run `versori context add --name <name> --organisation <id> --jwt <jwt>`.',
            ]);
            return;
        }

        // Always prefixed: a bare context name in the status bar is unidentifiable
        // among everything else competing for that strip.
        const label = project
            ? `Versori: ${state.contextName} · ${project}`
            : `Versori: ${state.contextName}`;

        if (state.overridesActive) {
            // The case the CLI only mentions once, on stderr. Make it unmissable.
            this.item.text = `$(alert) ${label}`;
            this.item.backgroundColor = WARNING_BG;
            this.item.tooltip = this.markdown([
                '**Context overridden by `.versori`**',
                '',
                `Commands here run under **${state.contextName}**, pinned by the project’s \`.versori\`.`,
                `Your active context is **${state.activeContextName}**.`,
                '',
                ...projectLines(state),
            ]);
            return;
        }

        this.item.text = `$(plug) ${label}`;
        this.item.backgroundColor = undefined;
        this.item.tooltip = this.markdown(
            state.source === 'versori-file'
                ? [
                      `**Context:** ${state.contextName} (from \`.versori\`)`,
                      '',
                      ...projectLines(state),
                  ]
                : [
                      `**Context:** ${state.contextName} (active context)`,
                      '',
                      project
                          ? `Project \`${state.projectId}\` pins no context.`
                          : 'This file is not inside a synced project.',
                  ],
        );
    }

    /**
     * Tooltip body, with the open-menu chord as a final line when the user has
     * bound one. Every tooltip goes through here, so no surface can drift.
     */
    private markdown(lines: string[]): vscode.MarkdownString {
        const chord = this.menuChord();
        const body = chord ? [...lines, '', `Shortcut: ${chord}`] : lines;

        const md = new vscode.MarkdownString(body.join('\n'));
        md.isTrusted = false;
        return md;
    }

    dispose(): void {
        this.item.dispose();
    }
}

function projectLines(state: ResolvedState): string[] {
    if (!state.projectId) {
        return [];
    }
    return [`**Project:** \`${state.projectId}\``, `**Directory:** \`${state.projectDir}\``];
}
