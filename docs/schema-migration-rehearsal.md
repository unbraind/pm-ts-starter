# Rehearse extension-owned item schema evolution

A rehearsal performs actual core SDK migrations on an isolated filesystem copy.
Core owns schema definitions, collision checks, item writes, history, and transaction
recovery. pm-presets upgrades configuration. This wrapper rehearses extension-owned
item data changes and never applies them to the original tracker.

Use a directory tracker whose custom fields/types are persisted in its schema files.
Executable extension registrations are deliberately excluded; materialize those
contracts as schema files in a separate reviewed copy first. Remote backends need
an explicit directory export before rehearsal. No Git executable is required.

The [example plan](examples/schema-migration.json) preserves `legacy_ref` values
as `external_ref`, then renames `Experiment` to `Investigation`. Each operation
uses the host's existing `schemaRenameField`, `schemaRenameType`, or
`schemaRemapStatus` method. Optional `type` scopes a field rename. The wrapper
supports 1–32 ordered operations; it does not implement arbitrary value transforms.
Names and optional type scopes use 1–64 ASCII letters, digits, underscores or
hyphens, starting with a letter. Step objects accept only the documented keys.
Plan files must be regular, unlinked files no larger than 64 KiB; symlinked parent
directories are refused too. The object parser rejects unsupported top-level properties and primitive steps
before cloning the bounded plan.

With this extension installed in a separate caller workspace:

```sh
pm ts-starter rehearse-schema --source ./old-tracker \
  --plan ./migration.json --work-dir "$REHEARSAL_DIR/run-1" --json
```

