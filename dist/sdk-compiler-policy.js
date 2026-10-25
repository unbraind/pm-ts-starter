/** Exhaustive, reasoned policy for the exact compiler invoked by the SDK oracle. */
import { isAbsolute, join, resolve } from "node:path";
/** Expand reviewed groups into independently addressable policy rows. */
function entries(category, reason, safe, names) {
    return names.split(" ").map(name => [name, { category, reason, safe }]);
}
/** The only option policy: adding a compiler option requires an explicit reviewed row. */
export const COMPILER_OPTION_ROWS = [
    ...entries("output", "Disable emitted files and persistent compiler state.", false, "assumeChangesOnlyAffectDirectDependencies incremental composite declaration declarationMap emitDeclarationOnly sourceMap inlineSourceMap inlineSources"),
    ...entries("output", "Disable all emission even when a source has no errors.", true, "noEmit noEmitOnError"),
    ...entries("output", "Clear inherited output, debug, trace and cache destinations before config inspection.", null, "outDir outFile declarationDir tsBuildInfoFile mapRoot sourceRoot generateCpuProfile generateTrace"),
    ...entries("output", "Force watch mode off on every compiler invocation, including inherited invalid watch settings.", "off", "watch"),
    ...entries("output", "Never forward build, init, watch or profiling commands; the checker invokes only bounded project reads and checks.", "command", "build init clean force dry verbose builders stopBuildOnErrors pprofDir"),
    ...entries("checking", "Require semantic checking, resolution and checking of every declaration.", false, "noCheck noResolve skipLibCheck skipDefaultLibCheck"),
    ...entries("checking", "Check JavaScript as well as TypeScript; allowJs cannot silently leave a JS consumer unchecked.", true, "allowJs checkJs"),
    ...entries("checking", "Require the strict checking family even when a consumer disables an individual member.", true, "strict noImplicitAny noImplicitThis strictNullChecks strictFunctionTypes strictBindCallApply strictPropertyInitialization strictBuiltinIteratorReturn useUnknownInCatchVariables"),
    ...entries("checking", "Check side-effect imports and canonical import casing.", true, "noUncheckedSideEffectImports forceConsistentCasingInFileNames"),
    ...entries("neutral", "Preserve consumer module and declaration selection; the provenance and reference guards independently require all selected inputs to stay isolated.", "preserve", "allowArbitraryExtensions allowImportingTsExtensions allowUmdGlobalAccess baseUrl customConditions module moduleResolution moduleSuffixes paths resolveJsonModule resolvePackageJsonExports resolvePackageJsonImports rootDir rootDirs typeRoots types preserveSymlinks lib noLib libReplacement jsxImportSource"),
    ...entries("neutral", "Preserve the consumer language and interop contract; these options change accepted syntax or modeled runtime semantics without bypassing binding or semantic checking.", "preserve", "allowSyntheticDefaultImports erasableSyntaxOnly esModuleInterop isolatedDeclarations isolatedModules verbatimModuleSyntax exactOptionalPropertyTypes noUncheckedIndexedAccess noPropertyAccessFromIndexSignature experimentalDecorators jsx jsxFactory jsxFragmentFactory moduleDetection reactNamespace target useDefineForClassFields"),
    ...entries("neutral", "Only adds supplementary control-flow or unused-code diagnostics; disabling it does not suppress SDK binding or declaration diagnostics.", "preserve", "allowUnreachableCode allowUnusedLabels alwaysStrict noFallthroughCasesInSwitch noImplicitOverride noImplicitReturns noUnusedLocals noUnusedParameters"),
    ...entries("neutral", "Only controls emitted representation; noEmit and disabled persistent state prevent its output from being used as a verdict.", "preserve", "rewriteRelativeImportExtensions downlevelIteration emitBOM importHelpers newLine noEmitHelpers preserveConstEnums removeComments stripInternal emitDecoratorMetadata"),
    ...entries("neutral", "Only affects language-service or watch behavior; neither service nor watch mode is invoked.", "preserve", "disableReferencedProjectLoad disableSolutionSearching disableSourceOfProjectReferenceRedirect disableSizeLimit plugins watchInterval watchFile watchDirectory fallbackPolling synchronousWatchDirectory excludeDirectories excludeFiles preserveWatchOutput maxNodeModuleJsDepth"),
    ...entries("neutral", "Only affects performance, diagnostic presentation or command selection; the checker supplies its own fixed command switches and parses every error.", "preserve", "all checkers help ignoreConfig listFilesOnly locale project quiet showConfig singleThreaded version diagnostics explainFiles extendedDiagnostics listEmittedFiles listFiles traceResolution noErrorTruncation pretty deduplicatePackages stableTypeOrdering"),
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
/** Apply safe values before even showConfig can activate inherited write settings. */
export function enforcedCompilerOptions(policy) {
    return Object.fromEntries([...policy].filter(([, row]) => typeof row.safe === "boolean" || row.safe === null).map(([name, row]) => [name, row.safe]));
}
/** Disable command-only modes before they can turn a bounded check into a watcher. */
export function enforcedCompilerArguments(policy) {
    return [...policy].filter(([, row]) => row.safe === "off").flatMap(([name]) => [`--${name}`, "false"]);
}
/** Enumerate resolution inputs for component-wise isolation checks, including unused aliases. */
export function compilerInputPaths(project, options) {
    return [options.baseUrl ?? ".", options.rootDir ?? ".", ...Object.values(options.paths ?? {}).flat().map(path => typeof path === "string" ? resolve(project, (options.baseUrl ?? "."), path) : path),
        ...(options.typeRoots ?? []), ...(options.rootDirs ?? []), ...(options.types ?? []).filter(value => isAbsolute(value) || value.startsWith("."))];
}
/** Inspect the original config without inheriting output/cache destinations or checking bypasses. */
export function inspectionCompilerArguments(policy, project) {
    return [...enforcedCompilerArguments(policy), ...[...policy].filter(([, row]) => typeof row.safe === "boolean" || row.safe === null)
            .flatMap(([name, row]) => [`--${name}`, row.safe === null ? join(project, ".sdk-contract-inspection", name) : String(row.safe)])];
}
//# sourceMappingURL=sdk-compiler-policy.js.map