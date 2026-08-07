# Single-Popup Form Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Deploy, Save version, Resources, and Sync Webview forms with one reusable VS Code QuickPick wizard that stays inside the extension popup, supports Back navigation, and allows Sync to target any directory without requiring an existing `.versori` file.

**Architecture:** `showMenu` owns one `PopupSession` and passes it to form actions. `PopupSession` owns one visible `vscode.QuickPick` for the entire menu/form interaction; it changes its title, buttons, items, and input value between screens instead of opening Webviews, nested QuickPicks, InputBoxes, or native folder dialogs. A pure form state module owns field values, screen transitions, summaries, and confirmation rules so the navigation behavior can be tested without mocking `vscode`.

**Tech Stack:** TypeScript, VS Code `QuickPick`/`QuickInputButton` APIs, existing Versori CLI runner, Vitest, esbuild, `@vscode/vsce`.

## Global Constraints

- All four forms must remain inside the original extension QuickPick; do not call `vscode.window.createWebviewPanel`, `showQuickPick`, `showInputBox`, or `showOpenDialog` from the form flow.
- Back must return to the previous screen in the same popup; Escape must have the same behavior as Back except at the root menu, where it closes the menu.
- Sync must accept a selected or typed directory that has no `.versori` file and must not use the target directory as the child-process `cwd`; the CLI receives the target through `--directory` and creates it when necessary.
- Sync remains dry-run by default, sends `--confirm` only after the in-popup warning is accepted, and never exposes a setting or “Don’t ask again” control for that gate.
- Resources always confirms because `projects edit` has no dry-run; Deploy retains the `versori.confirmDeploy` setting; Save version retains its no-confirm behavior.
- Existing pure CLI argument builders and resource round-trip behavior remain unchanged.
- Keep the extension version at `0.1.0`; package and locally install the resulting VSIX after verification.
- Do not create a git commit unless the user explicitly requests one.

---

### Task 1: Define the pure QuickPick form state model

**Files:**
- Modify: `src/forms/types.ts`
- Create: `src/forms/quick-model.ts`
- Test: `src/forms/quick-model.test.ts`

**Interfaces:**
- Consumes: existing `Field`, `FormValues`, and `FormSpec` consumers in `src/forms/panel.ts`, `src/resources/panel.ts`, and `src/sync/panel.ts`.
- Produces: `QuickFormState`, `createQuickFormState`, `enterField`, `enterScreen`, `goBack`, `setFormValue`, `fieldSummary`, `formActionLabel`, and `requiresConfirmation` for the popup adapter.

- [ ] **Step 1: Remove Webview-only fields from `FormSpec` and add command cwd control**

In `src/forms/types.ts`, retain the form data and safety fields but remove `viewType` and `refreshOnReopen`, which only identify Webview panels. Add `commandCwd` with three states: omitted means use the resolved project directory, a string means use that explicit directory, and `null` means spawn without a cwd so the CLI can create a new Sync target.

```ts
export interface FormSpec {
    title: string;
    heading: string;
    subtitle: string;
    fields: Field[];
    buildArgs: (values: FormValues) => string[];
    successMessage: (values: FormValues) => string;
    onLiveSuccess?: () => void;
    dryRunFieldId: string;
    dryRunLabel: string;
    liveLabel: string;
    confirmWhenLive: boolean;
    confirmSettingId: string;
    confirmMessage: string;
    commandCwd?: string | null;
}
```

- [ ] **Step 2: Write failing state-transition tests**

Create `src/forms/quick-model.test.ts` with tests that prove:

```ts
it('copies initial field values and starts on the review screen', () => {
    const state = createQuickFormState(spec);
    expect(state.values).toEqual({ name: 'v1', dryRun: true });
    expect(state.screen).toEqual({ kind: 'review' });
    expect(state.history).toEqual([]);
});

it('enters a field and Back returns to review without losing edits', () => {
    const entered = enterField(createQuickFormState(spec), 'name');
    const edited = setFormValue(entered, 'name', 'v2');
    expect(goBack(edited)?.screen).toEqual({ kind: 'review' });
    expect(goBack(edited)?.values.name).toBe('v2');
});

it('requires confirmation only for live forms whose gate is enabled', () => {
    expect(requiresConfirmation(spec, { dryRun: true })).toBe(false);
    expect(requiresConfirmation(spec, { dryRun: false })).toBe(true);
    expect(requiresConfirmation({ ...spec, confirmWhenLive: false }, { dryRun: false })).toBe(false);
});

it('formats empty, boolean, and text field values for the review list', () => {
    expect(fieldSummary({ kind: 'checkbox', id: 'dryRun', label: 'Dry run', value: true }, true)).toBe('On');
    expect(fieldSummary({ kind: 'text', id: 'name', label: 'Name', value: '' }, '')).toBe('(blank)');
});
```

