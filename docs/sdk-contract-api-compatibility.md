# Compiler delegation

The consumer's installed `tsc` supplies the verdict, exit status and diagnostics. The checker parses pretty-false headers into file, line, column, code and multiline message, normalizing the private project prefix. It has no compiler program, language service, native API or diagnostic-phase emulation.

Ordinary projects run `tsc --project tsconfig.json --incremental false --noEmit --pretty false --locale en`. Reference-only solutions use `tsc --build tsconfig.json --force --noEmit --pretty false`. TypeScript owns fatal-error ordering, global diagnostics and project references, including TS6305 for missing referenced declarations.

Unfiltered stock TypeScript 5.9.3, 6.0.3 and pinned 7.0.2 are tested with clean consumers, type errors and writer/error combinations. The four review reproductions compare complete diagnostics against the real executable. Alias, dependency-graph and unchanged-configuration controls remain.

Checking options pass through without classification. Only writer capabilities are queried: supported active writers receive fresh private destinations, including resolved-file probes; unneutralized writes must remain confined. Escaping non-dependency links and uninspectable build graphs are refused. The [README](../README.md) and [process inventory](sdk-contract-process-inventory.md) describe the filesystem and subprocess boundaries.

Consumer compiler caches are never trusted. Copies preserve cache files and all compiler inputs. Project-mode metadata is overridden on the CLI to fresh checker-owned storage outside the copied project; no configured cache destination is deleted. Each bound starts independently. Composite project roots keep project compilation with fresh private metadata, preserving reference diagnostics without TS6379 or TS6310. Warm/cold differential controls use real 5.9.3 and 6.0.3 compilers. Native build mode rejects CLI metadata overrides with TS5094; it retains forced checking and refuses metadata destinations that overwrite actual compiler inputs or configurations. Source, directory and external-target project regressions compare complete diagnostics with the real executable.
