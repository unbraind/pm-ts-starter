# Fleet CI v2

Required checks remain `test (22)` and `test (26)`. PRs and dispatch use hosted
Ubuntu runners, quick depth and an enforced 22-minute job ceiling (`quick-shard`,
`coverage-shard` and `release-gate` stop at 22 minutes, matching the per-shard
limit below). Superseded PR runs
cancel. CodeQL is not required. Docs/tracker-only PRs still run the identity
and absolute-home-path history audits, README package-link, SDK compiler documentation
and compatibility-floor checks; they cannot bypass privacy checks.
Executable tracker JavaScript/TypeScript selects the code tier and remains eligible for CodeQL.

| Check | Code PR Node 22 | Code PR Node 26 | Docs/tracker PR, both | Deep Node 22 + 26 |
| --- | --- | --- | --- | --- |
| npm ci, merge-driver preparation | yes | yes | yes | yes |
| Pinned pm-github tracker extension | yes | yes | yes | yes |
| Strict tracker health / merge drivers | — | yes | yes | yes |
| Build and committed dist consistency | yes | yes | — | yes |
| Typecheck, lint, duplicate and docstring gates | — | yes | — | npm + Bun |
| Build/test compilation and behavioral tests | quick | quick via coverage | — | full, npm + Bun |
| Coverage, unchanged 100% lines/branches/functions | — | yes | — | npm + Bun |
| Tracker competition at all six observer phases | one peer compiler matrix | same via coverage | — | peer matrix at every phase |
| Generated npm/Bun projects run their own release gate | via tests | via tests | — | npm + Bun |
| Packed SDK-bound and CLI acceptance | one npm/current packed SDK path | same via coverage | — | all four npm/Bun × minimum/current graphs and SDK/CLI representations |
| Identity and absolute-home-path history audits | via tests | via tests | yes | npm + Bun |
| Production audit and pack dry-run | — | yes | — | npm + Bun |
| README package links, SDK compiler docs and compatibility floor | via tests | via tests | yes | npm + Bun |
| Changelog consistency | — | yes | yes | npm + Bun |
| Publish attestation and changelog-date verifiers | — | yes | — | npm + Bun |
| Bun graph install and bunx compiler smoke | — | yes | — | graph install; bunx in PR |
| CodeQL, separate workflow | matching paths | matching paths | filtered | main matching paths; weekly |

Deep runs on main pushes, dispatch and daily at 02:17 UTC, distinct from release
at 03:23 UTC and its hourly minute-41 recovery, and weekly CodeQL at Monday
06:09 UTC. Four checks are `deep (22, npm)`, `deep (22, bun)`, `deep (26, npm)` and
`deep (26, bun)`, each with a 120-minute ceiling and
per-ref cancellation. The local `pm-local` pool is the default;
`PM_LOCAL_DEEP=off` explicitly selects hosted Ubuntu. Only the fleet controller changes that variable. Local
runners use their persistent npm cache and preinstalled Bun; hosted fallback
uses setup-node caching and setup-bun. Every deep job logs `bun --version`.

`PM_TEST_DEPTH` defaults to full. Quick uses an identical deterministic prefix,
one tenth rounded up with at least 25 cases (capped at the original size).
The 200-graph property uses the first 25 graphs in quick, retaining original
shard/seed ordering; full uses all four 50-graph shards. Generated API layouts
retain 25/32 seeds. Finite enumerations use explicit representative budgets:

| Finite contract | Quick | Deep / unset |
| --- | --- | --- |
| Differential compiler matrix | 9 diagonal cases spanning both runtimes, all 3 layouts/resolvers, ESM/CJS and clean/drift controls; both SDK bounds per case | all 72 cases |
| Hostile specifiers | all 16 specifier kinds, alternating consumer/declaration locations; both bounds | all 32 location/specifier pairs |
| Supplementary compiler output | each of 6 flags with a clean verdict; other diagnostic regressions remain | all 12 clean/error combinations |
| Discovery corpus | 18 named discovery/input/output kinds, including late diagnostic and noLib fixtures; dedicated output/cache/declaration regressions remain | all 49 configurations |
| Structured API compiler versions | 5.9.3 | 5.9.3 and 6.0.3 |
| Program graph compiler versions | 6.0.3, 9 cases covering every file/export/syntax kind | both versions, all 81 combinations each |
| Packed SDK and real-host CLI | one npm/current SDK execution | all npm/Bun × minimum/current × SDK/CLI/JSON/TOON/refusal/no-git paths |

Path transport retains its 25/32 generated names and fixed per-version names.
Every full case and assertion still runs in deep. Fixed product boundary fixtures,
including oversized-directory refusal and malformed API results, remain complete.
Coverage thresholds and source scope are unchanged; the reporter measures lines,
branches and functions, not independent statement coverage.

Harness subprocess deadlines use `PM_TEST_TIME_SCALE` (default 1, deep 3),
rounded with `Math.ceil` for spawnSync. This does not change SDK/product deadlines
or their assertions. Case counts bound property work; job ceilings bound total
runner occupancy. Issue #204's underlying Bun handle leak is not claimed fixed:
PRs no longer repeat its full gate and all jobs have ceilings, while deep retains
the original independent fresh npm/Bun graphs for diagnosis.

Deep packed acceptance proves Bun project installs and execution, but does not prove
bunx/global installation. PR Node 26 therefore also runs `bunx --no-install tsc
--version` and `bun install --no-save`; the smoke proves local bin resolution,
not an ephemeral public-registry package installation.

