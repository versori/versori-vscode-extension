import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { run, runJson } from '../cli';
import { FormDeps } from '../forms/panel';
import { POPUP_BACK, PopupSession } from '../forms/popup';
import { parseVersionList, versionPickItems, VersionEntry } from '../versions/list';
import { safeSyncSubfolderName } from '../sync/build';
import {
    assertSafeCompareTarget,
    buildCompareCheckoutSpec,
    buildCompareFilesSpec,
    collidingSidecarNames,
    compareSidecarDirectory,
} from './build';
import { isBinaryFile } from './binary';
import { foreignSidecarPaths, versionFilePaths } from './safety';
import { listTreeEntries, loadProjectIgnore, listProjectFiles } from './tree';
import { changedPairs, CompareDirection, compareTitle, SideReader } from './changes';
import { ComparePair, comparePairs } from './pairs';

const DEFAULT_COMPARE_DIRECTION: CompareDirection = 'version-to-working';

interface LastCompare {
    projectDir: string;
    sidecar: string;
    versionName: string;
    versionTimestamp: string;
    pairs: ComparePair[];
    direction: CompareDirection;
}

/** Last successful Compare in this session — swap re-opens these diffs, no CLI. */
let lastCompare: LastCompare | undefined;

/** Private scheme for the empty side of a one-sided diff. */
export const COMPARE_EMPTY_SCHEME = 'versori-compare-empty';

/**
 * Content for the missing side of a one-sided pair.
 *
 * A registered read-only scheme rather than an `untitled:` uri: any untitled
 * path longer than one character carries a save target, so an `untitled:` empty
 * pane could be written to a real file. This scheme can only ever be empty.
 */
