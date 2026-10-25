/** Exhaustive, reasoned policy for the exact compiler invoked by the SDK oracle. */
import { basename, isAbsolute, resolve } from "node:path";
/** Expand reviewed groups into independently addressable policy rows. */
function entries(category, reason, safe, names) {
    return names.split(" ").map(name => [name, { category, reason, safe }]);
}
/** The only option policy: adding a compiler option requires an explicit reviewed row. */
export const COMPILER_OPTION_ROWS = [
    ...entries("output", "Relocate only output/cache destinations; preserve every other consumer option value.", "relocate", "outDir outFile declarationDir tsBuildInfoFile mapRoot sourceRoot generateCpuProfile generateTrace pprofDir"),
    ...entries("output", "Preserve emission and diagnostic controls, including project membership and incremental checking semantics.", "preserve", "assumeChangesOnlyAffectDirectDependencies incremental composite declaration declarationMap emitDeclarationOnly sourceMap inlineSourceMap inlineSources noEmit noEmitOnError traceResolution explainFiles diagnostics extendedDiagnostics listFiles listEmittedFiles"),
    ...entries("output", "Refuse active command modes rather than rewriting values or starting unbounded compiler processes.", "command", "watch build init clean force dry verbose builders stopBuildOnErrors all help ignoreConfig listFilesOnly quiet showConfig version"),
    ...entries("checking", "Refuse active checking bypasses with a typed remedy; never silently change compiler diagnostics.", "refuse", "noCheck noResolve skipLibCheck skipDefaultLibCheck"),
    ...entries("neutral", "Preserve consumer checking strength and defaults; these select which diagnostics TypeScript reports.", "preserve", "allowJs checkJs strict noImplicitAny noImplicitThis strictNullChecks strictFunctionTypes strictBindCallApply strictPropertyInitialization strictBuiltinIteratorReturn useUnknownInCatchVariables noUncheckedSideEffectImports forceConsistentCasingInFileNames"),
    ...entries("neutral", "Preserve consumer module and declaration selection; the provenance and reference guards independently require all selected inputs to stay isolated.", "preserve", "allowArbitraryExtensions allowImportingTsExtensions allowUmdGlobalAccess baseUrl customConditions module moduleResolution moduleSuffixes paths resolveJsonModule resolvePackageJsonExports resolvePackageJsonImports rootDir rootDirs typeRoots types preserveSymlinks lib noLib libReplacement jsxImportSource"),
    ...entries("neutral", "Preserve the consumer language and interop contract; these options change accepted syntax or modeled runtime semantics without bypassing binding or semantic checking.", "preserve", "allowSyntheticDefaultImports erasableSyntaxOnly esModuleInterop isolatedDeclarations isolatedModules verbatimModuleSyntax exactOptionalPropertyTypes noUncheckedIndexedAccess noPropertyAccessFromIndexSignature experimentalDecorators jsx jsxFactory jsxFragmentFactory moduleDetection reactNamespace target useDefineForClassFields"),
    ...entries("neutral", "Only adds supplementary control-flow or unused-code diagnostics; disabling it does not suppress SDK binding or declaration diagnostics.", "preserve", "allowUnreachableCode allowUnusedLabels alwaysStrict noFallthroughCasesInSwitch noImplicitOverride noImplicitReturns noUnusedLocals noUnusedParameters"),
    ...entries("neutral", "Only controls emitted representation; the compiler may emit with unchanged values into disposable storage.", "preserve", "rewriteRelativeImportExtensions downlevelIteration emitBOM importHelpers newLine noEmitHelpers preserveConstEnums removeComments stripInternal emitDecoratorMetadata"),
    ...entries("neutral", "Only affects language-service or watch behavior; neither service nor watch mode is invoked.", "preserve", "disableReferencedProjectLoad disableSolutionSearching disableSourceOfProjectReferenceRedirect disableSizeLimit plugins watchInterval watchFile watchDirectory fallbackPolling synchronousWatchDirectory excludeDirectories excludeFiles preserveWatchOutput maxNodeModuleJsDepth"),
    ...entries("neutral", "Preserve performance and diagnostic presentation values; only inspection passes select a bounded command mode.", "preserve", "checkers locale project singleThreaded noErrorTruncation pretty deduplicatePackages stableTypeOrdering"),
];
/** Index the reviewed rows after retaining the array for duplicate-classification checks. */
export const COMPILER_OPTION_POLICY = new Map(COMPILER_OPTION_ROWS);
/** Parse the invoked compiler's complete public table, including watch/build declarations. */
export function compilerOptionNames(help) {
    const names = [...new Set([...help.matchAll(/^--([^\s,]+)/gm)].map(match => match[1]))];
    if (!help.includes("ALL COMPILER OPTIONS") || !help.includes("WATCH OPTIONS") || !help.includes("BUILD OPTIONS") || names.length === 0)
        throw new Error("Provide a compiler with a complete English help-all option table.");
    return names;
}
/** Refuse every newly introduced option rather than silently assigning a default class. */
export function classifiedCompilerOptions(help) {
    return new Map(compilerOptionNames(help).map(name => {
        const policy = COMPILER_OPTION_POLICY.get(name);
        if (!policy)
            throw new Error("Classify every option of this compiler in the SDK compiler policy before retrying.");
        return [name, policy];
    }));
}
/** Return only relocated output paths; no boolean, enum, list or checking value may change. */
export function enforcedCompilerOptions(policy, original, sandbox) {
    const overrides = {};
    for (const [name, row] of policy) {
        if (row.safe !== "relocate")
            continue;
        if (original[name] !== undefined || name === "outDir" || (name === "tsBuildInfoFile" && (original.incremental === true || original.composite === true))) {
            overrides[name] = resolve(sandbox, name, typeof original[name] === "string" ? basename(original[name]) : name === "tsBuildInfoFile" ? "project.tsbuildinfo" : "output");
        }
    }
    return overrides;
}
/** Identify enabled checking bypasses and command modes without changing their values. */
export function refusedCompilerOptions(policy, original) {
    return [...policy].filter(([name, row]) => (row.safe === "refuse" || row.safe === "command") && original[name] === true).map(([name]) => name);
}
/** Enumerate resolution inputs for component-wise isolation checks, including unused aliases. */
export function compilerInputPaths(project, options) {
    return [options.baseUrl ?? ".", options.rootDir ?? ".", ...Object.values(options.paths ?? {}).flat().map(path => typeof path === "string" ? resolve(project, (options.baseUrl ?? "."), path) : path),
        ...(options.typeRoots ?? []), ...(options.rootDirs ?? []), ...(options.types ?? []).filter(value => isAbsolute(value) || value.startsWith("."))];
}
//# sourceMappingURL=sdk-compiler-policy.js.map