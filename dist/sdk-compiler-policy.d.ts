/** Writer destinations whose CLI capability is queried from the actual compiler. */
export declare const COMPILER_WRITERS: readonly ["outDir", "outFile", "declarationDir", "tsBuildInfoFile", "generateCpuProfile", "generateTrace", "pprofDir"];
/** Discover only writer overrides; unknown checking options never need classification. */
export declare function supportedWriterOptions(help: string): ReadonlySet<string>;
/** Redirect supported active writers into a fresh directory that contains no input links. */
export declare function compilerWriterArguments(supported: ReadonlySet<string>, options: Record<string, unknown>, output: string, build: boolean): {
    args: string[];
    neutralized: ReadonlySet<string>;
};
/** Refuse unneutralized writers that can reach outside the copy or linked dependencies. */
export declare function escapingCompilerOutputs(original: Record<string, unknown>, project: string, config?: string, neutralized?: ReadonlySet<string>, build?: boolean, inputs?: ReadonlySet<string>): string[];
//# sourceMappingURL=sdk-compiler-policy.d.ts.map