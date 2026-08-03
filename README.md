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

Click the status bar item.

**Read-only** — output goes to the "Versori" output channel:
Issues · Logs · Systems · Versions · Connections · Switch context

**Guarded** — these run `--dry-run` first and show you the real file list before confirming:
- **Deploy...** — pick environment, enter a description, review the dry-run, confirm
- **Save version...** — name and description collected up front, then a checkpoint that is
  explicitly *not* deployed

**Deliberately excluded:** `projects sync` (its `--confirm` deletes local files) and all KV
mutations (`kv set` / `delete` / `wipe`). Those stay in the terminal where their safety
prompts live.

## Setup

```sh
npm install
npm run build
```

Press <kbd>F5</kbd> to launch an Extension Development Host.

To install locally:

```sh
npm run package
npx vsce package --no-dependencies   # produces versori-vscode-0.1.0.vsix
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

Only the `vscode`-free modules are unit tested — `src/resolver/` and `src/cli.ts`. The modules
that import `vscode` are kept thin enough that their logic lives in the tested ones, so there
are no mocked VS Code namespaces.

`src/resolver/local.test.ts` ports its cases from `pkg/cmd/config/config_test.go` in the CLI
repo. That is deliberate: the resolver is a second implementation of precedence rules owned by
the Go code, and those tests are what catch drift. If the CLI ever gains
`versori context show --directory`, write a `CliContextResolver` against the same
`ContextResolver` interface and swap it in `extension.ts` — nothing else needs to change.

The design lives in `docs/superpowers/specs/` in the source repository.
