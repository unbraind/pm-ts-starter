import { type SchemaEvolutionMigrationRequest } from "@unbrained/pm-cli/sdk";
/** Extension data changes supported by core, without duplicating its migration engine. */
export interface RehearsalPlan {
    /** Version of this wrapper's input contract. */
    version: 1;
    /** Ordered core migration operations; custom definitions must already exist. */
    steps: SchemaEvolutionMigrationRequest[];
}
/** Caller-owned private scratch storage, never an original tracker. */
export interface RehearsalOptions {
    /** Original tracker root, read using filesystem reads only. */
    source: string;
    /** New directory, or an existing rehearsal to resume; must be outside Git. */
    workDir: string;
    /** Immutable ordered migration specification. */
    plan: RehearsalPlan;
    /** Optional interruption boundary after core commits and before our checkpoint. */
    afterStep?: (index: number) => void;
}
/** A value-free SDK diagnostic; content and private paths stay in scratch storage. */
export interface RehearsalDiagnostic {
    /** Tracker-relative item file. */
    file: string;
    /** SDK-provided failing metadata field, or document for syntax failures. */
    field: string;
}
/** Compact receipt, suitable for native TOON and JSON rendering. */
export interface RehearsalReceipt {
    /** Success discriminator. */
    ok: true;
    /** Fixed artifact schema. */
    version: 1;
    /** Certified all-status item counts. */
    items: number;
    /** Number of completed operations. */
    steps: number;
    /** Item-operation pairs affected, not distinct items. */
    affected: number;
    /** Whether an existing scratch checkpoint was opened. */
    resumed: boolean;
    /** SHA-256 of the authoritative input snapshot. */
    source_fingerprint: string;
    /** Source fingerprint still matches after execution. */
    source_unchanged: true;
}
/** Stable refusal with a remedy, free of source values or machine paths. */
export declare class RehearsalRefusal extends Error {
    /** Machine-readable failure class. */
    readonly code: "invalid_plan" | "unsafe_storage" | "source_changed" | "invalid_data" | "unavailable";
    /** Action needed before retry. */
    readonly remedy: string;
    /** Bounded sample, with the full count retained separately. */
    readonly diagnostics: RehearsalDiagnostic[];
    /** Total invalid documents, including omitted diagnostic rows. */
    readonly diagnostic_count: number;
    /** Construct a path-free refusal from a trusted wrapper boundary. */
    constructor(code: RehearsalRefusal["code"], remedy: string, diagnostics?: RehearsalDiagnostic[]);
}
/** Refuse unsupported plans before creating scratch artifacts. */
export declare function parseRehearsalPlan(value: unknown): RehearsalPlan;
/** Read a bounded regular plan file without accepting filesystem aliases. */
export declare function readRehearsalPlan(file: string): RehearsalPlan;
/** Sanitize storage and SDK failures into stable, actionable public refusals. */
export declare function rehearseSchemaMigration(options: RehearsalOptions): Promise<RehearsalReceipt>;
//# sourceMappingURL=rehearsal.d.ts.map