- [ ] **Step 3: Run the focused test and verify it fails**

Run:

```sh
npm test -- src/forms/quick-model.test.ts
```

Expected: FAIL because `src/forms/quick-model.ts` and its exported state functions do not exist yet.

- [ ] **Step 4: Implement the minimal pure state model**

Create `src/forms/quick-model.ts` without importing `vscode`:

```ts
export type FormScreen =
    | { kind: 'review' }
    | { kind: 'field'; fieldId: string }
    | { kind: 'confirm' }
    | { kind: 'result'; ok: boolean; text: string };

export interface QuickFormState {
    values: FormValues;
    screen: FormScreen;
    history: FormScreen[];
}

export function createQuickFormState(spec: FormSpec): QuickFormState {
    return {
        values: Object.fromEntries(spec.fields.map((field) => [field.id, field.value])),
        screen: { kind: 'review' },
        history: [],
    };
}

export function enterField(state: QuickFormState, fieldId: string): QuickFormState {
    return {
        ...state,
        screen: { kind: 'field', fieldId },
        history: [...state.history, state.screen],
    };
}

export function enterScreen(
    state: QuickFormState,
    screen: FormScreen,
): QuickFormState {
    return { ...state, screen, history: [...state.history, state.screen] };
}

export function setFormValue(
    state: QuickFormState,
    fieldId: string,
    value: string | boolean,
): QuickFormState {
    return { ...state, values: { ...state.values, [fieldId]: value } };
}

export function goBack(state: QuickFormState): QuickFormState | undefined {
    const previous = state.history.at(-1);
    if (!previous) {
        return undefined;
    }
    return { ...state, screen: previous, history: state.history.slice(0, -1) };
}

export function fieldSummary(field: Field, value: string | boolean | undefined): string {
    if (field.kind === 'checkbox') {
        return value === true ? 'On' : 'Off';
    }
    return String(value ?? '').trim() || '(blank)';
}

export function formActionLabel(spec: FormSpec, values: FormValues): string {
    if (!spec.dryRunFieldId || values[spec.dryRunFieldId] !== true) {
        return interpolate(spec.liveLabel, values);
    }
    return spec.dryRunLabel;
}

export function requiresConfirmation(spec: FormSpec, values: FormValues): boolean {
    const isLive = !spec.dryRunFieldId || values[spec.dryRunFieldId] !== true;
    return isLive && spec.confirmWhenLive;
}
```

Use the existing `interpolate`, `Field`, `FormSpec`, and `FormValues` types rather than duplicating their definitions.

- [ ] **Step 5: Run the focused tests**

Run:

```sh
npm test -- src/forms/quick-model.test.ts
```

Expected: all state-transition and formatting tests pass.

### Task 2: Build the single visible popup session

**Files:**
- Create: `src/forms/popup.ts`
- Test: `src/forms/quick-model.test.ts` (extend pure screen/item assertions)

**Interfaces:**
- Consumes: `QuickFormState` from Task 1 and `vscode.QuickPick`.
- Produces: `PopupSession`, `PopupItem`, `POPUP_BACK`, `choose`, `input`, `loading`, `close`, and `dispose`.

- [ ] **Step 1: Define the popup session contract**

Create `src/forms/popup.ts` with one session object and a sentinel for the Back button:

```ts
import * as vscode from 'vscode';

export const POPUP_BACK = Symbol('popup-back');
export type PopupResult<T> = T | typeof POPUP_BACK | undefined;

export interface PopupItem<T> {
    label: string;
    value: T;
    description?: string;
    detail?: string;
}

export interface PopupScreen<T> {
    title: string;
    placeholder?: string;
    value?: string;
    items?: PopupItem<T>[];
    step?: number;
    totalSteps?: number;
    back?: boolean;
}

export class PopupSession {
    private readonly quickPick = vscode.window.createQuickPick<vscode.QuickPickItem>();

    async choose<T>(screen: PopupScreen<T>): Promise<PopupResult<T>> {
        // Configure the existing QuickPick, install one accept/back/hide
        // listener set for this screen, and resolve without creating another UI.
    }

    async input(screen: Omit<PopupScreen<never>, 'items'>): Promise<PopupResult<string>> {
        // Reuse the same QuickPick.value as the text editor for this screen.
    }

    loading(title: string, detail: string): void {
        // Reuse the same visible QuickPick while an async CLI request runs.
    }

    close(): void {
        this.quickPick.hide();
    }

    dispose(): void {
        this.quickPick.dispose();
    }
}
```

