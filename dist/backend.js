/** Read-only backend contract shared with the generated production extension. */
import { PmClient, certifyCompleteListResult, PmCompleteListValidationError, } from "@unbrained/pm-cli/sdk";
/** Wrap an untrusted provider with fail-closed certification and typed refusals. */
export function createBackendAdapter(backend, reader) {
    return {
        async execute(operation) {
            if (operation !== "inspect") {
                return { ok: false, contract_version: 1, backend, operation, code: "unsupported_operation",
                    remedy: "Use inspect, or implement and test an explicit write capability before enabling mutations." };
            }
            try {
                const result = certifyCompleteListResult(await reader.listAllComplete());
                return { ok: true, contract_version: 1, backend, operation, item_count: result.items.length,
                    complete_list: result.complete_list };
            }
            catch (error) {
                if (error instanceof PmCompleteListValidationError) {
                    return { ok: false, contract_version: 1, backend, operation, code: "invalid_receipt",
                        remedy: "Return the unmodified SDK listAllComplete envelope, including read_output and omission_receipt.",
                        evidence: error.receipt };
                }
                return { ok: false, contract_version: 1, backend, operation, code: "backend_unavailable",
                    remedy: "Check tracker initialization or remote transport configuration, then retry inspect." };
            }
        },
    };
}
/** Open a tracker without loading extensions or invoking a Git subprocess. */
export function createDirectoryAdapter(pmRoot) {
    return createBackendAdapter("directory", new PmClient({ pmRoot, noExtensions: true }));
}
/** Connect a caller-owned MCP/HTTP transport without assuming a wire protocol. */
export function createRemoteAdapter(reader) {
    return createBackendAdapter("remote", reader);
}
/**
 * Parse generated-CLI argv so a leading option is never used as the tracker path.
 *
 * `inspect --json` is a normal default-tracker invocation. Positional destructuring
 * assigns `--json` to the tracker, opens that token as a directory, and reports
 * initialization failure instead of honoring the flag.
 *
 * @param argv - Arguments after the node binary and script path.
 * @returns Operation, tracker root, and remaining flags.
 */
export function parseCliInvocation(argv) {
    const [operation = "inspect", ...rest] = argv;
    const trackerArg = rest[0] !== undefined && !rest[0].startsWith("--") ? rest[0] : undefined;
    return {
        operation,
        tracker: trackerArg ?? ".agents/pm",
        flags: trackerArg === undefined ? [...rest] : rest.slice(1),
    };
}
//# sourceMappingURL=backend.js.map