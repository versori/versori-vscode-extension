# Versori for VS Code

A status bar indicator, Activity Bar launcher, and command launcher for the `versori` CLI.

## What it does

The `versori` CLI decides two things implicitly: which **project** a command targets (from the
nearest `.versori` file) and which **context** it runs under (a `.versori` can silently override
your active context — the CLI mentions this once, on stderr).

This extension puts both in the status bar, scoped to the file you are actually looking at:

```
main ✓   ⚡ acme · shopify-sync
              ↑ click → menu
```

| Bar | Meaning |
|---|---|
| `$(plug) acme · shopify-sync` | in a synced project; context `acme` |
| `$(alert) acme · shopify-sync` *(amber)* | `.versori` is **overriding** your active context |
| `$(plug) acme` | file is outside any project; showing the active context |
| `$(error) Versori: CLI not found` | set `versori.cliPath` |

The amber state is the point of the extension — it surfaces a context override that is
otherwise easy to miss right before a deploy.

The same menu is also available from the **Versori** icon in the left Activity Bar. The sidebar
contains one launcher row and invokes the same `versori.showMenu` command as the status bar, so
context resolution and safety gates cannot drift between the two entry points.

## Menu

Click the status bar item or the Activity Bar launcher. The menu is grouped as **Project
management**, **KV**, **Connectors and connections**, **Users and variables**, and **Observe**.
Most project-scoped entries only show when the file you are looking at is inside a synced project;
**Sync...** and organisation-wide entries remain available without one.

**QuickPick mutations** — **Deploy**, **Save version**, and **Sync** stay inside the extension
QuickPick. Each action moves through screens in that popup: **Back** returns to the previous step,
while **Escape** cancels the current step or backs out to the previous one. Text and textarea values
are entered directly in popup input screens.

**Dry run by default** (project-scoped) — Deploy and Save version start with **Dry run** ticked,
so the first click lists the files that would upload and changes nothing. They differ in what
happens after you untick it:
- **Deploy...** — pick an environment, enter the optional version name and description in the
  popup, then review the dry run. Unticking **Dry run** and choosing the live action opens a
  **popup confirmation screen** naming the project and environment; confirm there to run it.
  `versori.confirmDeploy` turns that last gate off if you do not want it.
- **Save version...** — enter the required name and description in the popup. Unticking **Dry
  run** submits on the next click with **no extra confirmation**: a version is an inert snapshot
  that is explicitly *not* deployed, so it does not need Deploy's gate.

**A mutation behind a confirmation** (project-scoped):
- **Resources...** — choose an environment when needed, then edit CPU, memory, storage, replicas,
  autoscaling maximum, and static IP in a screenshot-inspired webview with literal sliders.
  Service-account and request quantities remain under **Advanced**. **Apply** always opens a
  modal confirmation before `projects edit` changes the live deployment config.

**Sync...** (always available) — choose a project from `projects list`, then choose a workspace
folder or select **Type another folder path**. A typed absolute or workspace-relative path is
accepted even when the target folder has no existing `.versori`. The Sync screen starts with
**Dry run** ticked and shows the create/update/delete preview without changing local files.
The CLI may create a nonexistent target directory during that dry run, but it does not write
project files until live confirmation.
Unticking it exposes a mandatory **popup confirmation screen** warning that live sync can
overwrite local changes and delete local files missing from the remote project; only accepting
that warning sends `projects sync --confirm`. There is no “Don't ask again” option for Sync.

**Result and management panels remain separate** from the mutating QuickPick wizard. They open
outside the popup, and command output is also recorded in the "Versori" output channel:

| Entry | Scope | Command | Notes |
|---|---|---|---|
| **Logs** | Project | `projects logs` | Purpose-built viewer — see below |
| **Issues** | Project | `projects issues list` | Plus close/update and email notification channels — see below |
| **Connectors** | Project | `projects systems list` | "Connector" is the platform's name for a system; the CLI has no `connectors` command, so the argv stays `systems` |
| **Static connections** | Project | `projects systems list-connections` | Connections bound to an environment |
| **KV entries** | Project | `kv list`, `kv set`, `kv delete`, `kv wipe` | Read, edit, and delete with confirmation — see below |
| **Versions** | Project | `projects versions list` | |
| **Activations** | Project | `projects activations ...`, `users create` | Users, activation connections, and activation variables |
| **Variables** | Project | `projects variables ...` | DynamicVariablesSchema CRUD |
| **Connections** | Organisation-wide | `connections list` | |
| **KV stores** | Organisation-wide | `kv stores list`, `projects list` | Grouped by project name when the join is available |

