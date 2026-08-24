import * as fs from 'node:fs';
import * as path from 'node:path';

import { EMPTY_IGNORE, IgnoreMatcher, parseGitignore } from './ignore';
import { byCodePoint } from './pairs';

/**
 * Names sync refuses to touch, so compare must not diff them either.
 *
 * `.versori` is the project pin — never synced, never deleted. `versori-research`
 * is `assets.DefaultAssetsDir` in the CLI: assets are handled by `--assets` and
 * are always the project's *current* assets, so they are never part of a
 * version snapshot and would always read as deletions.
 */
const SKIPPED_ROOT_NAMES = new Set(['.versori', 'versori-research']);

/**
 * The matcher for a project directory, from its root `.gitignore` only.
 *
 * Root-only is not a shortcut: sync loads exactly one `.gitignore`, from the
 * sync root, so honouring nested ones here would hide files sync would delete.
 */
export function loadProjectIgnore(root: string): IgnoreMatcher {
    try {
        return parseGitignore(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'));
    } catch {
        // No .gitignore is the common case; sync also just carries on.
        return EMPTY_IGNORE;
    }
}

/**
 * Every non-ignored file under `root`, as `/`-separated relative paths.
 *
 * A missing root is an empty list, not a throw: the sidecar does not exist
 * until the sync has run, and the caller reports that itself.
 */
export function listProjectFiles(root: string, ignore: IgnoreMatcher): string[] {
    const found: string[] = [];
    walk(root, '', ignore, found);
    return found.sort(byCodePoint);
}

function walk(root: string, relative: string, ignore: IgnoreMatcher, found: string[]): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        const relativePath = relative ? `${relative}/${entry.name}` : entry.name;

        if (relative === '' && SKIPPED_ROOT_NAMES.has(entry.name)) {
            continue;
        }
        if (ignore.matches(relativePath, entry.isDirectory())) {
            continue;
        }

        if (entry.isDirectory()) {
            walk(root, relativePath, ignore, found);
            continue;
        }
        if (entry.isFile()) {
            found.push(relativePath);
        }
        // Symlinks and other node types are skipped: sync writes plain files.
    }
}
