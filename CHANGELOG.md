# Changelog

## Unreleased

### Fixed

- changelog scripts read the pm workspace with default budgets instead of canonical complete reads ([pm-ts-starter-gw39](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/issues/pm-ts-starter-gw39.toon))

## 2026.8.17 - 2026-08-17

### Fixed

- The pm CLI compatibility floor was declared only in peerDependencies, which only npm enforces, and not in manifest.json pm_min_version, which is the field the CLI enforces ([pm-ts-starter-qdwo](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/issues/pm-ts-starter-qdwo.toon))

## 2026.8.10 - 2026-08-10

### Other

- Adopt the mandatory docstring gate ([pm-ts-starter-ejsd](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/tasks/pm-ts-starter-ejsd.toon))

## 2026.8.8 - 2026-08-08

### Other

- Adopt pm CLI and SDK 2026.8.7 with extension-asset merge safety ([pm-ts-starter-sirq](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/chores/pm-ts-starter-sirq.toon))

## 2026.8.7 - 2026-08-07

### Fixed

- Reconcile PR with same-day release before changelog CI ([pm-ts-starter-cpm7](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/issues/pm-ts-starter-cpm7.toon))
- Gate durable PM project health in CI on pm CLI 2026.8.6 ([pm-ts-starter-gddt](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/issues/pm-ts-starter-gddt.toon))
- Fix review findings: POSIX-only gate tests, orphaned docstring, stale tsc references ([pm-ts-starter-f7z6](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/tasks/pm-ts-starter-f7z6.toon))

### Other

- Make exact coverage-path tests deterministic and cross-platform ([pm-ts-starter-q6xq](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/tasks/pm-ts-starter-q6xq.toon))
- Raise the coverage gate to a measured 100/100/100 and bring scripts/coverage-gate.ts under it ([pm-ts-starter-kksc](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/tasks/pm-ts-starter-kksc.toon))

## 2026.8.6 - 2026-08-06

### Fixed

- Scope the json renderer to the commands this extension owns so it stops colliding with sibling extensions ([pm-ts-starter-tezw](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/issues/pm-ts-starter-tezw.toon))

## 2026.8.5 - 2026-08-05

### Deprecated

- Migrate the output_format service override from the deprecated payload-echo protocol to declineServiceOverride ([pm-ts-starter-75o3](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/chores/pm-ts-starter-75o3.toon))

## 2026.8.4 - 2026-08-04

### Other

- Resolve pm-changelog to the release that derives release dates in UTC ([pm-ts-starter-px9p](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/chores/pm-ts-starter-px9p.toon))

## 2026.7.31 - 2026-07-31

### Fixed

- Release commits discard the rebuilt dist, so the git-install path serves the previous version ([pm-ts-starter-brsy](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/issues/pm-ts-starter-brsy.toon))

## 2026.7.29 - 2026-07-29

### Added

- Enforce a real coverage gate by running tests against TypeScript sources ([pm-ts-starter-ho5h](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/features/pm-ts-starter-ho5h.toon))

### Other

- Adopt pm-cli 2026.7.29 ([pm-ts-starter-hxet](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/chores/pm-ts-starter-hxet.toon))

## 2026.7.28-1 - 2026-07-28

### Fixed

- Stop the output_format demo override from claiming and reprinting the host envelope ([pm-ts-starter-84ai](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/issues/pm-ts-starter-84ai.toon))

## 2026.7.28 - 2026-07-28

### Other

- Adopt pm-cli 2026.7.28 ([pm-ts-starter-p0xi](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/chores/pm-ts-starter-p0xi.toon))
- Adopt pm-cli 2026.7.27 ([pm-ts-starter-b2f4](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/chores/pm-ts-starter-b2f4.toon))

## 2026.7.27 - 2026-07-27

### Added

- Demonstrate the full sdk/authoring builder surface with harness-backed tests ([pm-ts-starter-fjtz](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/features/pm-ts-starter-fjtz.toon))

### Removed

- Adopt pm-cli 2026.7.26 typed authoring contracts and remove the any-cast defineExtension shim ([pm-ts-starter-0cd3](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/tasks/pm-ts-starter-0cd3.toon))

## 2026.7.26 - 2026-07-26

### Fixed

- Reference extension claimed to be fully typed but used any, hiding three wrong SDK contracts ([pm-ts-starter-v5gs](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/issues/pm-ts-starter-v5gs.toon))

### Other

- Enable governance duplicate-detection advisory mode and adopt pm-cli 2026.7.25 ([pm-ts-starter-4u91](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/chores/pm-ts-starter-4u91.toon))