The implementation must set `quickPick.buttons` to `[vscode.QuickInputButtons.Back]` on every non-root screen, set `quickPick.step`/`totalSteps` for progress, and dispose only the per-screen event subscriptions between screens. `onDidHide` resolves the current screen as `undefined`; it must never open a second QuickPick.

- [ ] **Step 2: Implement item and text screens using the same QuickPick**

`choose` must set `quickPick.items` from `PopupItem<T>[]`, return the selected item's `value` from `onDidAccept`, and return `POPUP_BACK` from `onDidTriggerButton`. `input` must set `quickPick.items = []`, seed `quickPick.value`, return the edited `quickPick.value` on accept, and use the same Back button. A text field is therefore a one-line QuickPick input; descriptions retain spaces but do not introduce a second multiline editor.

- [ ] **Step 3: Add pure tests for popup-facing labels**

Extend `src/forms/quick-model.test.ts` to assert that review rows include each field label and current value, the primary action changes from the dry-run label to the interpolated live label, and confirmation text is interpolated from current values. These tests keep all state logic testable without importing `vscode`.

- [ ] **Step 4: Run all form model tests**

Run:

```sh
npm test -- src/forms/quick-model.test.ts src/forms/build.test.ts
```

Expected: all popup-model and existing argument-builder tests pass.

### Task 3: Replace the Webview form runner with the popup wizard

**Files:**
- Modify: `src/forms/panel.ts`
- Modify: `src/forms/types.ts`
- Delete: `src/forms/html.ts`
- Delete: `src/forms/html.test.ts`

**Interfaces:**
- Consumes: `PopupSession` and pure state functions from Tasks 1–2.
- Produces: `runForm(deps, popup, spec): Promise<'menu' | 'close'>`, plus updated `openDeployForm(deps, popup)` and `openSaveVersionForm(deps, popup)`.

- [ ] **Step 1: Remove Webview lifecycle code**

Delete the `crypto` and `renderFormHtml` imports, `openPanels`, `openTargets`, `targetKey`, `show`, Webview message handlers, HTML rendering, and `post` helpers from `src/forms/panel.ts`. Remove the now-unused `viewType` and `refreshOnReopen` properties from all form specs.

- [ ] **Step 2: Implement the review screen**

`runForm` must keep one `QuickFormState` and render the following items through the same `PopupSession`:

```ts
const reviewItems = [
    ...spec.fields.map((field) => ({
        label: field.label,
        description: fieldSummary(field, state.values[field.id]),
        value: { kind: 'field' as const, id: field.id },
    })),
    {
        label: formActionLabel(spec, state.values),
        description: requiresConfirmation(spec, state.values)
            ? 'Review warning before running'
            : 'Run now',
        value: { kind: 'submit' as const },
    },
];
```

Selecting a field enters its edit screen; selecting the action either enters the confirmation screen or executes immediately. The popup title must include `spec.heading` and the subtitle must include `spec.subtitle`; the step counter must show the current form step.

- [ ] **Step 3: Implement field editors and Back navigation**

For text and textarea fields, call `popup.input` with the existing value and field hint. For select fields, call `popup.choose` with each option. For checkboxes, call `popup.choose` with exactly `On` and `Off` items. On `POPUP_BACK`, call `goBack`; on `undefined`, return to the menu. Preserve edits in `QuickFormState` before rendering review again.

- [ ] **Step 4: Implement confirmation and result screens**

The confirmation screen must display the interpolated warning in a dedicated detail item and offer `Confirm` plus `Back`. If `spec.confirmSettingId` is non-empty, include a `Don't ask again` On/Off field in the confirmation flow and update that setting only after the user selects Confirm. Sync and Resources have an empty setting id, so they never expose a bypass.

