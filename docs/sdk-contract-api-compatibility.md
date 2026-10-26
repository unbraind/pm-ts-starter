# Round 9 API compatibility blocker

Status: implementation candidate, not release-ready. No compiler pin has changed.

The repository pins TypeScript 7.0.2. That package exposes
`typescript/unstable/sync` and `typescript/unstable/async` language-service snapshot
APIs. Its installed declarations expose neither compiler `createProgram`, emit,
nor solution-builder operations. The tagged native API server constructs a
project service; its options expose filesystem callbacks and transport settings,
without a compiler-host source-reference-redirection control.

A minimal project demonstrates a semantic difference with the required oracle:

```json
{
  "compilerOptions": { "types": [], "noEmit": true },
  "files": ["consumer.ts"],
  "references": [{ "path": "reference" }]
}
```

`consumer.ts` imports `value` from `./reference/index.js`. The referenced project
contains `export const value = 1` and an unchanged config with `composite: true`,
`outDir: "dist"`, `types: []`, and `files: ["index.ts"]`. Its declarations have
not been built.

| Observation on the same source/configuration | Result |
| --- | --- |
| Plain TypeScript 7.0.2 project `tsc` | TS6305; failing exit status |
| Native API `getConfigFileParsingDiagnostics` | empty |
| Native API `getProgramDiagnostics` | empty |
| Native API `getSyntacticDiagnostics` | empty |
| Native API `getSemanticDiagnostics` | empty |
| Native API `getDeclarationDiagnostics` | empty |

The project service redirects the reference to source. A compiler-option override,
filesystem substitution, fabricated TS6305, or fallback parsing of human compiler
text would violate the requested round-8/round-9 contract. The candidate instead
refuses API/CLI disagreement. That protects the result boundary but is insufficient
for the unchanged differential corpus, so the release gates are not certified.

Independent boundary evidence: the npm property passed 13 configurations with 19
location/execution keys, both environment casings, and untouched consumer/HOME/
prefix tripwire trees. The authenticated scoped registry dependency installed.
The diagnostic generator passed 12 programs and 24 bound comparisons with exact
TS2322/TS2307 counts and no forged TS9999. Reverting npmrc filtering exposed the
forbidden copied keys; reverting the old diagnostic parser reported six errors
instead of two. Both reversions were restored.

The remaining decision is whether to retain the pinned compiler and block this
round, or authorize a compatible compiler/API support change. A version change
also needs to account for consumer-owned TypeScript 7.0.2 installations, not just
the repository's development dependency.

Primary implementation reference:
[TypeScript 7.0.2 native API server](https://github.com/microsoft/TypeScript/blob/v7.0.2/tsc/internal/api/server.go).
