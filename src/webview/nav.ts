import * as vscode from 'vscode';

/** Menu command every panel Back control reopens. */
export const MENU_COMMAND = 'versori.showMenu';

/**
 * Handle shared webview navigation messages.
 *
 * Returns true when the message was a nav action (and the panel is disposed).
 * Close disposes only; Back disposes then reopens the Versori menu.
 */
export function handleNavMessage(
    message: { type?: string; action?: string } | undefined,
    panel: vscode.WebviewPanel,
): boolean {
    if (message?.type !== 'nav') {
        return false;
    }

    const action = message.action;
    if (action !== 'close' && action !== 'back') {
        return false;
    }

    panel.dispose();
    if (action === 'back') {
        void vscode.commands.executeCommand(MENU_COMMAND);
    }
    return true;
}
