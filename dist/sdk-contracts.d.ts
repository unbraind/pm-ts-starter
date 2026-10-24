/** An exact, independently provisioned published SDK installation; never modified. */
export interface SdkContractTarget {
    /** Published three-part version expected in the installed package metadata. */
    version: string;
    /** Directory containing the SDK's package.json and emitted declarations. */
    root: string;
}
/** A real consumer source; compiled but never executed by the checker. */
export interface SdkConsumerExample {
    /** Stable agent-facing name, independent of source paths. */
    id: string;
    /** TypeScript ESM consumer code, limited to 64 KiB per example. */
    source: string;
}
/** Observable boundaries; each call owns independent disposable storage. */
export type SdkContractPhase = "allocated" | "linked" | "compiled" | "cleanup";
/** Bounded inputs for two independently verified SDK targets. */
export interface SdkContractOptions {
    /** The extension's declared minimum supported published SDK. */
    minimum: SdkContractTarget;
    /** The explicitly selected current published SDK, pinned for repeatability. */
    current: SdkContractTarget;
    /** Author-controlled public API usage, or the shipped starter examples. */
    examples?: readonly SdkConsumerExample[];
    /** TypeScript's executable JS entry; defaults to the locally installed compiler. */
    compiler?: string;
    /** Optional progress observer, also useful when checking overlapping callers. */
    onProgress?: (phase: SdkContractPhase) => void;
}
/** A compact row; diagnostics retain codes rather than potentially private source text. */
export interface SdkContractRow {
    /** Which declared endpoint was checked. */
    target: "minimum" | "current";
    /** Verified installed SDK version. */
    sdk: string;
    /** Consumer identity from the input. */
    example: string;
    /** True only when consumer and selected-exports resolution checks succeed. */
    ok: boolean;
    /** Full diagnostic count, including diagnostics omitted from the sample. */
    diagnostic_count: number;
    /** At most three compiler diagnostic codes. */
    codes: string[];
}
/** Native TOON/JSON-compatible matrix with no paths, source text or tracker content. */
export interface SdkContractMatrix {
    /** Artifact schema version. */
    version: 1;
    /** All selected-target consumer and resolution checks succeeded. */
    ok: boolean;
    /** Number of independent target/example compilations. */
    checks: number;
    /** Failed consumer compilations. */
    failed: number;
    /** At most 32 rows. */
    rows: SdkContractRow[];
    /** Next action for an agent; dependency versions are never changed automatically. */
    remedy: string;
}
/** Actionable input/tooling refusals, distinct from a valid matrix with API drift. */
export declare class SdkContractRefusal extends Error {
    /** Stable refusal discriminator. */
    readonly code: "invalid_input" | "sdk_unavailable" | "compiler_unavailable";
    /** Safe retry guidance without raw tool output or machine paths. */
    readonly remedy: string;
    /** Construct a typed boundary failure with a safe operator remedy. */
    constructor(code: SdkContractRefusal["code"], remedy: string);
}
/** Public authoring and certified all-status read examples, with checked return semantics. */
export declare const SDK_CONSUMER_EXAMPLES: readonly SdkConsumerExample[];
/** Validate author input before creating scratch files; reject vacuous and unbounded checks. */
export declare function parseSdkConsumerExamples(value: unknown): readonly SdkConsumerExample[];
/** Locate a compiler only when the caller did not supply one; omit-dev installs get a remedy. */
export declare function resolveSdkContractCompiler(from?: string): string;
/** Compile real declarations in exclusive per-call scratch storage; never touch a tracker. */
export declare function checkSdkContracts(options: SdkContractOptions): Promise<SdkContractMatrix>;
//# sourceMappingURL=sdk-contracts.d.ts.map