After `run` succeeds or throws, render a result screen in the same QuickPick with `Finished`/`Failed`, a concise output detail, and `Back to form`/`Close` actions. Always append the full command and output/error to the Versori OutputChannel. A successful live run calls `spec.onLiveSuccess`; a dry run does not.

- [ ] **Step 5: Preserve command cwd semantics and error handling**

Build the command exactly once per submission:

```ts
const cwd =
    spec.commandCwd === undefined
        ? deps.state.projectDir
        : spec.commandCwd ?? undefined;

const result = await run(deps.bin, {
    args: spec.buildArgs(state.values),
    cwd,
    context: contextFor(deps.state),
    json: false,
});
```

Catch builder validation errors and CLI errors, show them in the same popup result screen, and do not invoke `onLiveSuccess` on failure.

- [ ] **Step 6: Update Deploy and Save version specs**

Change `openDeployForm` and `openSaveVersionForm` to accept the shared `PopupSession`, call `runForm`, and remove their Webview-only metadata. Keep all existing fields, default values, required validation, dry-run labels, confirmation copy, and `versori.confirmDeploy` behavior.

- [ ] **Step 7: Run existing form and builder tests**

Run:

```sh
npm test -- src/forms/quick-model.test.ts src/forms/build.test.ts
```

Expected: the popup model, required-field, deploy argument, and version argument tests all pass. The deleted Webview harness is no longer part of the test suite.

### Task 4: Route the menu, Resources, and Sync through the same popup

**Files:**
- Modify: `src/commands/menu.ts`
- Modify: `src/resources/panel.ts`
- Modify: `src/sync/panel.ts`
- Modify: `src/sync/build.ts`
- Modify: `src/sync/build.test.ts`

**Interfaces:**
- Consumes: `PopupSession` from Task 2 and `runForm` from Task 3.
- Produces: one menu/form interaction with no nested popup, blank-directory-safe Sync, and preserved post-sync resolver invalidation.

- [ ] **Step 1: Make `showMenu` own and reuse the popup**

Change the action signature to receive the session:

```ts
interface ActionItem extends vscode.QuickPickItem {
    run?: (deps: MenuDeps, popup: PopupSession) => Promise<'menu' | 'close'>;
}
```

`showMenu` must instantiate one `PopupSession`, render the root menu through it, pass it to the selected action, and loop back to the root menu when a form returns `'menu'`. It must dispose the session once at the end. Read-only actions must call `popup.close()` before opening their existing result panels.

- [ ] **Step 2: Move Resources environment selection into the session**

Change `openResourcesForm(deps, popup)` so multiple environments use `popup.choose` instead of `vscode.window.showQuickPick`. Pass the same popup to `runForm`; retain the current resource read, `projects edit` argument construction, mandatory confirmation, and `onLiveSuccess` behavior.

- [ ] **Step 3: Add pure directory choice/normalization helpers**

In `src/sync/build.ts`, add `import * as path from 'node:path';` and helpers with no `vscode` imports:

```ts
export function normalizeSyncDirectory(input: string, workspaceRoot?: string): string {
    const trimmed = input.trim();
    if (!trimmed) {
        throw new Error('a target directory is required');
    }
    return path.isAbsolute(trimmed)
        ? path.normalize(trimmed)
        : path.resolve(workspaceRoot ?? process.cwd(), trimmed);
}
```

Add tests proving an existing empty directory path is accepted, a workspace-relative path resolves under the workspace root, and a blank path is rejected. Do not inspect `.versori`; the helper must only normalize the directory.

- [ ] **Step 4: Keep Sync project and directory selection inside the session**

Change `openSyncForm(deps, popup)` to:

1. Show a loading state in the existing popup while running `projects list`.
2. Use `popup.choose` for projects and preserve `(current project)` labeling and ordering.
3. Use `popup.choose` for the current project directory, workspace-folder entries, and a `Type another folder path` item.
4. Use `popup.input` for the path entry and `normalizeSyncDirectory` for the result.
5. Never call `showOpenDialog`, `showQuickPick`, or any Webview API.

For a selected directory with no `.versori`, set the sync form's `commandCwd: null`, keep the explicit `--project` and `--directory` arguments, and retain the existing warning:

```ts
confirmMessage: `This will overwrite local changes in "${directory}" and delete local files not present in remote project "${picked.label}" (${picked.projectId}).`,
```

The CLI then starts from its normal process cwd, creates the target directory as needed, and writes `.versori` only after live confirmation. A successful live sync calls `deps.onContextChanged`.