Below that, always available: **Switch context...** and **Show output log**.

The extension says **Connectors** where the CLI says `systems` — that is the platform's own
vocabulary; every panel still shows the real argv (`versori projects systems list`).

### The log viewer

Log records are heterogeneous key/value documents, so they are not rendered as a table. Each
entry reads `timestamp · severity · message` as its headline, with every field one click away.
The CLI returns ascending time order; **the panel reverses that to newest-first** so the latest
failure is at the top.

- **Search (server-side)** is passed to `projects logs --search`, so it narrows what is fetched
- **Include** and **Exclude** filter the fetched page client-side. The CLI has no exclude flag,
  which is why exclusion happens here. Each box takes any number of alternatives, one per line
  (commas still work), and there is a case-sensitivity toggle. As well as plain text — which
  matches anywhere in an entry, including field *names* — they accept scoped forms:
  `message="exact title"`, `message^="title prefix"`, `fields.executionId="01ABC"`,
  `fields.route^="/orders/"`, and `fields.error.*` for "has any field under this path"
- **Clicking a message title, field name or field value** opens a menu that copies it or appends
  the matching exact/prefix expression to Include or Exclude, so a filter never has to be typed
  from memory. **Copy JSON** copies that one entry, redacted, as formatted JSON
- **Severity chips** toggle levels; the set is derived from the data, not hardcoded
- **Live logs** polls every 10 seconds, merging only entries the page does not already hold —
  repeated log lines are preserved as separate entries, and the page stays bounded by **Limit**.
  It follows new entries only while you are parked at the top; scroll down and a
  `N new logs · Back to top` control accumulates instead of moving the view under you. A failed
  poll leaves the page alone and retries. Live mode needs a relative time range, since a custom
  absolute window does not advance
- **Group by title** collapses the visible entries into one row per exact message, showing the
  worst severity present, the instance count and the latest time. Each instance stays
  independently expandable
- **Expand all** / **Collapse all** for the field detail under each entry

### Issues

Filter by environment, status, severity and page size, then expand a row for full detail.
**Close** and **update** (status/severity) run `projects issues update` and are not modal —
every transition is reversible with another update. The same screen carries **email
notification channels**: create an organisation-wide channel, link it to this project and
environment with an optional label, severities and title/message filters, or unlink it (modal
confirmed). Channel / binding parsing follows the CLI's printable JSON (`to`, `channelId`),
not the nested API schemas — binding rows are joined to channels so the recipient shows.

### KV entries

Browser over `kv list`, with friendly `--scope` targeting (organisation, workspace, project, end
user, execution). Entries are **expandable**: a collapsed row shows the key and its `createdAt`;
expanding it reveals the stored value, `expiresAt` (its TTL) and `versionstamp`.
There is an **Expand all / Collapse all** toggle alongside the per-row twist.

The search box filters **only the entries already loaded on this page** — `kv list` has no
server-side search, so other pages are not searched. Narrow with the key prefix control instead,
or page through with real cursor-based **Next** / **Previous**, which drive the CLI's opaque
`--after` / `--before` flags. An on-demand **Count all** button runs `kv count` only when
clicked; because it is a separate call, its total can go stale relative to the page on screen.

If a page response exceeds the platform's ~4 MiB gRPC limit **on first open**, the panel
retries once with **page size 1** and updates the control to match. Refresh and paging do
not auto-shrink — they surface the error so you can tighten the prefix or lower page size
yourself. If `--limit 1` still fails, a single value is over the limit.

Values are off-screen by default, and revealing one is a deliberate click. That is intentional:
KV values can hold secrets, and this branch's redaction matches on key *names* — a KV entry's
own field names are literally `key` and `value`, so there is nothing for it to catch there.

