/** Read-only backend contract shared with the generated production extension. */
import { type PmCompleteListCertificate, type PmCompleteListFailureReceipt } from "@unbrained/pm-cli/sdk";
/** Operations exposed by this deliberately read-only adapter. */
export type BackendOperation = "inspect" | "create" | "update" | "delete";
/** A remote integration supplies a complete-list envelope, never trusted rows alone. */
export interface RemoteReader {
    /** Perform one bounded-lifetime request using transport-owned auth and cancellation. */
    listAllComplete(): Promise<unknown>;
}
/** Stable refusal codes; backend details and credentials never appear in receipts. */
export interface BackendRefusal {
    /** Versioned discriminant for agents and TypeScript consumers. */
    ok: false;
    /** Receipt schema shared by directory and remote backends. */
    contract_version: 1;
    /** Backend transport selected by the caller. */
    backend: "directory" | "remote";
    /** Operation refused before any mutation is attempted. */
    operation: BackendOperation;
    /** Machine-readable reason for retry or capability negotiation. */
    code: "unsupported_operation" | "invalid_receipt" | "backend_unavailable";
    /** Action the caller can take without guessing backend internals. */
    remedy: string;
    /** Source contract failure, present only for invalid complete-list envelopes. */
    evidence?: PmCompleteListFailureReceipt;
}
/** Compact proof of a full read; item content never leaves this adapter. */
export interface BackendInspection {
    /** Successful receipt discriminator. */
    ok: true;
    /** Stable receipt version. */
    contract_version: 1;
    /** Selected transport, independent of Git availability. */
    backend: "directory" | "remote";
    /** Only supported operation in this project. */
    operation: "inspect";
    /** Certified corpus cardinality, including terminal items. */
    item_count: number;
    /** SDK-issued proof of strict, complete, unbounded input. */
    complete_list: PmCompleteListCertificate;
}
/** Discriminated result for both backend transports. */
export type BackendReceipt = BackendInspection | BackendRefusal;
/** Same executable interface for local directory and injected remote providers. */
export interface BackendAdapter {
    /** Evaluate an operation; unsupported writes never call the provider. */
    execute(operation: BackendOperation): Promise<BackendReceipt>;
}
/** Wrap an untrusted provider with fail-closed certification and typed refusals. */
export declare function createBackendAdapter(backend: "directory" | "remote", reader: RemoteReader): BackendAdapter;
/** Open a tracker without loading extensions or invoking a Git subprocess. */
export declare function createDirectoryAdapter(pmRoot: string): BackendAdapter;
/** Connect a caller-owned MCP/HTTP transport without assuming a wire protocol. */
export declare function createRemoteAdapter(reader: RemoteReader): BackendAdapter;
/** Standalone CLI argv after a leading option has been kept out of the tracker position. */
export interface CliInvocation {
    /** Requested operation. Empty argv selects inspect. */
    operation: string;
    /** Tracker root. The default applies when the next token is absent or an option. */
    tracker: string;
    /** Tokens after the optional tracker, including a leading option. */
    flags: string[];
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
export declare function parseCliInvocation(argv: readonly string[]): CliInvocation;
//# sourceMappingURL=backend.d.ts.map