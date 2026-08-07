# Versori VSCode extension — status bar context indicator

**Date:** 2026-07-31
**Status:** Approved, implementing

## Problem

The `versori` CLI resolves two things implicitly, and both can surprise you:

1. **Which project a command targets** — read from the nearest `.versori` file, not from
   anything visible in the editor.
2. **Which context (org + credentials) that command runs under** — a `.versori` file that
   pins a `context` silently overrides your persistent active context.

The override is announced only as a one-line notice on stderr, once per process
(`pkg/cmd/config/config.go:266-270`). In a multi-project workspace it is easy to have
the wrong idea about what a deploy is about to hit.

## Goal

A status bar item that answers, at a glance and without being asked: **"for the file I am
looking at, which project and which context will a `versori` command actually use?"** —
and that visibly changes appearance when `.versori` is overriding the active context.

Clicking it opens a QuickPick of common CLI actions, scoped to the resolved project.

## Non-goals (v1)

- TreeView sidebar
- A real streaming log viewer (logs are dumped to an OutputChannel as a one-shot fetch)
- Any KV mutation (`kv set` / `delete` / `wipe`)
- Marketplace publishing — packaged as a local `.vsix`

## Resolution semantics

Mirrors the CLI. Source of truth: `pkg/cmd/config/config.go` and `pkg/cmd/flags/project.go`
in the `cli` repo.

**Inputs**

| Input | Location | Format |
|---|---|---|
| Project + pinned context | nearest `.versori`, walking up from the active file | JSON `{"project_id": "...", "context": "..."}` |
| Active context | `~/.versori/config.yaml` | YAML key `active_context` |

