# Consumer compiler API

The checker uses the consumer's own installed `typescript`. It parses configuration with `getParsedCommandLineOfConfigFile`, constructs a fresh `createProgram` and classifies `getPreEmitDiagnostics` objects by category, code and canonical file name. Configuration parsing follows the whole extends chain. TypeScript retains its original options object, including non-enumerable configuration metadata. No stdout diagnostic parser, language service or diagnostic-phase emulation remains.

The matrix schema and refusal codes are unchanged. Error-category diagnostics determine the verdict; exit_code is zero for a clean API result and one for errors. Full diagnostics retain file, line, column, code and flattened message. Paths and messages cross the worker boundary through an exclusive checker-owned JSON file; stdout is discarded. JSON strings preserve embedded newlines and diagnostic-like text.

Ownership uses TypeScript's resolvedModule packageId, isExternalLibraryImport and realpath. Installed aliases and import specifiers are resolved by the compiler. SDK declarations must belong to the selected canonical root and exact version; unknown or foreign identity receives a named isolation_refused. Ownership never walks package.json ancestors.

Stock 5.9.3 and 6.0.3 are tested against an independent direct API oracle. Versions lacking createProgram, getPreEmitDiagnostics, getParsedCommandLineOfConfigFile or resolveModuleName receive compiler_unavailable. The pinned native 7.0.2 build compiler currently lacks that resolver API; its binary is never used as a text-based fallback and no other compiler is substituted.

Fresh programs never consume incremental state. The checker does not call emit or an incremental builder; reference-only solutions inspect build order for structured circular-reference diagnostics and check their projects independently. noEmit is enabled, trace/profile writers are inactive and host writeFile throws. Sources, configuration, caches and configured output destinations are preserved. Consumer code is never executed. See the [process inventory](sdk-contract-process-inventory.md) for filesystem and subprocess boundaries.
