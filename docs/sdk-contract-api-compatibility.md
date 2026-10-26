# Compiler delegation

The checker delegates to the consumer's installed tsc executable. It does not load
a compiler program API, language service, native API server or RPC transport.

Ordinary projects run `tsc --project tsconfig.json --noEmit --pretty false --locale en`
inside each prepared SDK-bound copy. Reference-only solutions use
`tsc --build tsconfig.json --noEmit --pretty false`. Project compilation preserves
TS6305 for unbuilt referenced declarations instead of redirecting imports to source.

The reported exit_code and parsed diagnostic headers are authoritative.
Trace/list/statistics presentation is disabled, and multiline messages are retained. TypeScript owns fatal
option errors, global diagnostics and their order. The checker returns file, line,
column, code and message; it never reconstructs which compiler phases should run.
The compiler executable is trusted. Messages come from that executable, with the
private project prefix normalized.

The four round-11 reproductions are differential tests against the real executable.
The alias/property and unchanged-configuration regressions remain. The former
API-compatibility blocker is removed by deleting the alternative diagnostic engine.
