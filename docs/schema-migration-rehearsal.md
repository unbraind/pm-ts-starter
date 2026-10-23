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

With this extension installed in a separate caller workspace:

```sh
pm ts-starter rehearse-schema --source ./old-tracker \
  --plan ./migration.json --work-dir "$REHEARSAL_DIR/run-1" --json
```

`REHEARSAL_DIR` must identify private scratch storage outside any Git repository.
The command creates `run-1`, containing `tracker/`, `rehearsal.json`, and SDK runtime
journals. Repeat the identical command to resume. Omitting `--source` uses the
active tracker; a separate caller workspace keeps even host startup outside the
read-only source. The harness itself only reads the source. Source and scratch
must be disjoint real directories, with no symlinks, hardlinked or special files.
Existing scratch contents, including lock directories, are scanned before acquiring
a lease, so a lock alias cannot redirect writes into the source.
Schema paths must stay inside the tracker. Snapshots are capped at 256 MiB and
20000 files. Extensions, locks, search artifacts, runtime caches and transaction
journals are excluded from the input snapshot.

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
there are only two distinct items. No item values appear in receipts. Diagnostics
include at most 20 tracker-relative file/field rows and a full `diagnostic_count`.
CLI refusals use native `verification_errors` entries as `file:field`; SDK refusals
carry structured diagnostic rows. The SDK validates every old and new physical item, then certifies a complete
all-status list. Field constraints follow SDK coercion and validation semantics.

| Refusal | Remedy |
| --- | --- |
| `invalid_plan` | Supply a readable version 1 JSON plan using core operations. |
| `unsafe_storage` | Choose disjoint, regular, private directory storage outside Git; keep schema files local. |
| `invalid_data` | Repair reported fields in a separately reviewed copy and start a new rehearsal. |
| `source_changed` | Restore the original source/plan or start from a new stable snapshot. |
| `unavailable` | Check initialization, custom definitions, permissions and lock ownership, then retry. |

A checkpoint is published atomically after each core operation. If execution stops
between a core commit and its wrapper checkpoint, the same core migration ID
replays without duplicating item history. Ordinary thrown interruptions release
the wrapper lock. Hard process termination retains the SDK's 300-second lease;
retry after it expires. Never remove a live writer's lock. Scratch is caller-owned
private storage: retain it for review or remove it explicitly after review. There
is no source promotion or apply command in this feature.

Tests cover real TOON and JSON Markdown trackers, terminal rows, invalid numeric
custom fields, immutable source bytes, changed inputs, storage refusals and a
terminated child with Git absent from PATH. The termination test advances only
the scratch runtime lease timestamp to simulate expiry; item histories remain
append-only. The optional synchronous SDK `afterStep` observer exposes the commit /
checkpoint boundary for controlled interruption tests.

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
