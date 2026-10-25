/** One reviewed option with an explicit safety class and enforcement action. */
export interface CompilerOptionPolicy {
    /** Output/cache control, mandatory checking, or preserved consumer semantics. */
    category: "output" | "checking" | "neutral";
    /** Why this option belongs in its class. */
    reason: string;
    /** Config override, or a command-only option that the checker never forwards. */
    safe: "relocate" | "refuse" | "command" | "preserve";
}
/** The only option policy: adding a compiler option requires an explicit reviewed row. */
export declare const COMPILER_OPTION_ROWS: readonly [string, CompilerOptionPolicy][];
/** Index the reviewed rows after retaining the array for duplicate-classification checks. */
export declare const COMPILER_OPTION_POLICY: ReadonlyMap<string, CompilerOptionPolicy>;
/** Parse the invoked compiler's complete public table, including watch/build declarations. */
export declare function compilerOptionNames(help: string): string[];
/** Refuse every newly introduced option rather than silently assigning a default class. */
export declare function classifiedCompilerOptions(help: string): ReadonlyMap<string, CompilerOptionPolicy>;
/** Return only relocated output paths; no boolean, enum, list or checking value may change. */
export declare function enforcedCompilerOptions(policy: ReadonlyMap<string, CompilerOptionPolicy>, original: Record<string, unknown>, sandbox: string): Record<string, unknown>;
/** Identify enabled checking bypasses and command modes without changing their values. */
export declare function refusedCompilerOptions(policy: ReadonlyMap<string, CompilerOptionPolicy>, original: Record<string, unknown>): string[];
/** Enumerate resolution inputs for component-wise isolation checks, including unused aliases. */
export declare function compilerInputPaths(project: string, options: Record<string, unknown>): unknown[];
//# sourceMappingURL=sdk-compiler-policy.d.ts.map