The backend generator ships adapted CI v2 workflows and this same depth helper.
Generated projects have no tracker/changelog or committed-dist policy: their
release gate runs typecheck, build, tests, production audit and pack dry-run.
Their first CI install creates a lockfile before npm ci; owners should commit
that lockfile. Existing acceptance still installs independent npm/Bun graphs,
executes each generated package's gate, and checks CLI/SDK behavior without Git.

## Measurements and validation limits

Owner fleet measurement: 39,929 runner-minutes in 24 hours, PR medians 45–90
minutes and approximately 28 minutes queueing. These describe the fleet, not a
controlled package benchmark.

Latest successful main CI [43691008662](https://github.com/unbraind/pm-ts-starter/actions/runs/43691008662):
Node 22 npm/Bun gates 59m04s/58m43s; Node 26 75m10s/76m10s.
The jobs API and individual job log were used because `gh run view --log`
returned no content. Slowest Node 26 tests: dependency property 693.34s,
discovery differential 636.63s, compiler matrix 505.66s, packed acceptance
269.96s. Quick timings and exact-head PR status are recorded in the linked
tracker item and PR body. Full depth is deliberately not run on the overloaded
local host. Deep success and the 120-minute capacity margin remain unverified. Splitting
runtime into separate matrix jobs avoids stacking the two previously measured
75-minute gates inside a single 120-minute job.

## Review round E

PRRT_kwDOSZpwFM63udS7 is valid: generated deep Bun legs never called test:bun. Add that explicit behavioral gate and ordering regression. Both failing checks actually reached the 30-minute job limit enforced at that time (the historical ceiling before the current 22-minute quick limit); the logs stop before the overlapping caller-boundary test finishes. Retain all six competition phases using a small actual compiled SDK fixture rather than repeated copies of the full published SDK dependency graph. The targeted competition test passed; CI routing, deep workflow, typecheck, lint and strict YAML checks passed.

The cheap tier excludes only inert tracker record formats; executable tracker changes keep product gates. `test/ci-routing.test.ts` executes each detector with inert and executable tracker paths. Product deadlines, full-depth cases and coverage thresholds are unchanged.

Round F timing evidence: at revision 90ed1c0, dependency setup completed in
under 20 seconds per job. Node 26 spent 29m56s in the release gate, including
coverage from 22:57:27 UTC until cancellation at 23:27:20 UTC. Node 22 spent
29m59s in engines-floor tests. The last completed SDK test appeared at
23:05:24 / 23:08:48 UTC, before overlapping-caller checks.

Quick now retains all six real tracker competitions with one peer compiler
matrix over a minimal ES5 consumer; deep repeats that matrix at every phase.
Quick packed acceptance keeps every SDK/CLI representation on the npm/current
graph; deep certifies the full npm/Bun × minimum/current cross product. Other
Bun project install and runtime smokes remain. Simple dependency fixtures use
explicit ES5 libraries; public SDK and Node/DOM library contract tests keep
their original configurations. Coverage thresholds and required sources stay
unchanged. The 25 program-graph samples span mts, cts and ts and all nine syntax
forms; deep retains all 81 combinations per compiler. Seeded properties still
keep at least 25 generated cases. New hosted job durations require CI evidence.

## Round G file shards and coverage union

Required `test (22)` and `test (26)` checks are always-run aggregates. The former
requires every Node 22 quick shard; the latter requires the parallel non-coverage
release gates and the coverage merge, which depends on every Node 26 shard.
Failures, cancellations and skipped prerequisites fail the code aggregate.
Docs/tracker changes still run their original health, privacy and changelog
checks, with no suite build unless a documentation-input gate requires it.

There are 5 shards per Node line. Shards use the complete sorted test-file
inventory at quick depth, with concurrency one and a 22-minute hard limit.
The target remains at most 15 minutes per job (12 minutes for Node 22).
The SDK contract suite is split across five files; all 42 test names and their
assertions remain. The measured 1,381-second file is divided into roughly
235–350-second files. Prior file-time simulation projects a maximum of about
460 seconds per shard plus setup; unmeasured tail files remain an estimate.

Each coverage artifact contains repository-relative per-file line, branch and
function hits plus original V8 offset ranges. Merge uses the same runtime merger
as the original gate, before calculating percentages. Merging percentages or
line-only branch keys is invalid: dynamically emitted branch ranges may differ
between shards. A real two-file fixture covers a branch and a function exclusively
in each shard and compares the merged totals and hits with an unsharded run.
Missing/duplicate shards and differing Node versions fail closed. Thresholds,
source scope, `npm run coverage`, `npm run release:check` and ci-deep stay unchanged.

The starter merge invokes Node's internal coverage merger in a subprocess with
`--expose-internals`. This is a version-sensitive runtime API; matching Node
versions and the fixture detect drift. The source-presence check runs on the union.

The non-coverage job runs every other original release command, plus the existing
Bun/bunx smoke. Setup, download/merge and required aggregates have their own
bounded jobs. Actual hosted wall times and merged coverage belong in the tracker
and PR body; a projection is not a completed timing or coverage certificate.

Direct shard commands publish the package's `node_modules/.bin` through
`GITHUB_PATH` after installation, preserving the npm script environment.
PM CLI integration tests must run rather than skip because `pm` is unavailable.
The workflow contract checks this setup in both shard matrices.
