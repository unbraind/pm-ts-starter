# pm-ts-starter

TypeScript reference extension for [pm-cli](https://github.com/unbraind/pm-cli) covering **all 9 SDK capability types** in one fully-typed `index.ts`, aligned to the **pm-cli 2026.7.6 SDK**.

Each capability is a small, SAFE, inert demo with teaching comments. Copy the
ones you need into your own extension and delete the rest. The reference also
ships demo commands that integrate with the newer pm surfaces (plan, context,
search, history-compact) and a guided `ts-starter setup --interactive` onboarding.

---

## Installation

```bash
pm install github.com/unbraind/pm-ts-starter --global
```

## Capabilities Demonstrated

Every capability declared in `manifest.json` is demonstrated in `index.ts`. Each
maps to one or more `register*`/`hooks.*` calls on the typed `ExtensionApi`.

| # | Capability | `ExtensionApi` call(s) | What the demo registers |
|---|---|---|---|
| 1 | **commands** | `registerCommand`, `registerFlags` | `pm hello`, `pm ts-starter info`; plus an inert `--ts-starter-tag` flag added to native `list` |
| 2 | **renderers** | `registerRenderer` | `json` renderer override that reshapes only the `ts_starter`-tagged payload, passing everything else through |
| 3 | **hooks** | `hooks.beforeCommand`, `hooks.afterCommand`, `hooks.onWrite`, `hooks.onRead`, `hooks.onIndex` | All five lifecycle hooks (observe-only; opt-in logging via `PM_TS_STARTER_VERBOSE`) |
| 4 | **schema** | `registerItemFields`, `registerItemTypes`, `registerMigration` | Optional field `ts_starter_ref`, a `Spike` item type, and a no-op migration `ts-starter-noop` |
| 5 | **importers** | `registerImporter`, `registerExporter` | `pm ts-starter-demo import` / `pm ts-starter-demo export` (both inert) |
| 6 | **search** | `registerSearchProvider`, `registerVectorStoreAdapter` | Search provider `ts-starter-prefix` (ID-prefix match) and in-memory vector store adapter `ts-starter-memory` |
| 7 | **parser** | `registerParser` | Pass-through parser override for the native `list` command |
| 8 | **preflight** | `registerPreflight` | Pass-through preflight decision override (no behavior change) |
| 9 | **services** | `registerService` | Pass-through override of the `output_format` core service |

## Commands

### `pm hello`
```bash
pm hello
pm hello --name World --loud
```

### `pm ts-starter info`
```bash
pm ts-starter info
```

### Importer / exporter command paths

`registerImporter("ts-starter-demo")` and `registerExporter("ts-starter-demo")`
auto-create:

```bash
pm ts-starter-demo import
pm ts-starter-demo export
```

The 2026.7.6 SDK accepts an optional third `options` argument
(`ImportExportRegistrationOptions`) that adds a full command definition
(description, flags, intent, examples, `failure_hints`, positional arguments)
to the auto-created command path — surfaced in help exactly like
`registerCommand`. This reference supplies it for both.

### New pm-feature integration demos

These demo commands shell out to the live `pm` binary (zero-runtime-coupling —
the extension never imports `@unbrained/pm-cli` at runtime) and return parsed
JSON, so an author can copy the wiring into a real extension that augments
these surfaces:

```bash
pm ts-starter plan-demo [--id <plan-id>] [--depth brief|standard|deep]
pm ts-starter context-demo [--format markdown|toon|json] [--depth brief|standard|deep]
pm ts-starter search-demo [--query <text>] [--limit <n>]
pm ts-starter history-compact-demo --id <item-id>   # always --dry-run
```

### Guided setup

```bash
pm ts-starter setup              # prints a non-interactive summary
pm ts-starter setup --interactive  # prompted onboarding wizard (TTY only)
```

`--interactive` is skipped automatically when stdin is not a TTY, so the
command is safe to run in CI and tests.

### Typed arguments, `failure_hints`, and expected errors

Every `registerCommand` definition now carries:

- **`failure_hints`** — short, actionable strings surfaced to the CLI's
  error-guidance layer when a command fails.
- **`arguments`** — typed positional argument definitions
  (`ExtensionCommandArgumentDefinition`), so help output and runtime contracts
  describe positional args, not just flags.
- **`value_type`** on every flag (`string` | `number` | `boolean`), the field
  the 2026.7.6 SDK reads first (over the legacy `type`).

Command handlers throw **`PmCliExpectedError`-shaped errors** built locally
(`pmExpectedError`) rather than importing the CLI's error class at runtime.
The CLI recognises expected errors by `name === "PmCliError"`, so a locally
constructed error with `exitCode` + structured `context` exits cleanly with a
guided message instead of a stack trace.

## The `defineExtension` helper + zero-runtime-coupling pattern

`defineExtension` is the SDK's **typed identity helper** — it returns its argument
unchanged but constrains it to the `ExtensionModule` shape so TypeScript can
type-check `activate(api)` and the metadata fields against the real SDK.

It is imported as a **type only** (`import type`). A standalone-installed
extension loads only its own `dist/` at runtime, so `@unbrained/pm-cli` is not
resolvable as a runtime value; importing the real function would crash at
activation. We provide a trivial identity implementation and rely on the type
import for full compile-time checking with **zero runtime coupling** to the CLI
package. The real CLI supplies the live `api` object when it calls `activate`.

## Using as a Template

1. Clone this repo
2. Edit `index.ts` — remove capabilities you don't need
3. Update `manifest.json` name and capabilities
4. `npm install && npm run build`
5. `pm install ./path/to/dir --project`

## License

MIT

## Release Automation

This package is release-ready for GitHub, npm, and Bun-compatible installs. CI runs type checking, build, production dependency audit, package packing, Bun install verification, and pm-changelog validation. The daily release workflow publishes only when commits exist after the latest release tag and uses pm-changelog to generate CHANGELOG.md and GitHub release notes.

## Multi-agent merge safety

This repo tracks its project management in `.agents/pm/` and ships a committed `.gitattributes`
that maps those tracker artifacts to pm-cli's field-aware Git merge drivers, so concurrent-branch
tracker edits merge cleanly instead of hard-conflicting. The driver **definitions** live in
per-clone Git config; `npm install` / `npm ci` wires them automatically via the `prepare` script (a portable Node guard, `scripts/prepare-merge-driver.mjs`: it runs
`pm merge install` only when the `pm` CLI is on `PATH`, and no-ops cleanly otherwise so
production / `--omit=dev` installs are not broken; being Node-based it behaves identically
on POSIX shells and Windows `cmd.exe`). To (re)run manually: `npm run merge:install`. After merging a branch that
touched `.agents/pm/`, run `pm history-repair --all` to reconcile history verification.