- [ ] **Step 5: Test Sync directory and safety behavior**

Extend `src/sync/build.test.ts` with:

```ts
it('accepts a blank non-Versori target directory path', () => {
    expect(normalizeSyncDirectory('/tmp/empty-project')).toBe('/tmp/empty-project');
});

it('resolves a relative target under the workspace root', () => {
    expect(normalizeSyncDirectory('new-project', '/workspace')).toBe('/workspace/new-project');
});

it('rejects a blank target path', () => {
    expect(() => normalizeSyncDirectory('   ', '/workspace')).toThrow(/target directory/i);
});
```

Retain the existing tests that prove dry-run omits `--confirm`, live sync includes it only when unticked, and the current project remains labeled.

- [ ] **Step 6: Run the affected tests**

Run:

```sh
npm test -- src/forms/quick-model.test.ts src/forms/build.test.ts src/resources/config.test.ts src/sync/build.test.ts
```

Expected: all affected form, resource, and Sync tests pass.

### Task 5: Update documentation and remove stale Webview claims

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-31-versori-vscode-status-bar-design.md`

**Interfaces:**
- Consumes: the implemented popup behavior from Tasks 3–4.
- Produces: documentation that accurately describes one QuickPick form navigation and blank-folder Sync.

- [ ] **Step 1: Update the README form and Sync sections**

Document that Deploy, Save version, Resources, and Sync remain inside the same extension popup. State that Back returns to the previous step, Escape cancels/backtracks, text values are entered in the popup, and Sync can target a workspace folder or a typed path without an existing `.versori`.

Replace wording that says “in-panel confirmation bar” or “form opens” with “popup confirmation screen” where it refers to the removed Webview. Keep the destructive Sync warning and `--confirm` rule explicit.

- [ ] **Step 2: Update the architecture/design spec**

Replace the “Mutating actions: webview forms” section with “Mutating actions: single QuickPick wizard”. Remove the Webview security/form HTML description and document the one-session screen model, Back button behavior, command cwd exception for Sync, and the fact that read-only result panels are unchanged.

- [ ] **Step 3: Verify documentation terminology**

Run:

```sh
rg -n "createWebviewPanel|webview form|Webview forms|showOpenDialog|nested popup" README.md docs/superpowers/specs/2026-07-31-versori-vscode-status-bar-design.md src/forms src/sync
```

Expected: no stale form-flow claims remain; any remaining Webview references must be limited to non-form result panels or historical context explicitly labeled as removed.

### Task 6: Full verification, package, and local installation

**Files:**
- Modify: generated `dist/extension.js` through the package script
- Create/replace: `versori-vscode-0.1.0.vsix`

**Interfaces:**
- Consumes: all implementation and documentation changes from Tasks 1–5.
- Produces: a type-safe, tested, locally installable VSIX at version `0.1.0`.

- [ ] **Step 1: Run the complete test suite**

Run:

```sh
npm test
```

Expected: Vitest reports zero failures and includes the new QuickPick model and blank-directory Sync tests.

- [ ] **Step 2: Run TypeScript checking and diff validation**

Run:

```sh
npm run typecheck
git diff --check
```

Expected: both commands exit with code 0 and TypeScript emits no files.

- [ ] **Step 3: Check editor diagnostics**

Run the IDE linter diagnostics for `src/forms`, `src/resources/panel.ts`, `src/sync`, and `src/commands/menu.ts`. Expected: no diagnostics introduced by the popup migration.

- [ ] **Step 4: Package the local VSIX**

Run:

```sh
npx @vscode/vsce package --no-dependencies
```

Expected: the prepublish build succeeds and creates `versori-vscode-0.1.0.vsix`. Verify the embedded manifest:

```sh
unzip -p versori-vscode-0.1.0.vsix extension/package.json
```

Expected: the embedded package manifest contains `"version": "0.1.0"`.

- [ ] **Step 5: Replace the installed local extension**

Run:

```sh
code --install-extension "/Users/george.liu/Documents/github/versori-vscode/versori-vscode-0.1.0.vsix" --force
code --list-extensions --show-versions
```

Expected: the list contains `versori.versori-vscode@0.1.0`.

- [ ] **Step 6: Leave the repository uncommitted**

Report the changed files, test/typecheck/lint/package results, and installed extension version. Do not create a commit or push unless the user separately requests it.

