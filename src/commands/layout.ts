/**
 * The order of rows in the Versori QuickPick.
 *
 * Kept free of `vscode` so the layout — the part most likely to regress when
 * actions are added — is unit tested, while `menu.ts` stays responsible only
 * for turning these rows into QuickPick items.
 */
export type MenuRow =
    | { kind: 'section'; label: string }
    | { kind: 'notice' }
    | { kind: 'action'; command: string };

function section(label: string): MenuRow {
    return { kind: 'section', label };
}

function action(command: string): MenuRow {
    return { kind: 'action', command };
}

/**
 * Rows for the root menu.
 *
 * The Context group is identical in both layouts, and always ends with
 * Configure keyboard shortcuts — a user with no project must still be able to
 * reach the Keybindings editor.
 */
export function menuLayout(inProject: boolean): MenuRow[] {
    const context: MenuRow[] = [
        section('Context'),
        action('versori.switchContext'),
        action('versori.showOutput'),
        action('versori.configureKeybindings'),
    ];

    if (!inProject) {
        return [
            { kind: 'notice' },
            section('Project management'),
            action('versori.syncProjectHere'),
            section('KV'),
            action('versori.kvStores'),
            section('Connections'),
            action('versori.connections'),
            ...context,
        ];
    }

    return [
        section('Project management'),
        action('versori.deployProject'),
        action('versori.saveVersion'),
        action('versori.syncProjectHere'),
        action('versori.showVersions'),
        action('versori.resources'),
        section('KV'),
        action('versori.kvEntries'),
        action('versori.kvStores'),
        section('Connectors and connections'),
        action('versori.connectors'),
        action('versori.staticConnections'),
        action('versori.connections'),
        section('Users and variables'),
        action('versori.activations'),
        action('versori.variables'),
        section('Observe'),
        action('versori.logs'),
        action('versori.issues'),
        ...context,
    ];
}
