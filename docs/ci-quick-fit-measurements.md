# Quick-fit measurements: pm-ts-starter

Code head: `fa7d36307fb34c30a45130689b32709d342339e1`. [CI run 43792754575](https://github.com/unbraind/pm-ts-starter/actions/runs/43792754575).
Jobs API snapshot: 2026-11-16T03:00:40+00:00. All local timing commands use `PM_TEST_DEPTH=quick`; unset/full depth is not run locally.

| Job | Result at snapshot | Created to completion | Queue | Started to completion |
| --- | --- | --- | --- | --- |
| test (26) | in_progress | unfinished | 2s | >= 1712s running |
| test (22) | in_progress | unfinished | 2s | >= 1712s running |

Step times are completed wall times from `started_at` to `completed_at`; running values are lower bounds, not completed durations.

| Step | test (26) | test (22) |
| --- | --- | --- |
| Set up job | 2s success | 2s success |
| Checkout | 1s success | 2s success |
| Detect code changes | 1s success | 0s success |
| Setup Node.js | 6s success | 3s success |
| Setup Bun | 2s success | 2s success |
| Install dependencies | 4s success | 6s success |
| Install project pm-github extension | 1s success | 2s success |
| Verify tracked pm project health | 1s success | skipped |
| Check documentation and tracker changes | skipped | skipped |
| Build and verify committed output is current | 1s success | 0s success |
| Engines floor tests | skipped | >= 1694s running |
| Quick npm release gate | >= 1692s running | pending |
| Bunx smoke | pending | pending |
| Verify Bun can install the package graph | pending | pending |
| Post Setup Bun | pending | pending |
| Post Setup Node.js | pending | pending |
| Post Checkout | pending | pending |

## Local focused evidence

The prior quick fixtures were frozen before editing, including their old depth helper. Baseline and revised processes overlapped on a heavily loaded shared host. These are uncontrolled relative measurements; they do not prove a hosted runtime target. A failed watchdog is not a passing baseline. Parent and nested rows may overlap and must not be added.

| Test | Prior quick seconds / result | Revised quick seconds / result |
| --- | --- | --- |
| API compiler failures and malformed private results produce typed refusals | 138.941 pass | not measured / not reached / deep-only |
| API entry linked outside the installed compiler package is refused before it loads | 3.053 pass | not measured / not reached / deep-only |
| Program resolution capability fallbacks retain compiler usage modes | 20.367 pass | not measured / not reached / deep-only |
| diagnostic output is bounded and never echoes source text or machine paths | 44.243 pass | 50.669 pass |
| generated inline examples use Node libraries while supplied DOM config remains intact | 122.429 pass | not measured / not reached / deep-only |
| program checks single-copy typesVersions resolutions against native diagnostics | not measured / not reached / deep-only | 173.676 pass |
| program graph and module-mode properties TypeScript 6.0.3 | not measured / not reached / deep-only | 259.802 pass |
| program keeps symlinked config origins for relative extends and files | not measured / not reached / deep-only | 22.283 pass |
| program review retains require usage in an mts consumer | not measured / not reached / deep-only | 37.512 pass |
| program source aliases use canonical diagnostic filenames without changing module kind | not measured / not reached / deep-only | 67.146 pass |
| real SDK examples pass; removing a real public export fails only its current fixture | 329.705 pass | 361.237 pass |
| resolution self-test rejects every SDK import mutation at both published bounds | 1091.890 pass | 1106.602 pass |
| structured compiler API layouts TypeScript 5.9.3 | 619.532 pass | 911.091 pass |
| structured compiler API layouts TypeScript 6.0.3 | 923.682 pass | not measured / not reached / deep-only |
| test/.before-sdk-contracts.test.ts | 1891.190 cancelled at cutoff | not measured / not reached / deep-only |
| test/.before-sdk-path-transport.test.ts | 633.125 cancelled at cutoff | not measured / not reached / deep-only |
| test/sdk-contracts.test.ts | not measured / not reached / deep-only | 1947.968 cancelled at cutoff |

Both repositories pass `npm run typecheck`, `npm run build:test`, `npm run lint`, strict workflow YAML parsing and `PM_TEST_DEPTH=quick node --test test/depth.test.ts` (4 tests each). The helper command also passes through `pm test --run --only-last --progress`. Coverage percentages, source scope, product deadlines and CI job ceilings are unchanged. No full-depth certification is claimed.

`npm run build` passes with no committed-output drift. The revised 5.9.3 structured API family passes all 25 generated layouts. The bounded touched-file run ended with 20 passes, zero assertion failures and one cancelled SDK-contracts file (1949.60s wall). The 9-case TypeScript 6.0.3 graph matrix also passes (259.802s). The SDK-contracts file did not complete; the broad run is not passing.

Prior hosted quick bottlenecks: discovery corpus 315.120s; hostile differential 205.967s; compiler matrix 158.912s; post-compile isolation 103.822s; malformed API results 101.273s; supplementary output 78.465s; packed consumers 53.155s. Unchanged next candidates include post-compile isolation, malformed API results, import mutation self-test (50.837s), local declaration SDK-bound pairs (51.122s), location tripwires (47.373s) and registered-command integration (43.279s). Exact final-run ranking requires completed job logs.

Exact revised touched-file command:

```sh
PM_TEST_DEPTH=quick node --test --test-reporter=spec --test-concurrency=2 test/depth.test.ts test/sdk-contracts.test.ts test/sdk-api.test.ts test/sdk-program-graph.test.ts
```

The complete unselected combinations remain in ci-deep. The 15-minute target and unchanged coverage gates require completed hosted quick checks; unfinished or cancelled checks are missing evidence.
