# Subprocess and output boundary inventory

## Checker runtime

| Boundary | Configuration and environment | Output interpretation |
| --- | --- | --- |
| Consumer compiler API | Own installed typescript module in a bounded child with private HOME/cache/temp; Node/TS/npm injection removed. Config parsing follows extends, programs are fresh, noEmit is enabled, active trace/profile writers are disabled and writeFile throws. | Structured Diagnostic and resolvedModule objects use an exclusive checker-owned JSON file; stdout is discarded and no compiler text is interpreted. |

Installed names and symlinks remain authoritative; only the selected SDK is replaced.
External installed links remain read-only inputs and canonical dependency roots are
visited once. Non-dependency links escaping the copy are refused. SDK ownership
comes from resolver package identities and canonical paths, never metadata ancestry.
The existing copy walk inventories nested local manifest locations without reading
names. Loaded files crossing an unidentified local package boundary are refused as
unsupported_project_shape; compiler-identified dependencies and referenced project
roots remain supported. The inventory never assigns SDK ownership.
Compiler inputs and caches are preserved. There is no emit, incremental builder,
installation, reinstallation, package-manager linking or lifecycle-script subprocess.
The solution builder API supplies the complete reference build order, including
children of source-bearing projects; its build/emit methods are never called.
Import and type-reference identities come from Program resolution caches, preserving
each usage mode. Each bound uses independent storage. API-incompatible compilers
receive compiler_unavailable or compiler_api_unavailable without a binary fallback.

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
| `package.json` scripts and CI workflow shell commands | Repository-owned npm/Bun/build/lint/changelog/test commands operate on the checked-out package; no consumer project configuration is used as command text. | Gate statuses, build drift and assertion receipts; SDK matrix codes come from structured consumer API diagnostics. |

## Test-only subprocesses

Tests provision exact public SDK/compiler packages, run independent compiler API
programs and real cache-warming CLI builds, exercise isolated PM trackers, and host
a synthetic authenticated registry. Generated dependency properties use at most
two workers. Diagnostic oracles consume objects rather than rendered headers.
Test-owned API modules may write explicit private receipts without changing config.

Path-transport audit (authored modules, scripts, tests and emitted starter code):

| Boundary | Lossless representation |
| --- | --- |
| Consumer resolved inputs and missing declarations | Compiler program source names and resolvedModule identities serialized as JSON; canonicalize both isolation operands identically. |
| Diagnostic file locations | Diagnostic.file.fileName and positions from the compiler API, serialized as JSON; no header recognition or line splitting. |
| Coverage presence | Native test-coverage events serialized by a JSON reporter, canonicalized against the actual required sources. All reported source paths must resolve; unrelated subprocesses do not receive coverage settings. |
| Tracked release-verifier inputs | `git ls-files -z`, NUL-separated without trimming. |
| Backend generator and merge-driver launcher | In-memory file maps and argument arrays; no file identities recovered from formatted command output. The launcher retains the pinned pm-ops template. |
| Test executable and npm archive paths | JSON stdout, including `npm pack --json`. |
| Test receipts | JSON/JSONL strings escape embedded path delimiters before framing. |
| Remaining newline/whitespace parsers | Source-content audits, INI syntax, release headings, identity records, option/version labels and messages; none supplies filesystem path identity. Path-component splitting uses the platform separator. |

There are no separate generator templates in this package. Build output is regenerated from the audited authored modules. The consumer compiler API supplies diagnostics and resolution identities directly; no textual diagnostic or package-ancestor ownership parser remains.
