# Subprocess and output boundary inventory

Round 9 inventory of package-owned TypeScript source, including runner/wrapper
source strings and test fixtures. Generated `dist` repeats the shipped source;
installed dependencies are described at their invoking boundary. Line numbers
identify the current review snapshot. Source locations are grouped below so every
spawn and every stream read is enumerated, including developer tooling.

## Checker runtime

| Boundary | Configuration and environment | Output interpretation |
| --- | --- | --- |
| `sdk-contracts.ts`: npm dependency installation | Explicit sandbox HOME, USERPROFILE, XDG/cache/temp directories; all npm configuration environment keys removed case-insensitively. Registry/auth/TLS-only project npmrc. Highest-precedence CLI prefix, global=false, location=project, private user/global config, cache, workspace=false, installation/link/bin/shell/script settings. Tool selection comes from the caller's installed npm toolchain. | Only completion status is consumed; both text streams are discarded. No installer text becomes a diagnostic. |
| `sdk-contracts.ts`: compiler help, config, file discovery and emission | Same explicit sandbox environment, no Node/TS injection or child coverage. Argument arrays use the original compiler entry and unchanged project config. Output/cache policies guard emission before the CLI runs. | Help is checked against the complete option policy; showConfig is JSON. Resolved file paths are canonicalized and checked after compilation. The same-package API supplies ambiguous newline/ANSI filenames, with CLI file-list corroboration. Emission uses status only; human diagnostics never populate results. |
| `sdk-contracts.ts`: structured API runner | Absolute import of the byte-verified TypeScript package in the copy, unchanged parsed config, same environment and resource limits. Classic emit diagnostics use a discard write callback; the unchanged CLI owns actual emission. | stdout is one validated JSON object: file list and code/category/file/position records. Trace and other presentation use stderr and are discarded. Only error-category records enter rows; API/CLI status disagreement refuses. |
| TypeScript dependency: CLI native binary and API RPC child | Package-owned native binary is installed as a local artifact and byte-verified; descendants inherit the explicit sandbox environment. Optional platform discovery is omitted from the disposable artifact only when native companions were explicitly supplied, and original package metadata is restored before compilation. | CLI human text has no diagnostic authority; the API RPC uses its own binary protocol and runner JSON. |

## Other shipped runtime and repository tooling

These are existing caller/workspace operations. They do not receive consumer
configuration and cannot populate the SDK contract matrix. Their caller-owned
workspace environments are intentional; the checker confinement claim applies to
the checker children enumerated above.

| Boundary | Configuration and environment | Output interpretation |
| --- | --- | --- |
| `index.ts`: `runPm` | Caller-selected tracker and argument arrays invoke the host pm CLI; no consumer npmrc or SDK compiler config is involved. | Status plus captured streams feed existing demos; JSON demos parse JSON, context demos return text. These streams are never read by the contract checker. |
| `scripts/coverage-gate.ts`: compiler inspection | Trusted workspace or test-injected compiler command, fixed showConfig flags. | JSON emit paths only; failure refuses the coverage check, never SDK diagnostics. |
| `scripts/coverage-gate.ts`: test runner | Trusted workspace/test runner, controlled Node test flags, clean test-context environment and UTC. | Status and a freshly generated LCOV file determine coverage; inherited streams report tests. Consumer text cannot set compiler result codes. |
| `scripts/prepare-merge-driver.ts`: installer | Fixed Node runtime plus the resolved repository-pinned pm-ops installer; intended workspace Git configuration changes. | Inherited streams, completion status only. |
| `scripts/verify-release-changelog-date.ts`: generator and Git enumeration | Trusted repository generator selection and argument arrays; fixed Git ls-files selectors. | A generated Markdown heading and enumerated tracked filenames are read as release evidence; neither stream has SDK diagnostic authority. |
| `package.json`: production audit launcher | Trusted npm selection, ignore-scripts, explicit null userconfig and filtered allow-scripts setting. Intended repository audit rather than consumer compilation. | Streams inherited, status only. |
| `package.json` scripts and CI workflow shell commands | Repository-owned npm/Bun/build/lint/changelog/test commands operate on the checked-out package; no consumer project configuration is used as command text. | Gate statuses, build drift and assertion receipts; SDK matrix codes still come exclusively from the API runner. |

## Test-only subprocesses

Each site below executes a fixed test-owned runtime, installer, compiler wrapper,
Git command or registry fixture. Arguments are arrays, or a literal fixture script;
interpolated paths/data are JSON-encoded. Fixture environments are restored in
`finally` blocks. Independent plain-tsc oracles deliberately retain human output
for comparison on the non-forged corpus only; the forged corpus instead has a
generator-known oracle. Fixture stdout/stderr is parsed as JSON, read as readiness
or independently asserted, never passed to the production diagnostic decoder.
The authenticated registry readiness value comes from the test-owned server;
requests must carry the synthetic fixture token. Test instrumentation may write
its explicit receipt outside the copied bound; tripwire directories are independent
of these authorized receipts.

## Exhaustive source locations

Every row lists all call sites in that file. The boundary rationale above applies
to each listed location. Textual occurrences inside compiler and server fixture
strings are included because those calls execute in child processes too.

| File | Subprocess spawn locations | stdout/stderr read or forwarding locations |
| --- | --- | --- |
| `index.ts` | 365 | 369,373,397,403,408,412,633,636,739 |
| `scripts/coverage-gate.ts` | 167,357 | 172,178,182 |
| `scripts/docstring-gate.ts` | none | 108,109 |
| `scripts/prepare-merge-driver.ts` | 39 | none |
| `scripts/verify-release-changelog-date.ts` | 305,321 | 361,362 |
| `scripts/verify-release-publish-attestation.ts` | none | 52 |
| `sdk-contracts.ts` | 228,278,385 | 282,283,318,356,357,375,398,476 |
| `test/backend.test.ts` | 60 | 75,98,139,141,265,270,271,275,279,292 |
| `test/docstring-gate.test.ts` | none | 29,30,31,42,43,47,65,90,91,94,103,118,119,122,131 |
| `test/identity-audit.test.ts` | 17 | none |
| `test/prepare-merge-driver.test.ts` | 42,71,76,147 | 81,82,94,102,103,110,118,119,124,130,138,139,152,153 |
| `test/rehearsal.test.ts` | 44,256,262,304,400,412,414,421,434,440,444,463,769 | 46,47,257,263,264,305,401,413,415,422,435,441,445,450,451,464,465,470,772,773 |
| `test/release-workflow.test.ts` | 27,88,112,116,119,122 | none |
| `test/sdk-compiler-policy.test.ts` | 9 | 12,14,15,30,31,32,41,53,56 |
| `test/sdk-contracts.test.ts` | 39,214,266,274,296,297,310,313,323,345,348,378,382,387,526,652,673,684,703,731,778,814,830,884,925,953,966,985,1122,1126,1179,1189,1221,1365,1366,1442,1492,1495,1524,1530 | 40,184,219,267,268,277,296,298,299,311,317,318,319,326,327,347,352,353,386,527,653,671,687,704,708,781,809,810,812,829,884,926,927,954,965,985,993,994,1004,1008,1009,1123,1127,1128,1179,1190,1223,1367,1493,1494,1507,1525,1532,1533,1555,1556,1562,1563,1564 |
| `test/smoke.test.ts` | 658,659,846 | 675,677,756 |
| `test/verify-release-changelog-date.test.ts` | none | 246,247,249,250,260,261 |
| `test/verify-release-publish-attestation.test.ts` | 162,163 | 209,210,213,217,246 |
