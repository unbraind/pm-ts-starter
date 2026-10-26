/** One reviewed option with an explicit safety class and enforcement action. */
export interface CompilerOptionPolicy {
    /** Output/cache control, mandatory checking, or preserved consumer semantics. */
    category: "output" | "checking" | "neutral";
    /** Why this option belongs in its class. */
    reason: string;
    /** Path confinement, or a command-only option that the checker never forwards. */
    safe: "confine" | "refuse" | "command" | "preserve";
}
/** The only option policy: adding a compiler option requires an explicit reviewed row. */
export declare const COMPILER_OPTION_ROWS: readonly [string, CompilerOptionPolicy][];
/** Index the reviewed rows after retaining the array for duplicate-classification checks. */
export declare const COMPILER_OPTION_POLICY: ReadonlyMap<string, CompilerOptionPolicy>;
/** Parse the invoked compiler's complete public table, including watch/build declarations. */
export declare function compilerOptionNames(help: string): string[];
/** Refuse every newly introduced option rather than silently assigning a default class. */
export declare function classifiedCompilerOptions(help: string): ReadonlyMap<string, CompilerOptionPolicy>;
/** Identify explicit paths that would emit outside the disposable project copy. */
export declare function escapingCompilerOutputs(policy: ReadonlyMap<string, CompilerOptionPolicy>, original: Record<string, unknown>, project: string, config?: string): string[];
/** Identify enabled checking bypasses and command modes without changing their values. */
export declare function refusedCompilerOptions(policy: ReadonlyMap<string, CompilerOptionPolicy>, original: Record<string, unknown>): string[];
//# sourceMappingURL=sdk-compiler-policy.d.ts.map