`REHEARSAL_DIR` must identify private scratch storage outside any Git repository.
The command creates `run-1`, containing `tracker/`, `rehearsal.json`, and SDK runtime
journals. Repeat the identical command to resume. `--source` is mandatory and must
neither equal nor contain the active caller tracker after realpath resolution,
including through aliases. These cases refuse before reading the plan or creating
scratch artifacts. Run from a separate caller tracker. Host startup may recreate
missing `schema/workflows.json` even for read commands, before the extension runs
([pm-cli#1568](https://github.com/unbraind/pm-cli/issues/1568)); a refusal cannot undo
or certify those earlier host writes. The harness itself only reads the source. Source and scratch
must be disjoint real directories, with no symlinks, hardlinked or special files.
Existing scratch contents, including lock directories, are scanned before acquiring
a lease, so a lock alias cannot redirect writes into the source.
Schema paths are trimmed exactly as the SDK trims them, then checked for tracker
containment before any SDK read, on first runs, resume and final inspection. Item folders must be flat and cannot
overlap schema, history or runtime storage. Snapshots are capped at 256 MiB,
20000 total file/directory entries and 64 path components. Extensions, locks,
search artifacts, runtime caches and transaction journals are excluded from the
input snapshot.

Settings and schema fallback warnings are fatal: default settings cannot certify
an unread custom corpus. Valid legacy Markdown remains supported. All four schema files must already
exist; bootstrap defaults cannot replace missing schema input. Supplied field,
status, type and workflow properties must survive SDK normalization, and workflow
references must identify declared types and statuses. Field definitions require
an explicit valid key and type. Every physical `.toon` or `.md` item outside
schema/history storage must belong to a registered, flat item folder, and its
count must match the certified SDK enumeration. Scratch settings, corpus size, authoritative bytes and committed core progress
are checked again after SDK recovery and before starting a new core operation. Storage containment and source/plan identity are checked before recovery. Existing history streams
must parse and pass the SDK hash-chain verification. The extension never writes
source bytes, on refusal or success. Its source fingerprint is taken before any
scratch creation, lease, SDK read or migration it controls. `source_unchanged: true`
certifies equality with that snapshot at completion, not with bytes from before
host startup. The standalone SDK has no active host tracker; callers embedding it
must keep their own startup and other writes outside the source observation window.

Concurrent callers may receive `unavailable` while the creator initializes the
first checkpoint or another caller owns the lease. Retry after that caller
finishes. A checkpoint-free directory is refused before acquiring a lease, so a
competing caller cannot displace the creator. If initialization stops before any
checkpoint exists, choose a new scratch directory.

```ts
import { rehearseSchemaMigration, RehearsalRefusal } from "pm-ts-starter";

try {
  const receipt = await rehearseSchemaMigration({
    source: "./old-tracker",
    workDir: process.env.REHEARSAL_DIR + "/run-1",
    plan: { version: 1, steps: [
      { kind: "rename-field", from: "legacy_ref", to: "external_ref" },
      { kind: "rename-type", from: "Experiment", to: "Investigation" },
    ] },
  });
  console.log(receipt.items, receipt.affected, receipt.source_unchanged);
} catch (error) {
  if (error instanceof RehearsalRefusal) console.error(error.code, error.remedy, error.diagnostics);
  else throw error;
}
```

Success returns only version, item/step/affected counts, resume status and source
fingerprint. Native TOON is the default; `--json` selects JSON. `affected` counts
item-operation pairs: two items changed by two operations gives four, even though
there are only two distinct items. No item values appear in receipts. Old scratch checkpoints without the byte
fingerprint require a new rehearsal directory. Diagnostics
include at most 20 tracker-relative file/field rows and a full `diagnostic_count`.
CLI refusals use native `verification_errors` entries as `file:field`; SDK refusals
carry structured diagnostic rows. The SDK validates every old and new physical item, then certifies a complete
all-status list. Field constraints follow SDK coercion and validation semantics.

| Refusal | Remedy |
| --- | --- |
| `invalid_plan` | Supply explicit `--source`, plan and scratch flags, and a readable version 1 plan using core operations. |
| `unsafe_storage` | Run from a separate caller tracker that the source neither equals nor contains; choose disjoint, regular, private directory storage outside Git and keep schema files local. |
| `invalid_data` | Repair reported fields in a separately reviewed copy and start a new rehearsal. |
| `source_changed` | Restore the original source/plan or start from a new stable snapshot. |
| `unavailable` | Check initialization, custom definitions, permissions and lock ownership, then retry. |

The wrapper atomically checkpoints observed scratch bytes immediately after each
core operation, before its synchronous observer, then advances completed-step and
affected counts. If execution stops at the observer boundary, the same core
migration ID replays without duplicating item history. A completed-step claim must
have committed SDK journal evidence and matching affected counts. Changed scratch
bytes at an observed checkpoint refuse. If termination precedes that checkpoint,
resume first replays the pending stable migration ID through the SDK, then
fingerprints the recovered state and validates the corpus, histories and committed
counts. The `observed_step` marker distinguishes a recorded post-commit fingerprint
from the pre-commit fingerprint, retaining byte-drift detection at the observer.
The pinned SDK can refuse replay with `workspace_history_state_conflict` when
termination falls between its transaction commit and workspace audit. This yields
`unavailable` with a specific remedy: preserve the interrupted scratch and use a
new scratch directory with the original source and plan. It never becomes a
permanent `invalid_data` refusal for that SDK limitation. Ordinary thrown interruptions release
the wrapper lock. Hard process termination retains the SDK's 300-second lease;
retry after it expires. Never remove a live writer's lock. Scratch is caller-owned
private storage: retain it for review or remove it explicitly after review. There
is no source promotion or apply command in this feature.

Tests cover real TOON and JSON Markdown trackers, terminal rows, invalid numeric
custom fields, immutable source bytes, changed inputs, storage refusals and a
terminated child with Git absent from PATH. The termination test advances only
the scratch runtime lease timestamp to simulate expiry; item histories remain
append-only. The optional synchronous SDK `afterStep` observer runs after the observed-byte
checkpoint and before completed counts advance. The crash matrix also terminates
real child processes before and after every SDK call, SDK transaction commit and
wrapper checkpoint write, plus mid-copy: 27 boundaries across all three migration
kinds. Each case compares final schema, item values and history operations against
an uninterrupted run, verifies immutable source bytes and history idempotency, or
executes the exact fresh-directory remedy for initialization and SDK audit gaps.
Only scratch runtime lease timestamps are advanced to simulate expiry.

## Public fleet rehearsal measurement

Measured against the public [pm-review tracker at revision 536af20d](https://github.com/unbraind/pm-review/tree/536af20dbe24b5faa5f8597046bc6d02571a6f3c/.agents/pm),
exported into a non-Git directory with read-only source files:

| Measurement | Result |
| --- | --- |
| Source items, including terminal items | 53 |
| Exported source files / bytes | 112 / 1,877,486 |
| `review_repo` → `review_repository` | 22 item mutations |
| `ReviewFinding` → `ReviewObservation` | 22 item mutations |
| Total item-operation pairs | 44 across 2 steps |
| Result and replay item counts | 53 / 53 |
| Canonical documents preserved except intended renames and update timestamps | 53 of 53, including bodies |
| Independently compared original file bytes | 112 of 112 unchanged; identical file set |
| First measured SDK rehearsal elapsed | 4,337 ms; observation, not a benchmark |

The installed CLI also succeeded with Git absent from PATH and explicit Git
discovery ceilings. Input fingerprint:
`f25019de926f51be6dd25de81335f088ca7ac2aee5ef50c6806892cb1c5495f7`.
Only aggregate counts and fingerprint are published; source item content and local
scratch coordinates are omitted.

## Input and success audit

The single SDK success return is reached only after all steps complete, the final
physical corpus and histories validate, core committed counts match the checkpoint,
scratch bytes match the last observed core commit, and the source fingerprint is
unchanged. CLI JSON and TOON render this same receipt; they have no independent
success path. Both initial and completed replay calls pass those checks. A valid
empty corpus may succeed only with valid, declared schema operations.

| Input read | Accepted boundary and refusal evidence in `test/rehearsal.test.ts` |
| --- | --- |
| SDK `source`, `workDir`, `plan`, synchronous `afterStep` | Nonempty directory names, disjoint real paths, version 1 plan, 1–32 supported steps, bounded names and optional field scope; primitive steps, unknown properties, bad locations and nonfunction observers refuse. The observer is trusted caller code and can deliberately interrupt execution. |
| Plan file and its parent directories | JSON, regular unlinked file, 64 KiB maximum; malformed, missing, large, directory and aliased plans refuse. |
| `settings.json`, including item format, inline types/schema, file mappings and SDK operational settings | SDK fallback warnings refuse; invalid item format retains the first review's regression. Unsupported schema sections/version and malformed mappings refuse. SDK validates its own remaining settings. Defaults for omitted optional settings are supported. |
| Four schema files selected by settings, or default paths | Arrays and documented wrapper representations are checked against the SDK normalizers. Missing files, syntax/shape failures, dropped definitions/properties, invalid roles, flags, types, constraints and workflow references refuse. Whitespace-prefixed escapes are tested for every section on fresh and resumed runs; padded local paths succeed. |
| Physical `.toon` and `.md` item documents | Every flat registered item is SDK-validated, including terminal rows; unregistered/nested/hidden documents, invalid fields, syntax failures and enumeration/count mismatches refuse. Nonitem files are copied and fingerprinted without interpreting their contents. |
| Existing `history/*.jsonl` streams | SDK parsing and hash-chain verification; malformed item/workspace JSONL and broken hashes refuse. Missing history is supported under SDK policy. |
| Source directory entries and all copied file names/bytes | Regular files only, no aliases, 256 MiB, 20000 entries, 64 components; special/linked storage, bounds violations and source drift refuse. Top-level extensions, runtime, locks, search, transactions and Git metadata are deliberately excluded and never used as source migration state. |
| Existing scratch tree, `rehearsal.json`, SDK schema plans and transaction journals | Whole scratch tree scanned for aliases before leasing; valid source/plan identity, safe integer counts, matching corpus/byte fingerprint and committed core evidence required. Missing/malformed/edited/partial checkpoints, fabricated completion or affected counts, invalid journal counts/status and deleted items refuse. Scratch locks retain the SDK lease policy. |
| CLI `--plan`, `--work-dir`, required `--source`; active caller tracker | Required nonempty string flags; source never defaults. Realpath equality and source containment of the active tracker refuse before plan reads, with the pm-cli#1568 remedy. Positional arguments and unsupported options, including dry-run, refuse. Native host global flags select the caller tracker and output; `--json` changes rendering only. Installed CLI tests cover host workflow scaffolding followed by omitted/same-source refusal, JSON, TOON, replay, errors and simultaneous callers; command tests cover realpath aliases and containment. |
| Process cwd, environment and host configuration | Relative paths resolve from cwd; explicit SDK roots and `noExtensions` isolate migration reads from ambient `PM_PATH`, `PM_GLOBAL_PATH`, author and home settings. A child process with conflicting environment still refuses invalid source settings. Git-absent tests prove no Git executable is needed. Host extension startup belongs to the separate caller workspace; executable source extensions and remote backends require a prior directory export. |

Each refusal test awaits a thrown `RehearsalRefusal` (or native CLI typed error and
nonzero exit), so returning `ok: true` fails the assertion. Storage/schema escape
regressions also compare original source bytes. The tracker retains behavioral
revert evidence and the unchanged npm/Bun release gate results for this review.
