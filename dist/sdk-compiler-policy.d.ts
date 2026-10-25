/** One reviewed option with an explicit safety class and enforcement action. */
export interface CompilerOptionPolicy {
    /** Output/cache control, mandatory checking, or preserved consumer semantics. */
    category: "output" | "checking" | "neutral";
    /** Why this option belongs in its class. */
    reason: string;
    /** Config override, or a command-only option that the checker never forwards. */
    safe: boolean | null | "command" | "preserve" | "off";
}
/** The only option policy: adding a compiler option requires an explicit reviewed row. */
export declare const COMPILER_OPTION_ROWS: readonly [string, CompilerOptionPolicy][];
/** Index the reviewed rows after retaining the array for duplicate-classification checks. */
export declare const COMPILER_OPTION_POLICY: ReadonlyMap<string, CompilerOptionPolicy>;
/** Parse the invoked compiler's complete public table, including watch/build declarations. */
export declare function compilerOptionNames(help: string): string[];
/** Refuse every newly introduced option rather than silently assigning a default class. */
export declare function classifiedCompilerOptions(help: string): ReadonlyMap<string, CompilerOptionPolicy>;
/** Apply safe values before even showConfig can activate inherited write settings. */
export declare function enforcedCompilerOptions(policy: ReadonlyMap<string, CompilerOptionPolicy>): Record<string, unknown>;
/** Disable command-only modes before they can turn a bounded check into a watcher. */
export declare function enforcedCompilerArguments(policy: ReadonlyMap<string, CompilerOptionPolicy>): string[];
/** Enumerate resolution inputs for component-wise isolation checks, including unused aliases. */
export declare function compilerInputPaths(project: string, options: Record<string, unknown>): unknown[];
/** Inspect the original config without inheriting output/cache destinations or checking bypasses. */
export declare function inspectionCompilerArguments(policy: ReadonlyMap<string, CompilerOptionPolicy>, project: string): string[];
//# sourceMappingURL=sdk-compiler-policy.d.ts.map