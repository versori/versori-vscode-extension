import * as path from 'node:path';
import * as vscode from 'vscode';

import { ResolvedState } from './resolver/types';

type SidebarItem = vscode.TreeItem;

/**
 * Activity Bar launcher for the same QuickPick exposed by the status bar.
 *
 * The sidebar intentionally owns no second copy of the command list. Keeping
 * one `versori.showMenu` command means context resolution, confirmations, and
 * newly-added menu actions stay identical from both entry points.
 */
export class VersoriSidebar implements vscode.TreeDataProvider<SidebarItem>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<SidebarItem | undefined | null | void>();

    readonly onDidChangeTreeData = this.changed.event;

    constructor(
        private readonly menuCommand: string,
        private readonly getState: () => ResolvedState,
    ) {}

    refresh(): void {
        this.changed.fire();
    }

    getTreeItem(element: SidebarItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SidebarItem): SidebarItem[] {
        if (element) {
            return [];
        }

        const state = this.getState();
        const item = new vscode.TreeItem(
            'Open Versori menu',
            vscode.TreeItemCollapsibleState.None,
        );
        item.iconPath = new vscode.ThemeIcon('list-flat');
        item.command = {
            command: this.menuCommand,
            title: 'Versori: Show Menu',
        };
        item.description = sidebarDescription(state);
        item.tooltip = sidebarTooltip(state);
        return [item];
    }

    dispose(): void {
        this.changed.dispose();
    }
}

function sidebarDescription(state: ResolvedState): string {
    if (!state.contextName) {
        return 'No context configured';
    }

    const project = state.projectDir ? path.basename(state.projectDir) : undefined;
    return project ? `${state.contextName} · ${project}` : state.contextName;
}

function sidebarTooltip(state: ResolvedState): string {
    if (!state.contextName) {
        return 'Open the Versori menu. Configure a context with `versori context add`.';
    }

    if (!state.projectId) {
        return `Open the Versori menu for context "${state.contextName}".`;
    }

    return `Open the Versori menu for project ${state.projectId}.`;
}
