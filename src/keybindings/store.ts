import * as fs from 'node:fs';
import * as path from 'node:path';

import { formatChord } from './format';
import { parseKeybindings } from './parse';

/**
 * The user's Versori chords, read straight from `keybindings.json`.
 *
 * VS Code exposes no API for "what is bound to this command", so the keymap
 * file is read directly. It is small and read only when a surface is being
 * rebuilt, which is why there is no watcher: binding a key and reopening the
 * menu is enough, with no window reload.
 *
 * On a remote workspace this reads the *remote* keymap, which may not be the
 * chords the client actually sends. Showing what we can read is honest; the
 * README documents the limitation.
 */
export class KeybindingStore {
    private chords = new Map<string, string>();

    /**
     * @param globalStorageFsPath `ExtensionContext.globalStorageUri.fsPath`,
     *     i.e. `…/User/globalStorage/<publisher>.<name>`.
     */
    constructor(
        private readonly globalStorageFsPath: string,
        private readonly platform: NodeJS.Platform = process.platform,
    ) {
        this.refresh();
    }

    /** Re-read the keymap. Call before rebuilding any surface that shows chords. */
    refresh(): void {
        try {
            const text = fs.readFileSync(this.keymapPath(), 'utf8');
            this.chords = parseKeybindings(text);
        } catch {
            // Missing or unreadable keymap: the user has bound nothing we can see.
            this.chords = new Map();
        }
    }

    /** Display chord for a command, or undefined when it is unbound. */
    chordFor(command: string): string | undefined {
        const key = this.chords.get(command);
        return key ? formatChord(key, this.platform) : undefined;
    }

    private keymapPath(): string {
        // globalStorage/<publisher>.<name> → up two levels is the `User` directory.
        return path.resolve(this.globalStorageFsPath, '..', '..', 'keybindings.json');
    }
}
