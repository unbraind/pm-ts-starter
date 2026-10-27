# Subprocess and output boundary inventory

## Checker runtime

| Boundary | Configuration and environment | Output interpretation |
| --- | --- | --- |
| tsc help and config inspection | Consumer executable, argument arrays, private HOME/cache/temp, filtered Node/TS/npm injection. | Help detects writer CLI capabilities; JSON config supplies writer paths and references. Checking options are not classified. |
| tsc typecheck | Same executable and unchanged config; noEmit, checker-owned writer destinations outside the copied project and pretty-false presentation. Reference-only solutions use forced build. Ordinary projects disable incremental checking; composite roots receive fresh private metadata. | Exit status is the verdict. Pretty-false headers supply file, line, column, TS code and message. No API diagnostics or semantic-phase emulation. |
| Source API inspection | Matching consumer program API in a confined child, fresh showConfig JSON and executable/API version check; getSourceFiles only, with noEmit, inactive trace/profile/cache writers, suppressed textual logging and a throwing writeFile boundary; no diagnostic or emit method. | JSON file-name strings; malformed paths are refused. |
| Native tsc resolved-file inspection | Same executable in resolution-only mode after compilation, noEmit and fresh checker-owned metadata/JSON trace destinations; both text streams discarded in the OS; canonical installed package roots tracked with a visited set. | JSON source paths, never line-delimited file-list output, must belong to the copied project or installed linked dependencies; SDK declarations must belong to the selected bound. |

Consumer copies preserve exactly their installed names and symlinks; compiler-only
companion packages are provisioned only for generated inline consumers. External installed package links
remain read-only inputs rather than recursively copied trees. Mutual links are
visited once per real path. Writable node_modules/scope containers are detached
before SDK replacement. Cache files and compiler inputs are preserved. Project metadata uses a CLI override outside the copied project; no project path is deleted. Native builds reject this override (TS5094), so forced builds protect resolved inputs and configurations from metadata writes. Generated metadata never passes between bounds. Escaping non-dependency symlinks receive a typed refusal.
Trace/profile writers and project metadata use fresh checker-owned paths outside the copy;
unneutralized destinations are checked through real ancestors and existing children. Each child gets a newly allocated private home. There is no installation, reinstallation, npm-ci,
package-manager linking, lifecycle-script or diagnostic-API-runner subprocess.

## Other shipped runtime and repository tooling

These are existing caller/workspace operations. They do not receive consumer
configuration and cannot populate the SDK contract matrix. Their caller-owned
workspace environments are intentional; the checker confinement claim applies to
the checker children enumerated above.

| Boundary | Configuration and environment | Output interpretation |
| --- | --- | --- |
| `index.ts`: `runPm` | Caller-selected tracker and argument arrays invoke the host pm CLI; no consumer npmrc or SDK compiler config is involved. | Status plus captured streams feed existing demos; JSON demos parse JSON, context demos return text. These streams are never read by the contract checker. |
| `scripts/coverage-gate.ts`: compiler inspection | Trusted workspace or test-injected compiler command, fixed showConfig flags. | JSON emit paths only; failure refuses the coverage check, never SDK diagnostics. |
| `scripts/coverage-gate.ts`: test runner | Trusted workspace/test runner, controlled Node test flags, clean test-context environment and UTC. | Status, unchanged native coverage thresholds and freshly generated native JSON coverage records determine coverage; inherited streams report tests. Consumer text cannot set compiler result codes. |
| `scripts/prepare-merge-driver.ts`: installer | Fixed Node runtime plus the resolved repository-pinned pm-ops installer; intended workspace Git configuration changes. | Inherited streams, completion status only. |
| `scripts/verify-release-changelog-date.ts`: generator and Git enumeration | Trusted repository generator selection and argument arrays; fixed Git ls-files selectors. | A generated Markdown heading and enumerated tracked filenames are read as release evidence; neither stream has SDK diagnostic authority. |
| `package.json`: production audit launcher | Trusted npm selection, ignore-scripts, explicit null userconfig and filtered allow-scripts setting. Intended repository audit rather than consumer compilation. | Streams inherited, status only. |
| `package.json` scripts and CI workflow shell commands | Repository-owned npm/Bun/build/lint/changelog/test commands operate on the checked-out package; no consumer project configuration is used as command text. | Gate statuses, build drift and assertion receipts; SDK matrix codes come from the consumer tsc output. |

## Test-only subprocesses

Tests provision exact SDK/compiler packages under npm and Bun, invoke real tsc
oracles, run isolated PM trackers, and host a synthetic authenticated registry.
The four review reproductions compare complete parsed diagnostics against tsc.
Dependency properties use at most two active workers. Test and coverage entrypoints
serialize files. Test-owned wrappers may write explicit private receipts; they do
not change consumer configuration or provide an alternative diagnostic engine.

Path-transport audit (authored modules, scripts, tests and emitted starter code):

| Boundary | Lossless representation |
| --- | --- |
| Consumer resolved inputs and missing declarations | Matching compiler API JSON names or native JSON trace `createSourceFile` paths; reject malformed paths and canonicalize both isolation operands identically. |
| Diagnostic file locations | Match complete JSON inventory paths against native headers; messages remain opaque strings. No line splitting of source paths. |
| Coverage presence | Native test-coverage events serialized by a JSON reporter, canonicalized against the actual required sources. All reported source paths must resolve; unrelated subprocesses do not receive coverage settings. |
| Tracked release-verifier inputs | `git ls-files -z`, NUL-separated without trimming. |
| Backend generator and merge-driver launcher | In-memory file maps and argument arrays; no file identities recovered from formatted command output. The launcher retains the pinned pm-ops template. |
| Test executable and npm archive paths | JSON stdout, including `npm pack --json`. |
| Test receipts | JSON/JSONL strings escape embedded path delimiters before framing. |
| Remaining newline/whitespace parsers | Source-content audits, INI syntax, release headings, identity records, option/version labels and messages; none supplies filesystem path identity. Path-component splitting uses the platform separator. |

There are no separate generator templates in this package. Build output is regenerated from the audited authored modules. The real compiler remains the verdict/diagnostic authority; compiler APIs supply source paths only, without any semantic diagnostic collector.
