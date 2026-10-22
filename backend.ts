/** Read-only backend contract shared with the generated production extension. */
import {
  PmClient,
  certifyCompleteListResult,
  PmCompleteListValidationError,
  type PmCompleteListCertificate,
  type PmCompleteListFailureReceipt,
} from "@unbrained/pm-cli/sdk";

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
export function createBackendAdapter(backend: "directory" | "remote", reader: RemoteReader): BackendAdapter {
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
      } catch (error) {
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
export function createDirectoryAdapter(pmRoot: string): BackendAdapter {
  return createBackendAdapter("directory", new PmClient({ pmRoot, noExtensions: true }));
}

/** Connect a caller-owned MCP/HTTP transport without assuming a wire protocol. */
export function createRemoteAdapter(reader: RemoteReader): BackendAdapter {
  return createBackendAdapter("remote", reader);
}

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
export function parseCliInvocation(argv: readonly string[]): CliInvocation {
  const [operation = "inspect", ...rest] = argv;
  const trackerArg = rest[0] !== undefined && !rest[0].startsWith("--") ? rest[0] : undefined;
  return {
    operation,
    tracker: trackerArg ?? ".agents/pm",
    flags: trackerArg === undefined ? [...rest] : rest.slice(1),
  };
}
