# pm-ts-starter

TypeScript reference extension for [pm-cli](https://github.com/unbraind/pm-cli) covering **all 9 SDK capability types** in one fully-typed `index.ts`, checked against the **pinned pm-cli SDK** (the exact version is in `package.json`). The backend conformance surface requires the tested SDK floor 2026.10.17.

Development dependencies pin the CLI/SDK, `pm-ops` and `pm-changelog` to exact
versions in `package.json`; Dependabot moves them together as the `pm-toolchain`
group. The prepare hook rejects incomplete `pm-ops`
installations so missing merge drivers cannot silently pass installation.
The pinned documentation analyzer covers TypeScript and TSX. A consumer
regression verifies that undocumented declarations in either file type fail.

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

The current SDK accepts an optional third `options` argument
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
  the current SDK reads first (over the legacy `type`).

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
per-clone Git config; `npm install` / `npm ci` wires them automatically via the `prepare` script, `scripts/prepare-merge-driver.ts`: the launcher template pm-ops ships, copied unchanged, which a test compares byte for byte with the pinned template. It runs pm-ops's installer, which calls `pm merge install` when the `pm` CLI is on `PATH` and skips with a notice when it is not. A production install of a clone (`npm ci --omit=dev`) has no `pm-ops`, so the launcher skips with one notice, while a stale or broken `pm-ops` fails the install. Registry installs of this package never run `prepare`. Being Node-based, it behaves identically on POSIX shells and Windows `cmd.exe`. To (re)run manually: `npm run merge:install`.

After merging a branch that touched `.agents/pm/`, reconcile any residual history-hash drift with
**`pm merge reconcile`** (pm-cli ≥ 2026.7.22): preview with `pm merge reconcile --dry-run`, apply with
`pm merge reconcile --message "post-merge reconcile"`, then confirm with `pm validate`, which scans the
whole tracker and flags remaining history drift across **every** affected item (`pm merge reconcile`
itself lists each affected stream in its output; `pm history --verify <id>` spot-checks one item). The field-aware driver already unions every author's
content, so `reconcile` only re-greens the hash chain (no data loss) — see the authoritative
[pm-cli merge-safety guide](https://github.com/unbraind/pm-cli/blob/main/docs/MERGE_SAFETY.md). The
older blunt `pm history-repair --all` remains available as a lower-level primitive.

## Typed backend conformance project

Generate a deployable TypeScript extension with an SDK surface, a standalone CLI,
and executable directory/remote receipt contracts:

```sh
pm ts-starter backend-project --target ./pm-my-backend --name pm-my-backend --json
cd pm-my-backend
npm install
npm run build
npm test
bun run test:bun
node dist/cli.js inspect ./tracker --json
```

`node dist/cli.js inspect --json` reads the default `.agents/pm` tracker. A leading
option is a flag, not a tracker path.

The target must be new; existing directories are refused. Generation emits nine
small text files and never runs installation, Git, or network commands. The generated
package is independent of pm-ts-starter and uses the tested SDK floor 2026.10.17.
Publish with your normal npm workflow after configuring package ownership and CI.

`createDirectoryAdapter(root)` reads all statuses through the SDK with extensions
disabled. `createRemoteAdapter(reader)` accepts a caller-owned authenticated
MCP/HTTP transport returning the same complete-list envelope. Both certify strict,
unbounded, full reads before returning compact counts and proof. A remote transport
owns its timeout, cancellation and credentials; the generated project does not assume
a hosted API or configure a connection. Contract tests exercise real tracker data
through both boundaries, including missing-receipt negative controls.

`execute("create" | "update" | "delete")` returns a discriminated
`unsupported_operation` refusal with a remedy, before invoking the provider. Invalid
source receipts return `invalid_receipt` and SDK findings; unavailable backends return
`backend_unavailable` without leaking the underlying error. Standalone CLI failures
exit 2 and offer JSON or default TOON. The extension registers `pm <name> inspect`.
See [the SDK example](docs/backend-conformance.md) for adapter composition.

## Without git

All starter commands and generated-project generation, builds, certified reads,
refusals and contract tests work in plain directories. These paths require no Git
executable. The backend contract suite runs npm and Bun consumers with Git absent
from `PATH` and an explicit Git discovery ceiling. Both npm and Bun are required
for this suite, including local runs; set `BUN_EXE` if Bun is outside `PATH`.
Consumer subprocesses have a five-minute timeout, and install failures fail the test.
SDK reads may maintain disposable
caches; use a tracker copy for archival inputs. No generated operation needs Git.

## Schema migration rehearsal

`pm ts-starter rehearse-schema --source ./old-tracker --plan ./migration.json --work-dir "$REHEARSAL_DIR/run-1" --json`
rehearses custom item field/type evolution on a private resumable copy outside Git.
The original tracker is read only; invalid data produces field diagnostics. Repeat
the same command after interruption to resume without duplicate migration history.
An explicit `--source` is required. Run from a separate caller tracker: the source
must neither equal nor contain the active tracker after realpath resolution.
Host startup can recreate missing schema files before extension code runs
([pm-cli#1568](https://github.com/unbraind/pm-cli/issues/1568)), even for read commands.
`source_unchanged: true` compares the extension's snapshot taken before its first
controlled write with the final source; it cannot certify bytes before host startup.
Use native TOON or `--json` for compact count receipts. Core remains authoritative
for schema and migrations; pm-presets owns configuration upgrades.

The typed SDK exports `rehearseSchemaMigration`, `parseRehearsalPlan`, and
`RehearsalRefusal`. See the [guide and SDK example](docs/schema-migration-rehearsal.md)
and [JSON plan](docs/examples/schema-migration.json). This feature works without Git
and requires a directory tracker; export remote data explicitly before rehearsal.

## SDK contract drift compiler checks

`pm ts-starter sdk-contracts` compiles real author-controlled consumers against
this extension's declared minimum SDK and an explicitly selected current published
SDK. It checks public signatures and the return shapes used by each example.
Dependabot still owns dependency bumps; installation/pin acceptance remains a
separate gate. No versions or tracker records are changed by this command.

Provision exact published SDKs independently (retain your registry integrity
receipts), then pass their package roots:

```sh
npm install --prefix ./sdk-min --ignore-scripts --no-package-lock @unbrained/pm-cli@2026.10.17
npm install --prefix ./sdk-current --ignore-scripts --no-package-lock @unbrained/pm-cli@2026.10.24
pm ts-starter sdk-contracts \
  --minimum-sdk ./sdk-min/node_modules/@unbrained/pm-cli \
  --current-sdk ./sdk-current/node_modules/@unbrained/pm-cli \
  --current-version 2026.10.24 \
  --compiler ./node_modules/typescript/bin/tsc --json
```

Omit `--json` for native compact TOON. The result has `ok`, `checks`, `failed`,
`rows` and `remedy`; a drift matrix exits nonzero while retaining the matrix.
Each row identifies the endpoint, verified version and example, with the full
error count and at most three TypeScript codes and locations. Raw source text and machine
paths never appear in these diagnostics. `invalid_input`, `sdk_unavailable`,
`compiler_unavailable` and `isolation_refused` are typed refusals with retry guidance.

Pass `--consumer ./consumer` to check a self-contained consumer project. Its sources,
package metadata, dependencies and tsconfig are copied into an exclusive directory
for each bound. Each copy contains the selected SDK as a physical package in its
fresh node_modules. The project copy excludes every node_modules directory and
Git metadata. npm installs the consumer's installed package artifacts separately,
with lifecycle scripts disabled. A private template of those fresh artifacts is
cloned into each bound, where the selected SDK replaces the SDK package. The consumer package metadata is restored byte for byte. The same
installed compiler artifact runs inside the copy, so its standard libraries are
also inside the isolation boundary. Compiler package and standard-library bytes
are checked against the original installation before cloning; a mismatch receives
`compiler_unavailable` instead of silently substituting another compiler.
The original tsconfig, in-project extends targets, project references, sources and
existing build artifacts retain their relative layout and bytes. Compilation runs
`tsc --project tsconfig.json` with no option overrides, generated config, injected
outDir, or output relocation. Native emits and build-info stay in the project
copy. Absolute or project-escaping output/cache paths receive `isolation_refused`
with a remedy to use contained relative destinations.
Project mode cannot be combined with `--examples` or `--compiler`. Include the
project's installable dependencies and compiler in its node_modules before running
the checker. Sandbox provisioning requires npm; it does not run lifecycle scripts.

The default inline examples exercise typed authoring composition and certified
complete tracker reads. Use `--examples docs/examples/sdk-contracts.json` for a
JSON array of `{id, source}` consumers (1–16 examples, each at most 64 KiB).
Inline mode creates a strict NodeNext consumer with Node ambient types. It provisions the selected TypeScript artifact inside the copy. Custom compiler
wrappers and shell shims must resolve their compiled inputs and libraries inside
the copy too.
Inline sources are passed through byte for byte. Supply declaration graphs in a
self-contained consumer project with relative imports; inline imports that resolve
outside the copy receive a named post-compilation isolation refusal.
The checker compiles consumer source without executing it.

The verdict is the consumer compiler's diagnostics. Every error is drift,
including errors in external declarations and ambient dependencies. There is no
custom module or exports resolver, SDK declaration rebinding, `paths` injection,
or diagnostic code allowlist.
TypeScript alone selects import/require conditions, versioned `types@` conditions
and typesVersions. Each row retains the full diagnostic count, at most three
codes, and corresponding project-relative file/line/column locations. External
locations use a safe marker; source text and raw compiler messages stay private.
Every compiler invocation clears `NODE_PATH`, `NODE_OPTIONS` and inherited `TS*`
environment variables. After compilation, a discovery-only `--listFilesOnly` pass
checks the compiler's own resolved inputs. Every canonical file must be inside the
copy, and every SDK declaration must belong to the selected SDK installation.
An escaping resolved file receives `isolation_refused` naming that file without
publishing an absolute machine path. Unused aliases and ordinary string literals
are never interpreted as filesystem references. Missing imports retain native
compiler diagnostics. Empty or unstructured provenance fails closed.
Each invocation is bounded to 30 seconds and 8 MiB. Compiler failures without
usable diagnostics produce `compiler_unavailable`.

The invoked compiler's `--help --all --locale en` table is read once per compiler
per check, including watch and build declarations. `sdk-compiler-policy.ts` is the
single reasoned policy for all 137 TypeScript 7.0.2 options. Its classes confine
output/cache destinations, refuse checking bypasses, or preserve consumer values. Every newly discovered option receives a typed
`isolation_refused` with guidance to classify it before retrying; the completeness
test also fails on a new option. Active `noCheck`, `noResolve`, `skipLibCheck`, and
`skipDefaultLibCheck` receive a typed refusal naming the option and explaining how
to disable it. They are never silently flipped. Strictness and JavaScript checking
retain the consumer's semantics. Invalid or command-only configuration settings
fail closed; the checker invokes project compilation, without build or watch mode.
Referenced project declarations must already be built when plain project `tsc`
requires them; the checker does not build project references automatically.

A full-table property asserts that every original configuration value reaches the
compiler unchanged. Instrumented real compiler invocations compare complete
option objects and resolved files. The differential oracle runs plain tsc on a
second identical copy, with the original config and no output overrides. Cases
include allowJs TS5055 output collisions, JSON imports and quoted path literals,
composite membership, incremental caches, declaration maps, declaration-only
emission, consumer noEmit, explicit libraries and built or missing references.
Both SDK bounds compare verdicts, diagnostic counts and complete error-code
multisets. Filesystem snapshots protect original inputs and neighboring bounds.

The differential suite covers node16, nodenext and bundler resolution, ESM imports
and CJS requires, exports types conditions, versioned types conditions and
typesVersions, at both SDK bounds. npm and Bun consumers install their own exact
SDKs and compilers and verify resolution at runtime. Each isolated copy also runs
plain `tsc --noEmit`, comparing all 144 matrix verdicts (84 clean, 60 drift),
including the review's TS2339/TS2305 cases. Another 64 differential rows retain
all 16 hostile specifiers in consumer and external declarations at both bounds.
Consumer source and tsconfig bytes must match the originals. The existing eight
import mutation controls and an intentionally blind compiler remain regression
controls. API examples only cover the signatures they use; runtime behavior needs
separate assertions. The checker verifies package name/version, while registry
provenance remains the provisioner's responsibility.

The exported `checkSdkContracts`, `SdkContractOptions`, `SdkContractMatrix` and
`SdkContractRefusal` provide the same contract for TypeScript callers:

```ts
import { checkSdkContracts, type SdkContractMatrix } from "pm-ts-starter";
const matrix: SdkContractMatrix = await checkSdkContracts({
  minimum: { root: "./sdk-min/node_modules/@unbrained/pm-cli", version: "2026.10.17" },
  current: { root: "./sdk-current/node_modules/@unbrained/pm-cli", version: "2026.10.24" },
  compiler: "./node_modules/typescript/bin/tsc",
});
if (!matrix.ok) process.exitCode = 1;
```

Every call allocates its own disposable directory, releases it last, and removes
only that allocation. It ignores all tracker records because none are inputs to
compiler checks; foreign state remains owned by its writer. Concurrent callers
share no claims, leases, checkpoints, budgets, outboxes or caches. The optional
`onProgress` observer reports allocation, target installation, each compilation and
cleanup. The regression suite injects successful peers at every such boundary
on one plain tracker and verifies preservation.

### Without git

SDK compiler checks work in plain directories and non-git trackers, including
with no `git` executable on `PATH`. The command never invokes git or reads a
tracker. Packed npm and Bun consumer tests compile the emitted package declarations
against the two published SDK endpoints. Each runtime installs a separate consumer
with the exact manifest minimum or selected current SDK and asserts the version
resolved from the emitted package at runtime. A newer-only SDK API fails the
minimum compilation while passing the current one. Repository changelog/tag workflows still
need git. See [the consumer example](docs/examples/sdk-contracts.json).