## 2026.7.25 - 2026-07-25

### Fixed

- pm item reads are capped at Node's 1 MiB spawnSync default, so a mature tracker fails with no diagnosis ([pm-ts-starter-bftc](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/issues/pm-ts-starter-bftc.toon))

### Other

- Adopt --respect-item-release in changelog scripts and bump pm-changelog to 2026.7.24 ([pm-ts-starter-rgr8](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/chores/pm-ts-starter-rgr8.toon))

## 2026.7.23 - 2026-07-23

### Fixed

- Recommend pm merge reconcile (2026.7.22) over raw history-repair in Multi-agent merge safety docs ([pm-ts-starter-quha](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/issues/pm-ts-starter-quha.toon))

### Other

- Adopt pm field-aware merge driver for multi-agent branch-merge safety ([pm-ts-starter-vevn](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/chores/pm-ts-starter-vevn.toon))

## 2026.7.19 - 2026-07-19

### Added

- Hands-on functional test pass 2026-05-29 (real data) ([pm-ts-starter-h8br](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/features/pm-ts-starter-h8br.toon))

### Other

- Harden release bun-verify so registry-mirror lag cannot block the GitHub release ([pm-ts-starter-yybv](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/chores/pm-ts-starter-yybv.toon))

## 2026.7.10 - 2026-07-10

### Other

- Full-cycle hardening wave: pm-ts-starter ([pm-ts-starter-ob5y](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/tasks/pm-ts-starter-ob5y.toon))

## 2026.7.6 - 2026-07-06

### Fixed

- Fix release CI ordering (publish-before-tag) ([pm-ts-starter-o1i7](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/tasks/pm-ts-starter-o1i7.toon))

### Other

- Align Node engine with pm CLI runtime ([pm-ts-starter-zzhl](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/tasks/pm-ts-starter-zzhl.toon))
- Regenerate CHANGELOG after pm close item ([pm-ts-starter-xgpp](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/tasks/pm-ts-starter-xgpp.toon))

## 2026.6.13-1 - 2026-06-13

### Other

- Daily Release publish step runs prepublishOnly post-tag: align npm publish with --ignore-scripts ([pm-ts-starter-i076](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/tasks/pm-ts-starter-i076.toon))

## 2026.6.13 - 2026-06-12

### Fixed

- Reported extension version drifts from released version (hardcoded VERSION constant) ([pm-ts-starter-41z0](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/tasks/pm-ts-starter-41z0.toon))

## 2026.6.7 - 2026-06-07

### Added

- Align TypeScript starter version and SDK smoke coverage ([pm-ts-starter-m5qd](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/features/pm-ts-starter-m5qd.toon))

### Other

- Harden release readiness checks ([pm-ts-starter-5op0](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/chores/pm-ts-starter-5op0.toon))
- Align package dependencies to pm CLI/SDK 2026.6.6 ([pm-ts-starter-6abl](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/chores/pm-ts-starter-6abl.toon))

## 2026.6.4 - 2026-06-04

### Fixed

- Fix version mismatch + complete 9-capability demo, test mock, README ([pm-ts-starter-ol9y](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/chores/pm-ts-starter-ol9y.toon))

## 2026.6.2 - 2026-06-02

### Fixed

- Fix output-corruption + demonstrate all 9 SDK capabilities correctly (typed reference) ([pm-ts-starter-l3ga](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/features/pm-ts-starter-l3ga.toon))

## 2026.5.30 - 2026-05-30

### Other

- Production-readiness audit 2026-05-28 ([pm-ts-starter-w3h7](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/tasks/pm-ts-starter-w3h7.toon))

## 2026.5.28 - 2026-05-28

### Added

- Add publish retry + provenance fallback to release workflow ([pm-ts-starter-pvs2](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/tasks/pm-ts-starter-pvs2.toon))

## 2026.5.27 - 2026-05-27

### Added

- Add bun-install verification to release workflow ([pm-ts-starter-rweg](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/tasks/pm-ts-starter-rweg.toon))

## 2026.5.26 - 2026-05-26

### Fixed

- ci: fix release workflow step ordering ([pm-ts-starter-6qw5](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/tasks/pm-ts-starter-6qw5.toon))

### Other

- Release readiness hardening for pm-ts-starter ([pm-ts-starter-2wfp](https://github.com/unbraind/pm-ts-starter/blob/main/.agents/pm/tasks/pm-ts-starter-2wfp.toon))
