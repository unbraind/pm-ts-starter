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
# A classic-API compiler with Node ambient types beside it (TypeScript 7 has no Program API; see below).
npm install --prefix ./tsc-api --ignore-scripts --no-package-lock typescript@6.0.3 @types/node
pm ts-starter sdk-contracts \
  --minimum-sdk ./sdk-min/node_modules/@unbrained/pm-cli \
  --current-sdk ./sdk-current/node_modules/@unbrained/pm-cli \
  --current-version 2026.10.24 \
  --compiler ./tsc-api/node_modules/typescript/bin/tsc --json
```

Omit `--json` for native compact TOON. The result has `ok`, `checks`, `failed`,
`rows` and `remedy`; a drift matrix exits nonzero while retaining the matrix.
Each row identifies the endpoint, verified version and example, with the full
error count, up to three sample codes, and compiler diagnostic locations/messages.
Disposable project prefixes are normalized in those messages. `invalid_input`, `sdk_unavailable`,
`compiler_unavailable`, `compiler_api_unavailable`, `unsupported_project_shape` and `isolation_refused` are typed refusals with retry guidance.

`--compiler` applies only to inline examples. It selects the installed
`node_modules/typescript` package through a file inside it (for example
`typescript/bin/tsc` or `typescript/lib/typescript.js`), or a symlink whose real
path is inside that package (including a symlink at `node_modules/.bin/tsc`).
The checker loads that package's JavaScript API and never runs the selected file
as a command; selecting `lib/typescript.js` loads that module like any API import. Regular shell, JavaScript and Windows command wrappers outside the package
are rejected with `compiler_unavailable`, even when executable. For a wrapper at
`node_modules/.bin/tsc`, pass `node_modules/typescript/bin/tsc` instead.
The package must expose the classic compiler APIs described below. With
`--consumer`, omit `--compiler`: the consumer's own installed TypeScript is used.
The last `node_modules` component in the supplied compiler path selects the
installation. A path without that component selects the checker's local
`node_modules`; a symlink to a different installation is rejected. Prefer the
explicit package entry shown above when selecting another installation.

Pass `--consumer ./consumer` to check a self-contained consumer project. Its sources,
package metadata, dependencies and tsconfig are copied into an exclusive directory
for each bound. Each copy contains the selected SDK as a physical package in its
private node_modules. The template copies the consumer's complete installed tree
under its installed directory names, including hidden stores, scoped aliases,
nested and bundled dependencies, workspaces and local links. It never invokes a
package manager, re-resolves manifests or lockfiles, executes lifecycle scripts,
or derives an installation name from package metadata. Lockfiles can describe a
different installation from the one actually being checked, so the installed tree
is authoritative. Internal links are rebased into the copy; external link targets
remain symlinks to their installed targets. The checker treats those targets as
read-only but cannot protect them from writes: the consumer's TypeScript module
loads with the caller's filesystem permissions, so run untrusted compilers inside
an OS sandbox. Compiler libraries and native companions retain
their original bytes, including files excluded by npm pack rules. Only the SDK
package at the selected bound is replaced in each cloned project. Its canonical
identity is captured before compilation, preserving internal module-root and SDK
scope links while still refusing declarations from another SDK root.
The original tsconfig, extends chain, sources and existing build artifacts
retain their relative layout and bytes. Project mode cannot be combined with
`--examples` or `--compiler`. Include the project's installed dependencies and
TypeScript JavaScript API in node_modules. Neither mode needs npm or network access.
Copying never modifies caller files or shares writable hard links with them.

See [compiler API compatibility](docs/sdk-contract-api-compatibility.md) and the
[subprocess inventory](docs/sdk-contract-process-inventory.md).

The default inline examples exercise typed authoring composition and certified
complete tracker reads. Use `--examples docs/examples/sdk-contracts.json` for a
JSON array of `{id, source}` consumers (1–16 examples, each at most 64 KiB).
Inline mode creates a strict NodeNext consumer with ES2022 libraries and `types: ["node"]` and copies
the installed compiler artifact selected by `--compiler`, together with the `@types` packages installed
beside it. The checker does not supply `@types/node`: install it in the same `node_modules` as the selected
TypeScript, or both bounds report TS2688. Consumer code is compiled
without executing it; imports outside the prepared project/dependency layout are refused.

The checker loads the consumer's own `typescript` JavaScript API in a confined
child. `getParsedCommandLineOfConfigFile` follows the complete extends chain;
`createProgram` and `getPreEmitDiagnostics` supply structured diagnostics. The
original compiler-options object retains TypeScript's configuration metadata.
Project references are refused before Program creation as `unsupported_project_shape`,
naming the referencing and referenced configs. Flattening the references gives a complete check.
Checking each referenced project as its own root is partial: the referencing project is not
checked while its `references` remain, and declarations it consumes from referenced projects must
be regenerated against each SDK bound before they say anything about that bound.
TypeScript's logical config paths retain their relative origins through symlinks. No language service,
compiler-output parser, formatted diagnostic matcher or diagnostic-phase emulation
is used. Compiler options pass through without a classification allowlist.

Error-category Diagnostic objects determine the verdict. Each row retains every
error, its code, file, position and flattened message, plus three sample codes.
The existing exit_code field is zero for a clean API result and one when errors
exist. Project prefixes are normalized and external file locations use a marker.
Results use an exclusive checker-owned JSON file; compiler stdout is discarded. All path transport is JSON; filenames containing diagnostic-like text, CR/LF,
spaces or quotes remain opaque strings. Each child is bounded to 90 seconds and
8 MiB of JSON. The compiler module is a trusted executable input.

Each Program supports one canonical SDK root: the selected `@unbrained/pm-cli`.
Every loaded file is classified through its own nearest named package.json;
format-only unnamed metadata does not hide its owning package. Canonical realpaths
merge aliases to the same root. Vendored, nested, relative and symlinked SDK copies
receive `unsupported_project_shape` with reason `multiple_sdk_copies`, a list of
repo-relative roots and a remedy to dedupe to one SDK. SDK-specifier targets must
also belong to the selected root. No importing package can lend its identity to
another package. Ordinary local packages and single-copy typesVersions resolutions
use the native compiler verdict. Project references are the other refused shape;
see [architecture](ARCHITECTURE.md).

Every bound creates a fresh, non-incremental Program. The checker never calls
emit or an incremental builder and never reads compiler state to skip checking.
Cache files, configured cache targets and real source inputs are preserved.
`noEmit` is enabled, trace/profile writers are inactive, and the API host's
writeFile throws. No configured output path is deleted or rewritten, including
paths that name source files or linked dependency outputs.

Stock TypeScript 5.9.3 and 6.0.3 are tested without wrapping or filtering their
compiler options. A consumer must expose createProgram, getPreEmitDiagnostics,
getParsedCommandLineOfConfigFile and the Program's usage-mode resolution APIs.
Missing compiler APIs receive `compiler_unavailable`; missing Program resolution
capabilities receive `compiler_api_unavailable` naming the source file. The repository's pinned
TypeScript 7.0.2 still builds the package, but its native API does not expose the required
classic Program API; use an installed API-compatible consumer compiler for checking.
The checker never substitutes a different compiler behind the consumer's back.

Installed aliases retain their directory names. Internal links are rebased into
the copy. Non-dependency symlinks that leave the consumer root or cannot be resolved
receive a typed isolation refusal before any compiler runs. External installed package
links remain links to their original read-only inputs. Canonical dependency roots are visited once, so mutual package links do
not cause recursive copying or traversal. The selected SDK alone is replaced.
There is no dependency install, reinstall or package-manager link command.

Every checker subprocess gets private HOME, XDG, cache and temporary directories.
Inherited npm configuration, Node/TypeScript resolution injection, runtime compile caches and coverage
settings are removed. The copied npmrc retains registry connection settings only;
no installer or lifecycle script executes. Original inputs and linked dependency
contents remain unchanged, verified by filesystem snapshots.

The differential suite compares complete structured diagnostics against an
independent direct consumer API program. It covers inherited invalid options at
every level of one-to-three-level extends chains, unnamed nested package metadata,
linked foreign SDKs, diagnostic-like filenames and generated filesystem layouts.
Generated reference graphs are refused, with paired reference-free controls. The
81 file-kind/import-syntax/conditional-export combinations per compiler also compare
verdicts with real `tsc --build`. Mutual dependency links, fatal options, global diagnostics,
warm/cold caches and file/directory writer targets retain dedicated controls.
Consumer configuration and original filesystem snapshots remain unchanged.

The dependency differential corpus covers 12 installed shapes with passing and
TS2322 controls: npm and scoped aliases, file copies and links, link dependencies,
named and relative workspaces, peers, bundled dependencies, differing metadata names, nested aliases
and hidden stores. A separate property runs 200 independent seeded dependency
graphs through plain tsc and the checker, with imports by installed name. It uses
at most two active test workers; these are ordinary test processes, with no agent
or model calls. The test and coverage entrypoints run one test file at a time.
Both bounds must retain the independent verdict and codes without changing the
consumer tree. The alias-fixture/actual-fixture review case has a dedicated regression.

The differential suite covers node16, nodenext and bundler resolution, ESM imports
and CJS requires, exports types conditions, versioned types conditions and
typesVersions, at both SDK bounds. Single-copy typesVersions resolutions retain their native diagnostics. npm and Bun consumers install their own exact
SDKs and compilers and verify resolution at runtime. In each isolated copy an
instrumented compiler API records the diagnostics of the checker's own Program, so
the test compares the matrix verdicts and codes with what the API returned, the
bound's own SDK installation and the unchanged tsconfig and sources. That Program
is not independent: it cannot expose a configuration or resolution error the
checker shares. Resolution is instead checked against verdicts derived from the
declaration fixtures, whose layouts make each resolution rule distinguishable,
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
  compiler: "./tsc-api/node_modules/typescript/bin/tsc",
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
