# Fleet CI v2

Required checks remain `test (22)` and `test (26)`. PRs and dispatch use hosted
Ubuntu runners, quick depth and a 30-minute job ceiling. Superseded PR runs
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
| Generated npm/Bun projects run their own release gate | via tests | via tests | — | npm + Bun |
| Packed npm/Bun SDK-bound and CLI acceptance | via tests | via tests | — | npm + Bun |
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
per-ref cancellation. Hosted Ubuntu is the default; `PM_LOCAL_DEEP=on`
explicitly selects the local `pm-local` pool. Only the fleet controller changes that variable. Local
runners use their persistent npm cache and preinstalled Bun; hosted fallback
uses setup-node caching and setup-bun. Every deep job logs `bun --version`.

`PM_TEST_DEPTH` defaults to full. Quick uses an identical deterministic prefix,
one tenth rounded up with at least 25 cases (capped at the original size).
The 200-graph property uses the first 25 graphs in quick, retaining original
shard/seed ordering; full uses all four 50-graph shards. Generated API
layouts use 25/32, compiler-matrix cases 25/72, path names 25/32, module-mode combinations 25/81 and discovery
configs 25/49. Smaller explicit regressions remain complete. Every full case
and assertion still runs in deep. Fixed product boundary fixtures, including
the oversized-directory refusal, are unchanged. Coverage thresholds and source
scope are unchanged; the reporter measures lines, branches and functions,
not independent statement coverage.

Harness subprocess deadlines use `PM_TEST_TIME_SCALE` (default 1, deep 3),
rounded with `Math.ceil` for spawnSync. This does not change SDK/product deadlines
or their assertions. Case counts bound property work; job ceilings bound total
runner occupancy. Issue #204's underlying Bun handle leak is not claimed fixed:
PRs no longer repeat its full gate and all jobs have ceilings, while deep retains
the original independent fresh npm/Bun graphs for diagnosis.

Packed acceptance proves Bun project installs and execution, but does not prove
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