**Set entry**, **Edit**, **Delete**, and **Wipe prefix** are available from the same panel. Every
write is host-confirmed before the noninteractive CLI invocation: set/delete use `--yes` (the CLI
also accepts `--confirm` as the same skip-prompt), while
wipe runs the CLI dry-run first and only sends `--confirm` after the bulk target and count are
shown. Empty keys and whole-scope wipes are refused by the extension.

KV stores are grouped by project name when `kv stores list` prefixes can be joined to `projects
list`. If the project list is unavailable, the panel falls back to the project ID, organisation,
execution, or unknown-store label rather than hiding a store.

Every generic results table also has a **Columns** picker, instead of a silent column cap.

Successful blank JSON output is treated as an empty result by the extension. Blank or whitespace
responses render **No results** / **No entries**; non-blank malformed JSON still reports an error.

### A behaviour worth knowing if you also use the CLI directly

Editing resources through this extension always re-sends `--max-replicas`, because
`projects edit` disables autoscaling whenever that flag is omitted on a given invocation. That
means editing resources through the extension preserves autoscaling, while editing the same
environment with a hand-typed CLI command that omits `--max-replicas` may turn it off.

## Keyboard shortcuts

Every menu action is a command, so all of them can be bound to a key. The extension ships
**no default shortcuts** — nothing is taken from your keymap until you choose it.

To bind one, open the Versori menu and pick **Configure keyboard shortcuts** (the last row,
always present). That opens VS Code's Keyboard Shortcuts editor filtered to `versori.`, listing
every action including **Versori: Show Menu**. You can also reach them all from the Command
Palette by typing `Versori:`.

Once bound, the chord is shown next to its action:

- in the menu, after the row's description — `Deploy...  dry run by default · ⌘⇧D`
- on the status bar tooltip and the Activity Bar launcher, for **Show Menu** only

Chords are read from your `keybindings.json` when the menu opens, so binding a key and
reopening the menu is enough — no window reload.

Two limitations worth knowing:

- A binding with a `when` clause is shown as if it always applies. The extension reads the
  keymap file and cannot evaluate `when`.
- Over Remote SSH, the keymap that is read is the **remote** one, which may not be where your
  shortcuts live. The actions still work; only the displayed chord may be missing or wrong.

Invoked from the keyboard or the Command Palette, an action targets the file you are looking at
— the same project the status bar names. Deploy, Sync, and Save version invoked from the
Explorer's right-click menu target the folder you clicked instead. A project action with no
synced project reports that rather than picking one for you.

## Setup

```sh
npm install
npm run build
```

Press <kbd>F5</kbd> to launch an Extension Development Host.

To install locally:

```sh
npm run package
npx --yes @vscode/vsce package --no-dependencies   # produces versori-vscode-0.1.0.vsix
code --install-extension versori-vscode-0.1.0.vsix
```

### `versori.cliPath`

If the bar says the CLI is missing, set this to the absolute path of the binary:

```json
{ "versori.cliPath": "/Users/you/go/bin/versori" }
```

VS Code spawns processes without a login shell, so a `versori` **shell alias** is invisible to
it. The extension searches `PATH` and then `~/go/bin/versori`, but an alias pointing somewhere
else needs this setting.

## Development

```sh
npm run typecheck
npm test
npm run watch
```

Only the `vscode`-free modules are unit tested. The modules that import `vscode` are kept thin
enough that their logic lives in the tested ones, so there are no mocked VS Code namespaces.

That rule now covers test files (`src/**/*.test.ts`), grouped by module: `src/cli.ts`,
`src/contexts.ts`, `src/commands/target.ts`, `src/resolver/`, `src/forms/`, `src/issues/`,
`src/activations/`, `src/kv/`, `src/logs/`, `src/resources/`, `src/variables/`, `src/results/`
and `src/webview/`. This list will drift as the extension grows — `src/**/*.test.ts` is the source
of truth, not this sentence.

`src/resolver/local.test.ts` ports its cases from `pkg/cmd/config/config_test.go` in the CLI
repo. That is deliberate: the resolver is a second implementation of precedence rules owned by
the Go code, and those tests are what catch drift. If the CLI ever gains
`versori context show --directory`, write a `CliContextResolver` against the same
`ContextResolver` interface and swap it in `extension.ts` — nothing else needs to change.