export const compareEmptyProvider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent: () => '',
};

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
        deps.output.appendLine('compare: no saved versions');
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

    // No confirmation screen: an existing folder must prove that every file is
    // from this exact version before the confirmed checkout can refresh it.
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

    let sidecarHasEntries: boolean;
    try {
        sidecarHasEntries = fs.existsSync(sidecar) && fs.readdirSync(sidecar).length > 0;
    } catch (err) {
        return failure(deps, popup, 'could not inspect the comparison folder', err);
    }

    if (sidecarHasEntries) {
        let remoteFiles: string[];
        try {
            const raw = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Window,
                    title: 'Versori: checking comparison folder',
                },
                () =>
                    runJson<unknown>(
                        deps.bin,
                        buildCompareFilesSpec(deps.state, projectId, picked.id),
                    ),
            );
            remoteFiles = versionFilePaths(raw);
        } catch (err) {
            return failure(deps, popup, `could not verify ${picked.name}`, err);
        }

        let foreign: string[];
        try {
            foreign = foreignSidecarPaths(listTreeEntries(sidecar), remoteFiles);
        } catch (err) {
            return failure(deps, popup, 'could not inspect the comparison folder', err);
        }
        if (foreign.length > 0) {
            const noun = foreign.length === 1 ? 'entry' : 'entries';
            deps.output.appendLine(
                `compare: refusing ${sidecar}: ${foreign.length} foreign ${noun}; first is ${foreign[0]}`,
            );
            await vscode.window.showWarningMessage(
                `Versori: ${path.basename(sidecar)} contains ${foreign.length} foreign ${noun}, including ${foreign[0]}. Compare was cancelled.`,
            );
            return 'menu';
        }
    }

    const checkoutSpec = buildCompareCheckoutSpec(deps.state, {
        projectId,
        directory: sidecar,
        versionId: picked.id,
    });

    try {
        // Re-check after the network preflight so replacing the root with a
        // symlink cannot redirect the confirmed sync while Compare is waiting.
        assertSafeCompareTarget(projectDir, sidecar);
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Versori: checking out ${picked.name}`,
            },
            // No cwd: the sidecar does not exist yet and has no .versori to read.
            () => run(deps.bin, checkoutSpec),
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

    const readSide: SideReader = (relativePath, side) => {
        const root = side === 'working' ? projectDir : sidecar;
        try {
            return fs.readFileSync(path.join(root, relativePath));
        } catch {
            return undefined;
        }
    };
    const differing = changedPairs(pairs, readSide);

    if (differing.length === 0) {
        await vscode.window.showInformationMessage(
            `Versori: the working folder already matches ${picked.name}.`,
        );
        if (!addWorkspaceFolder(sidecar, picked.name)) {
            deps.output.appendLine(`compare: could not add ${sidecar} to the workspace`);
        }
        return 'close';
    }

    lastCompare = {
        projectDir,
        sidecar,
        versionName: picked.name,
        versionTimestamp: '',
        pairs: differing,
        direction: DEFAULT_COMPARE_DIRECTION,
    };
    await openDiffs(deps, lastCompare);

    // Last, deliberately: adding the first extra folder to a single-folder
    // workspace converts it to multi-root and restarts the extension host,
    // which would abort everything above.
    if (!addWorkspaceFolder(sidecar, picked.name)) {
        deps.output.appendLine(`compare: could not add ${sidecar} to the workspace`);
    }

    return 'close';
}

/**
 * Re-open the last compare with the sides flipped.
 *
 * Uses the saved pairs and folders — no list, no checkout, no re-sync.
 */
export async function swapCompareSides(deps: FormDeps): Promise<void> {
    if (!lastCompare) {
        await vscode.window.showInformationMessage('Versori: run Compare Version first.');
        return;
    }

    lastCompare = {
        ...lastCompare,
        direction:
            lastCompare.direction === 'version-to-working'
                ? 'working-to-version'
                : 'version-to-working',
    };
    await openDiffs(deps, lastCompare);
}

async function openDiffs(deps: FormDeps, session: LastCompare): Promise<void> {
    const { projectDir, sidecar, versionName, pairs, direction } = session;
    const title = compareTitle(versionName, direction);
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
        const sides = diffSides(projectDir, sidecar, ordered[0], direction);
        try {
            await vscode.commands.executeCommand(
                'vscode.diff',
                sides.original,
                sides.modified,
                `${active} — ${title}`,
            );
        } catch (err) {
            deps.output.appendLine(`compare: could not open ${active}: ${String(err)}`);
        }
    }

    // `vscode.changes` is a built-in command with no typings, so the triple
    // shape is not compiler-checked: [resource, left, right].
    const resources = ordered.map((pair) => {
        const sides = diffSides(projectDir, sidecar, pair, direction);
        return [rowUri(projectDir, sidecar, pair), sides.original, sides.modified];
    });

    try {
        await vscode.commands.executeCommand('vscode.changes', title, resources);
    } catch (err) {
        deps.output.appendLine(`compare: multi-diff unavailable (${String(err)}); opening pairs`);
        for (const pair of ordered.slice(0, MAX_FALLBACK_DIFFS)) {
            const sides = diffSides(projectDir, sidecar, pair, direction);
            try {
                await vscode.commands.executeCommand(
                    'vscode.diff',
                    sides.original,
                    sides.modified,
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
 * Original (left) and modified (right) uris for one pair.
 *
 * Under the default `version-to-working` direction a working-only file has the
 * empty scheme on the left, so the editor renders an addition.
 */
function diffSides(
    projectDir: string,
    sidecar: string,
    pair: ComparePair,
    direction: CompareDirection,
): { original: vscode.Uri; modified: vscode.Uri } {
    const working = sideUri(projectDir, pair, 'working');
    const version = sideUri(sidecar, pair, 'version');
    if (direction === 'version-to-working') {
        return { original: version, modified: working };
    }
    return { original: working, modified: version };
}

/**
 * The uri for one side of a pair.
 *
 * A file missing on this side becomes an empty document on the private
 * `versori-compare-empty` scheme rather than a missing-file uri, so a
 * one-sided file reads as an add or a delete instead of failing the pair.
 */
function sideUri(root: string, pair: ComparePair, side: 'working' | 'version'): vscode.Uri {
    const exists = side === 'working' ? pair.workingExists : pair.sidecarExists;
    if (exists) {
        return vscode.Uri.file(path.join(root, pair.relativePath));
    }
    return vscode.Uri.from({
        scheme: COMPARE_EMPTY_SCHEME,
        path: `/${side}/${pair.relativePath}`,
    });
}

/**
 * The row's identity in the multi-diff — what its label and "go to file" resolve
 * against.
 *
 * Prefers a side that is actually on disk, working first, because a row for a
 * file that exists only in the working folder must not point at a sidecar path
 * that was never written. Falls back to the empty working side so the row
 * still has a stable identity when neither side has the file.
 */
function rowUri(projectDir: string, sidecar: string, pair: ComparePair): vscode.Uri {
    if (pair.workingExists) {
        return vscode.Uri.file(path.join(projectDir, pair.relativePath));
    }
    if (pair.sidecarExists) {
        return vscode.Uri.file(path.join(sidecar, pair.relativePath));
    }
    return sideUri(projectDir, pair, 'working');
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

function addWorkspaceFolder(sidecar: string, versionName: string): boolean {
    const already = (vscode.workspace.workspaceFolders ?? []).some(
        (folder) => path.resolve(folder.uri.fsPath) === path.resolve(sidecar),
    );
    if (already) {
        return true;
    }

    return vscode.workspace.updateWorkspaceFolders(
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