**Precedence** (the extension has no `--context` flag, so the CLI's first tier is absent):

1. If a `.versori` is found with **both** `project_id` and `context` non-empty →
   that context wins. `source = 'versori-file'`.
2. Otherwise → `active_context` from the CLI config. `source = 'active'`.
3. No active context either → `source = 'none'`.

`overridesActive` is true when tier 1 applied *and* the active context differs. This is the
condition the CLI reports on stderr, and the condition the status bar renders in amber.

Note: the Go code also requires the resolved project ID to equal `.versori`'s `project_id`
(`config.go:257`). In the extension both values come from the same file, so that check is
implicit and needs no separate branch.

**Walk-up** stops at the first directory containing `.versori`, at the containing
`WorkspaceFolder` boundary, or at the filesystem root — whichever comes first. Depth is
capped defensively.

## Architecture

| Module | Responsibility | Imports `vscode`? | Unit tested? |
|---|---|---|---|
| `src/resolver/types.ts` | `ContextResolver` interface, `ResolvedState` type | no | n/a |
| `src/resolver/local.ts` | Walk-up, config read, precedence, caching | no | yes |
| `src/cli.ts` | Binary discovery, arg building, spawn, error normalisation | no | yes |
| `src/statusbar.ts` | Renders `ResolvedState` into the one `StatusBarItem` | yes | no |
| `src/commands/menu.ts` | QuickPick and its action handlers | yes | no |
| `src/extension.ts` | Activation, watchers, wiring, disposal | yes | no |

`statusbar.ts` depends on the `ContextResolver` **interface** only. Swapping the local
resolver for a future CLI-delegated one (once `versori context show` gains `--directory`)
is a one-line change in `extension.ts`.

**Hot path constraint:** `onDidChangeActiveTextEditor` fires on every tab switch, so
resolution must never spawn a process or hit the network. It reads two small local files
and caches per directory.

**Cache invalidation:** a `FileSystemWatcher` on `**/.versori`, an `fs.watch` on
`~/.versori/config.yaml`, and `onDidChangeWorkspaceFolders`.

## Display states

| Situation | Text | Background | Tooltip |
|---|---|---|---|
| In project, context matches active | `$(plug) ctx · folder` | default | project id, context source |
| In project, `.versori` overrides active | `$(alert) ctx · folder` | warning | names both contexts, explains the override |
| File outside any project | `$(plug) ctx` | default | "no `.versori` — showing active context" |
| No context configured at all | `$(plug) Versori: no context` | warning | prompts to run `versori context add` |
| Binary not found | `$(error) Versori: CLI not found` | error | how to set `versori.cliPath` |
| No active editor | previous state retained | — | — |

The project **folder basename** is shown, not the platform project name: `.versori` holds
only a ULID, and fetching the name would mean a network call on every tab switch. The real
project ID appears in the tooltip.

## Actions (QuickPick)

Read-only actions run outside the mutating wizard and keep their existing result-panel behavior;
command output is also rendered into an OutputChannel:

- Issues — `projects issues list --project <id> -o json`
- Logs — `projects logs --project <id> --environment <env> --since 1h --limit 200 -o json`
- Systems — `projects systems list --project <id> -o json`
- Connections — `connections list -o json`
- Versions — `projects versions list --project <id> -o json`
- Switch context — `context list -o json` → pick → `context select <name>`

Project-scoped actions are hidden when no project resolves.

Read-only result panels are unchanged and remain separate from this QuickPick flow: Issues,
Logs, Systems, Connections, Versions, and KV entries close the action QuickPick and use their
existing result panels. They are not screens in the mutating wizard.

**Sync** is always available because it is also how a remote project gets into a local
directory. It runs `projects list` in the active context, labels a matching local project as
`(current project)`, and reuses that project's directory when selected. It also offers every
workspace folder and a typed absolute or workspace-relative path, including a target folder with
no existing `.versori`. Sync is the command-cwd exception: it passes the target explicitly as
`--directory` and spawns without a project working directory, while the other mutating commands
default to the resolved project directory.

Sync is a dry run by default. Unticking dry run reveals a mandatory **popup confirmation screen**
naming the project and directory and warning that live sync can overwrite local changes and
delete local files absent from the remote project. The CLI receives `--confirm` only after that
warning is accepted, and Sync has no setting or “Don't ask again” control that can disable the
gate.

### Mutating actions: single QuickPick wizard

Deploy, Save version, Resources, and Sync remain inside one extension QuickPick. Selecting one
replaces the current screen in the same `PopupSession`; it does not open a separate form panel or
a second popup. The one-session model has a review screen, one screen per field, a confirmation
screen when required, and a result screen after execution. Text and textarea values are entered
directly in the QuickPick input; select and boolean values are chosen as QuickPick items.

The QuickPick **Back** button returns to the previous screen. **Escape** hides the current
screen, which cancels the current step or backtracks to the previous screen when there is one;
escaping the root action menu cancels the action. The screen step counter remains visible while
moving through the wizard.

**Dry run is a mode, not a preflight.** For Deploy and Save version, the dry-run field starts on
and appends `--dry-run`. Sync relies on the CLI's dry-run default: its form does not append
`--dry-run` and only adds `--confirm` after the mandatory confirmation is accepted. The CLI may
create a nonexistent target directory even during Sync's dry run, but it does not write project
files. No confirmation is needed while dry run is selected. Turning it off is the deliberate act
that changes the action label. Only guarded live mutations such as Deploy, Resources, and Sync
lead to a live-run confirmation screen; Save version has no confirmation gate because it creates an
inert snapshot.

| | Deploy | Save version |
|---|---|---|
| Version name | optional — blank omits `--version`, CLI defaults to a UTC timestamp | **required** |
| Description | optional — `deploy.go:104` skips it when empty | **required** |
| Environment | select; rendered as static text when the project has one environment | n/a |
| Dry run | default on | default on |
| Confirm on live run | yes, gated by `versori.confirmDeploy` | no — a version makes nothing live |

The required fields on Save version are not a stylistic choice: `versions/create.go:67-77`
opens an interactive editor for either blank value, which deadlocks a process with no TTY.
The review screen sends the user to the first missing required field, and `buildVersionArgs`
throws as a backstop.

Resources has the same review, field, and confirmation screens, but no dry-run mode because
`projects edit` has no dry-run flag. Its confirmation screen warns that changing the live
deployment configuration may restart the environment.

**Popup confirmation screen.** A live deploy shows an explicit warning screen with **Don't ask
again**. Ticking it writes `versori.confirmDeploy: false` globally; the setting description says
how to restore it. Resources and Sync always show their confirmation screen; they do not expose
the Deploy setting.

**Output** is appended to the OutputChannel and summarized on the wizard's result screen, so a
dry-run preview, live-run result, or failure can be reviewed without opening another panel.

**Excluded entirely:** `kv set`, `kv delete`, `kv wipe`.

## Binary discovery

`versori` is commonly a **shell alias** (`alias versori=~/go/bin/versori`), and
`child_process.spawn` does not load shell rc files. A naive `spawn('versori')` fails with
`ENOENT`. Resolution order:

1. `versori.cliPath` setting, if set and the file exists
2. Scan `PATH` for an executable named `versori`
3. `~/go/bin/versori`
4. Otherwise → CLI-not-found state

## Error handling

- Non-zero exit → notification with the stderr summary and a "Show output" action
- Malformed `.versori` → logged to the OutputChannel, treated as "no project"; activation
  must not fail
- Missing or unreadable `~/.versori/config.yaml` → no active context, not an error
- `config.yaml` contains JWTs: only `active_context` is ever read, and file contents are
  never logged

## Testing

Pure modules only, no mocked `vscode` namespace:

- `resolver/local.test.ts` — table-driven precedence cases ported from the CLI's
  `pkg/cmd/config/config_test.go`, using real temp-directory fixtures
- `cli.test.ts` — binary discovery against a fake `PATH`, and arg construction

Runner: vitest. `vscode`-dependent modules are kept thin enough that their logic lives in
the tested modules.
