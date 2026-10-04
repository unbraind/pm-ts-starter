# PM CLI/SDK 2026.10.4 certification

Tracker: [pm-ts-starter-n4ee](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/chores/pm-ts-starter-n4ee.toon).

Exact development pins: CLI/SDK, pm-ops and pm-changelog 2026.10.4;
Babel ESLint parser 8.0.6; TypeScript syntax plugin 8.0.3; @types/node 26.6.4;
ESLint 10.12.0; fast-glob 3.3.3; jscpd 5.4.0; TypeScript 7.0.2. The runtime
host floor stays 2026.8.7. The parser's npm `latest` tag points to an older major;
8.0.6 is the newer published release within the existing Babel 8 line.

Dependabot #113's exact CodeQL init/analyze pin is
`2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2` (`# v4`). Updates from #116 (CLI),
#117 (jscpd) and #118 (Node types) are included or superseded by newer pins.
The merge-driver launcher is byte-identical to the installed pm-ops template.
A malformed lookup-path regression checks that the original resolution failure
is preserved instead of being replaced by ENOTDIR or treated as omit-dev.

jscpd 5 detected three existing clone pairs at the unchanged 0% threshold.
Sharing the entry guard and test fixtures removed them while preserving behavior
and assertions. The shared guard is also added to the strict coverage inventory.
The docstring consumer now checks undocumented TypeScript and TSX declarations;
the README reflects the pinned analyzer's support for both.

`flock /tmp/claude-1000/heavy-gate.lock npm run release:check` initially passed
185/185 tests with zero skips, 100% measured lines/branches/functions across
five configured sources, and 0% duplication across 19 authored sources. Statement
coverage is not independently reported. The final run passed 186/186 tests including the TSX consumer regression,
with zero skips and the same complete configured 100% coverage. It ran through
`npx pm test pm-ts-starter-n4ee --run --only-index 3 --progress --pm-context
tracker --override-linked-pm-context`. `npx pm health
--strict-exit --require-merge-drivers`, `npm audit --omit=dev`, and CI's
`flock /tmp/claude-1000/heavy-gate.lock bun install --no-save` passed. Committed
dist output remains identical to the fresh build.

pm-github 2026.10.4 was installed as a managed extension, with CI restoring the
same exact package before strict health. `npx pm github import
unbraind/pm-ts-starter --state all --atomic --dry-run` proposed 0 imports / 1
tracker update / 0 skips. No GitHub or tracker sync writes occurred.

Real-data dogfood copied this repository's `.agents/pm` into disposable
`pm-ts-starter-dogfood/.agents/pm`, packed with `npm pack --pack-destination
<scratch>/pack`, installed with `npm install --ignore-scripts
@unbrained/pm-cli@2026.10.4 <tarball>` and `npx -y @unbrained/pm-cli@2026.10.4
package install <tarball> --project`. Both `npx -y
@unbrained/pm-cli@2026.10.4` and `bunx --bun @unbrained/pm-cli@2026.10.4` ran:

```sh
--version
--json hello --name Fleet --loud
--json ts-starter info
--json list --all --output-budget unbounded --output-limit unbounded
--json ts-starter context-demo --format json --depth brief
--json ts-starter search-demo certify --limit 5
```

Each host reported 2026.10.4, greeted `HELLO, FLEET!`, exposed 9 capabilities,
reported its peer floor as sdk_target 2026.8.7, read all 75 real items, returned
brief context and 5 search results. All commands exited 0. Scratch was deleted.

Full development audit remains **blocked**: 4 high findings rooted in
`braces@3.0.3` through fast-glob/micromatch and pm-ops. npm lists 3.0.3 as the
maximum braces release and [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
lists no patched version. fast-glob is required by the canonical duplication
analyzer; its removal would break that gate. The suggested audit fix downgrades
required pm-ops to 2026.9.13 and was refused. No open Dependabot security alerts
were present. [pm-ts-starter-audit104](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/issues/pm-ts-starter-audit104.toon)
tracks the required canonical dependency replacement or upstream patch. A green
configured release gate does not make the full development audit clean.
