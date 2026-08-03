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
- `projects sync` (its `--confirm` deletes local files; it stays in the terminal)
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

Read-only actions run immediately and render into an OutputChannel:

- Issues — `projects issues list --project <id> -o json`
- Logs — `projects logs --project <id> --environment <env> --since 1h --limit 200 -o json`
- Systems — `projects systems list --project <id> -o json`
- Connections — `connections list -o json`
- Versions — `projects versions list --project <id> -o json`
- Switch context — `context list -o json` → pick → `context select <name>`

Project-scoped actions are hidden when no project resolves.

### Mutating actions: webview forms

Deploy and Save version each open a webview panel rather than a chain of prompts, so every
field is visible and revisable before anything runs. Both use one form engine
(`src/forms/`) driven by a declarative `FormSpec`.

**Dry run is a mode, not a preflight.** A checkbox, ticked by default, appends `--dry-run`.
While ticked, nothing can reach the platform and no confirmation is needed. Unticking is the
deliberate act: the submit button changes label and turns red.

| | Deploy | Save version |
|---|---|---|
| Version name | optional — blank omits `--version`, CLI defaults to a UTC timestamp | **required** |
| Description | optional — `deploy.go:104` skips it when empty | **required** |
| Environment | select; rendered as static text when the project has one environment | n/a |
| Dry run | default on | default on |
| Confirm on live run | yes, gated by `versori.confirmDeploy` | no — a version makes nothing live |

The required fields on Save version are not a stylistic choice: `versions/create.go:67-77`
opens an interactive editor for either blank value, which deadlocks a process with no TTY.
Submit stays disabled until both are filled, and `buildVersionArgs` throws as a backstop.

**Confirm bar.** A live deploy swaps the footer for an inline warning with **Don't ask
again**. It is in-panel rather than a VS Code modal because modals cannot host a checkbox.
Ticking it writes `versori.confirmDeploy: false` globally; the setting description says how
to restore it.

**Output** renders into the panel as well as the OutputChannel, so the dry-run file list can
be read in place, the checkbox unticked, and the deploy run without relaunching anything.

**Webview security:** strict CSP (`default-src 'none'`) with a per-render nonce, no external
resources, `localResourceRoots: []`. The DOM is built client-side from a JSON spec and
values are assigned via `.value`/`.textContent`, so no CLI or user string is ever
interpolated into HTML.

**Excluded entirely:** `projects sync`, `kv set`, `kv delete`, `kv wipe`.

**Excluded entirely:** `projects sync`, `kv set`, `kv delete`, `kv wipe`.

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
