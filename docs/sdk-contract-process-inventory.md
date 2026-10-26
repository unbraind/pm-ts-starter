# Subprocess and output boundary inventory

Round 10 inventory of package-owned TypeScript source, including runner/wrapper
source strings and test fixtures. Generated `dist` repeats the shipped source;
installed dependencies are described at their invoking boundary. Line numbers
identify the current review snapshot. Source locations are grouped below so every
spawn and every stream read is enumerated, including developer tooling.

## Checker runtime

| Boundary | Configuration and environment | Output interpretation |
| --- | --- | --- |
| `sdk-contracts.ts`: compiler help, config, file discovery and emission | Same explicit sandbox environment, no Node/TS injection or child coverage. Argument arrays use the original compiler entry and unchanged project config. Output/cache policies guard emission before the CLI runs. | Help is checked against the complete option policy; showConfig is JSON. Resolved file paths are canonicalized and checked after compilation. The same-package API supplies ambiguous newline/ANSI filenames, with CLI file-list corroboration. Emission uses status only; human diagnostics never populate results. |
| `sdk-contracts.ts`: structured API runner | Absolute import of the byte-copied TypeScript package in the copy, unchanged parsed config, same environment and resource limits. Classic emit diagnostics use a discard write callback; the unchanged CLI owns actual emission. | stdout is one validated JSON object: file list and code/category/file/position records. Trace and other presentation use stderr and are discarded. Only error-category records enter rows; API/CLI status disagreement refuses. |
| TypeScript dependency: CLI native binary and API RPC child | Compiler package, libraries and native companions are copied byte for byte under their existing names. Descendants inherit the explicit sandbox environment. | CLI human text has no diagnostic authority; the API RPC uses its own binary protocol and runner JSON. |

The checker has no install, reinstall, npm-ci or package-manager link path.
`copyConsumer` copies the complete installed tree and rebases internal links;
`materializeDependencies` only copies selected inline toolchain entries and missing
canonical compiler companions. Bound setup removes the copied SDK entry and copies
the selected SDK bytes into that entry. No lifecycle or registry command executes.
The installed directory name is independent of package.json's name field.

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
| `scripts/verify-release-changelog-date.ts` | none | 361,362 |
| `scripts/verify-release-publish-attestation.ts` | none | 52 |
| `sdk-contracts.ts` | 231,338 | 235,236,271,309,310,328,351,431 |
| `test/backend.test.ts` | 60 | 75,98,139,141,265,270,271,275,279,292 |
| `test/dependency-property-worker.ts` | 55 | 57,62 |
| `test/docstring-gate.test.ts` | none | 29,30,31,42,43,47,65,90,91,94,103,118,119,122,131 |
| `test/prepare-merge-driver.test.ts` | 42,71,76,147 | 81,82,94,102,103,110,118,119,124,130,138,139,152,153 |
| `test/rehearsal.test.ts` | 44,256,262,304,400,412,414,421,434,440,444,463,769 | 46,47,257,263,264,305,401,413,415,422,435,441,445,450,451,464,465,470,772,773 |
| `test/sdk-compiler-policy.test.ts` | 9 | 12,14,15,30,31,32,41,53,56 |
| `test/sdk-contracts.test.ts` | 41,206,258,266,288,289,302,305,315,337,340,370,374,379,518,644,665,676,695,723,770,806,822,876,917,945,958,977,1114,1118,1171,1181,1213,1355,1356,1427,1477,1480,1498,1515,1521 | 42,176,211,259,260,269,288,290,291,303,309,310,311,318,319,339,344,345,378,519,645,663,679,696,700,773,801,802,804,821,876,918,919,946,957,977,985,986,996,1000,1001,1115,1119,1120,1171,1182,1215,1357,1478,1479,1492,1499,1516,1523,1524,1546,1547,1553,1554,1555 |
| `test/smoke.test.ts` | none | 675,677,756,926 |
| `test/verify-release-changelog-date.test.ts` | none | 246,247,249,250,260,261 |
| `test/verify-release-publish-attestation.test.ts` | none | 192,209,210,213,217,246 |
