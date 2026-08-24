import * as path from 'node:path';
import * as vscode from 'vscode';

import { run, runJson } from '../cli';
import { FormDeps } from '../forms/panel';
import { POPUP_BACK, PopupSession } from '../forms/popup';
import { parseVersionList, versionPickItems, VersionEntry } from '../versions/list';
import { safeSyncSubfolderName } from '../sync/build';
import {
    buildCompareArgs,
    collidingSidecarNames,
    compareSidecarDirectory,
} from './build';
import { isBinaryFile } from './binary';
import { loadProjectIgnore, listProjectFiles } from './tree';
import { ComparePair, comparePairs } from './pairs';

/**
 * Diff the working project folder against one of its saved versions.
 *
 * The snapshot is materialised on disk by the CLI rather than reconstructed
 * here, so the comparison sees exactly the tree a real `sync --version` would
 * produce — including its delete and .gitignore rules. `--no-pin` keeps the
 * throwaway folder from claiming itself as a project.
 */
export async function openCompareVersion(
    deps: FormDeps,
    popup: PopupSession,
): Promise<'menu' | 'close'> {
    const { projectId, projectDir } = deps.state;
    if (!projectId || !projectDir) {
        // The caller gates on needsProject; this is belt and braces for the
        // Explorer path, which resolves its own state.
        popup.close();
        await vscode.window.showWarningMessage('Versori: no synced project for this folder.');
        return 'menu';
    }

    popup.loading('Compare version', 'Loading versions…');

    let versions: VersionEntry[];
    try {
        const raw = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: 'Versori: loading versions' },
            () =>
                runJson<unknown>(deps.bin, {
                    args: ['projects', 'versions', 'list', '--project', projectId],
                    cwd: projectDir,
                }),
        );
        versions = parseVersionList(raw);
    } catch (err) {
        return failure(deps, popup, 'could not list versions', err);
    }

    if (versions.length === 0) {
        popup.close();
        await vscode.window.showWarningMessage(
            'Versori: this project has no saved versions to compare against.',
        );
        return 'menu';
    }

    const picked = await popup.choose({
        title: 'Compare against version',
        placeholder: 'Choose the version to diff the working folder against',
        items: versionPickItems(versions),
        back: true,
    });
    if (picked === undefined || picked === POPUP_BACK) {
        return 'menu';
    }

    // No confirmation screen: the sidecar is a fresh sibling folder, so there
    // is nothing of the user's to destroy.
    popup.close();

    const collisions = collidingSidecarNames(versions);
    let sidecar: string;
    try {
        sidecar = compareSidecarDirectory(
            projectDir,
            picked.name,
            picked.id,
            collisions.has(safeSyncSubfolderName(picked.name)),
        );
    } catch (err) {
        return failure(deps, popup, 'could not choose a comparison folder', err);
    }

    const args = buildCompareArgs({ projectId, directory: sidecar, versionId: picked.id });

    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Versori: checking out ${picked.name}`,
            },
            // No cwd: the sidecar does not exist yet and has no .versori to read.
            () => run(deps.bin, { args, json: false }),
        );
    } catch (err) {
        return failure(deps, popup, `could not check out ${picked.name}`, err);
    }

    // One matcher, from the working project, applied to both sides. Filtering
    // each side by its own .gitignore would report a file ignored on only one
    // side as an add or a delete that no sync would ever make.
    const ignore = loadProjectIgnore(projectDir);
    const pairs = comparePairs(
        listProjectFiles(projectDir, ignore),
        listProjectFiles(sidecar, ignore),
    ).filter((pair) => !isBinaryPair(projectDir, sidecar, pair));

    if (pairs.length === 0) {
        await vscode.window.showInformationMessage(
            `Versori: nothing to compare between the working folder and ${picked.name}.`,
        );
        return 'close';
    }

    await openDiffs(deps, projectDir, sidecar, picked.name, pairs);

    // Last, deliberately: adding the first extra folder to a single-folder
    // workspace converts it to multi-root and restarts the extension host,
    // which would abort everything above.
    addWorkspaceFolder(sidecar, picked.name);

    return 'close';
}

async function openDiffs(
    deps: FormDeps,
    projectDir: string,
    sidecar: string,
    versionName: string,
    pairs: ComparePair[],
): Promise<void> {
    const title = `Working ↔ ${versionName}`;
    const active = activeRelativePath(projectDir);
    const ordered = active
        ? [
              ...pairs.filter((pair) => pair.relativePath === active),
              ...pairs.filter((pair) => pair.relativePath !== active),
          ]
        : pairs;

    // The file the user is looking at, opened as a normal diff as well as
    // inside the multi-diff, so Compare lands on something recognisable.
    if (active && ordered[0]?.relativePath === active) {
        try {
            await vscode.commands.executeCommand(
                'vscode.diff',
                sideUri(projectDir, ordered[0], 'working'),
                sideUri(sidecar, ordered[0], 'version'),
                `${active} — ${title}`,
            );
        } catch (err) {
            deps.output.appendLine(`compare: could not open ${active}: ${String(err)}`);
        }
    }

    // `vscode.changes` is a built-in command with no typings, so the triple
    // shape is not compiler-checked: [resource, left, right].
    const resources = ordered.map((pair) => [
        vscode.Uri.file(path.join(sidecar, pair.relativePath)),
        sideUri(projectDir, pair, 'working'),
        sideUri(sidecar, pair, 'version'),
    ]);

    try {
        await vscode.commands.executeCommand('vscode.changes', title, resources);
    } catch (err) {
        deps.output.appendLine(`compare: multi-diff unavailable (${String(err)}); opening pairs`);
        for (const pair of ordered.slice(0, MAX_FALLBACK_DIFFS)) {
            try {
                await vscode.commands.executeCommand(
                    'vscode.diff',
                    sideUri(projectDir, pair, 'working'),
                    sideUri(sidecar, pair, 'version'),
                    `${pair.relativePath} — ${title}`,
                );
            } catch (diffErr) {
                deps.output.appendLine(
                    `compare: could not open ${pair.relativePath}: ${String(diffErr)}`,
                );
            }
        }
    }
}

/** Enough to be useful without opening a hundred tabs if multi-diff is missing. */
const MAX_FALLBACK_DIFFS = 20;

/**
 * The uri for one side of a pair.
 *
 * A file missing on this side becomes an empty `untitled:` document rather
 * than a missing-file uri, so a one-sided file reads as an add or a delete
 * instead of failing the pair.
 */
function sideUri(root: string, pair: ComparePair, side: 'working' | 'version'): vscode.Uri {
    const exists = side === 'working' ? pair.workingExists : pair.sidecarExists;
    if (exists) {
        return vscode.Uri.file(path.join(root, pair.relativePath));
    }
    return vscode.Uri.from({ scheme: 'untitled', path: `/${side}/${pair.relativePath}` });
}

function isBinaryPair(projectDir: string, sidecar: string, pair: ComparePair): boolean {
    if (pair.workingExists && isBinaryFile(path.join(projectDir, pair.relativePath))) {
        return true;
    }
    return pair.sidecarExists && isBinaryFile(path.join(sidecar, pair.relativePath));
}

function activeRelativePath(projectDir: string): string | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file') {
        return undefined;
    }

    const relative = path.relative(projectDir, uri.fsPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        return undefined;
    }
    return relative.split(path.sep).join('/');
}

function addWorkspaceFolder(sidecar: string, versionName: string): void {
    const already = (vscode.workspace.workspaceFolders ?? []).some(
        (folder) => path.resolve(folder.uri.fsPath) === path.resolve(sidecar),
    );
    if (already) {
        return;
    }

    vscode.workspace.updateWorkspaceFolders(
        vscode.workspace.workspaceFolders?.length ?? 0,
        null,
        { uri: vscode.Uri.file(sidecar), name: `${path.basename(sidecar)} (${versionName})` },
    );
}

async function failure(
    deps: FormDeps,
    popup: PopupSession,
    what: string,
    err: unknown,
): Promise<'menu'> {
    const message = err instanceof Error ? err.message : String(err);
    deps.output.appendLine(`compare: ${what}: ${message}`);
    popup.close();
    await vscode.window.showErrorMessage(`Versori: ${what} — ${message}`);
    return 'menu';
}
