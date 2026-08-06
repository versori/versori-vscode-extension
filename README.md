# Versori for VS Code

A status bar indicator and command launcher for the `versori` CLI.

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

## Menu

Click the status bar item. Entries appear in this order below. Project-scoped entries only show
when the file you are looking at is inside a synced project; the organisation-wide ones always
show.

**Guarded** — these run `--dry-run` first and show you the real file list before confirming
(project-scoped):
- **Deploy...** — pick environment, enter a description, review the dry-run, confirm
- **Save version...** — name and description collected up front, then a checkpoint that is
  explicitly *not* deployed

**A mutation behind a confirmation** (project-scoped):
- **Resources...** — view and edit CPU/memory/storage requests and limits, replicas, the
  autoscaling maximum, static IP and service account for an environment, via `projects edit`,
  behind a modal confirmation

**Read-only** — output goes to the "Versori" output channel:

| Entry | Scope | Command | Notes |
|---|---|---|---|
| **Logs** | Project | `projects logs` | Purpose-built viewer — see below |
| **Issues** | Project | `projects issues list` | Plus close/update and email notification channels — see below |
| **Connectors** | Project | `projects systems list` | "Connector" is the platform's name for a system; the CLI has no `connectors` command, so the argv stays `systems` |
| **Static connections** | Project | `projects systems list-connections` | Connections bound to an environment |
| **KV entries** | Project | `kv list` | Read-only browser — see below |
| **Versions** | Project | `projects versions list` | |
| **Connections** | Organisation-wide | `connections list` | |
| **KV stores** | Organisation-wide | `kv stores list` | |

Below that, always available: **Switch context...** and **Show output log**.

The extension says **Connectors** where the CLI says `systems` — that is the platform's own
vocabulary; every panel still shows the real argv (`versori projects systems list`).

### The log viewer

Log records are heterogeneous key/value documents, so they are not rendered as a table. Each
entry reads `timestamp · severity · message` as its headline, with every field one click away:

- **Search (server-side)** is passed to `projects logs --search`, so it narrows what is fetched
- **Include** and **Exclude** filter the fetched page client-side. The CLI has no exclude flag,
  which is why exclusion happens here. Both accept comma-separated alternatives, and there is a
  case-sensitivity toggle
- **Severity chips** toggle levels; the set is derived from the data, not hardcoded
- **Fields** picks which field values appear inline in each headline, also derived from the data
- **Expand all** / **Collapse all** for the field detail under each entry

### Issues

Filter by environment, status, severity and page size, then expand a row for full detail.
**Close** and **update** (status/severity) run `projects issues update` and are not modal —
every transition is reversible with another update. The same screen carries **email
notification channels**: create an organisation-wide channel, link it to this project and
environment with an optional label, severities and title/message filters, or unlink it (modal
confirmed).

### KV entries

Read-only browser over `kv list`, with friendly `--scope` targeting (organisation, workspace,
project, end user, execution). Entries are **expandable**: a collapsed row shows the key and its
`createdAt`; expanding it reveals the stored value, `expiresAt` (its TTL) and `versionstamp`.
There is an **Expand all / Collapse all** toggle alongside the per-row twist.

The search box filters **only the entries already loaded on this page** — `kv list` has no
server-side search, so other pages are not searched. Narrow with the key prefix control instead,
or page through with real cursor-based **Next** / **Previous**, which drive the CLI's opaque
`--after` / `--before` flags. An on-demand **Count all** button runs `kv count` only when
clicked; because it is a separate call, its total can go stale relative to the page on screen.

Values are off-screen by default, and revealing one is a deliberate click. That is intentional:
KV values can hold secrets, and this branch's redaction matches on key *names* — a KV entry's
own field names are literally `key` and `value`, so there is nothing for it to catch there.

Every generic results table also has a **Columns** picker, instead of a silent column cap.

**Deliberately excluded:** `projects sync` (its `--confirm` deletes local files), and KV
**mutations** — `kv set` / `delete` / `wipe`. The read-only KV browser above does not change
that; those three stay in the terminal where their safety prompts live.

### A behaviour worth knowing if you also use the CLI directly

Editing resources through this extension always re-sends `--max-replicas`, because
`projects edit` disables autoscaling whenever that flag is omitted on a given invocation. That
means editing resources through the extension preserves autoscaling, while editing the same
environment with a hand-typed CLI command that omits `--max-replicas` may turn it off.

## Setup

```sh
npm install
npm run build
```

Press <kbd>F5</kbd> to launch an Extension Development Host.

To install locally:

```sh
npm run package
npx vsce package --no-dependencies   # produces versori-vscode-0.6.0.vsix
code --install-extension versori-vscode-0.6.0.vsix
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

That rule now covers 21 test files (`src/**/*.test.ts`), grouped by module: `src/cli.ts`,
`src/contexts.ts`, `src/commands/target.ts`, `src/resolver/`, `src/forms/`, `src/issues/`,
`src/kv/`, `src/logs/`, `src/resources/`, `src/results/` and `src/webview/`. This list will drift
as the extension grows — `src/**/*.test.ts` is the source of truth, not this sentence.

`src/resolver/local.test.ts` ports its cases from `pkg/cmd/config/config_test.go` in the CLI
repo. That is deliberate: the resolver is a second implementation of precedence rules owned by
the Go code, and those tests are what catch drift. If the CLI ever gains
`versori context show --directory`, write a `CliContextResolver` against the same
`ContextResolver` interface and swap it in `extension.ts` — nothing else needs to change.

The design lives in `docs/superpowers/specs/` in the source repository.
