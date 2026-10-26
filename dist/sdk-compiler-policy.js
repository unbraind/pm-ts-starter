/** Exhaustive, reasoned policy for the exact compiler invoked by the SDK oracle. */
import { existsSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
/** Expand reviewed groups into independently addressable policy rows. */
function entries(category, reason, safe, names) {
    return names.split(" ").map(name => [name, { category, reason, safe }]);
}
/** The only option policy: adding a compiler option requires an explicit reviewed row. */
export const COMPILER_OPTION_ROWS = [
    ...entries("output", "Refuse absolute or escaping output/cache destinations; pass the original config through unchanged.", "confine", "outDir outFile declarationDir tsBuildInfoFile generateCpuProfile generateTrace pprofDir"),
    ...entries("output", "Inspect consumer values unchanged; delegation adds explicit noEmit and stable diagnostic presentation.", "preserve", "assumeChangesOnlyAffectDirectDependencies incremental composite declaration declarationMap emitDeclarationOnly sourceMap inlineSourceMap inlineSources noEmit noEmitOnError traceResolution explainFiles diagnostics extendedDiagnostics listFiles listEmittedFiles"),
    ...entries("output", "Refuse active command modes rather than rewriting values or starting unbounded compiler processes.", "command", "watch build init clean force dry verbose builders stopBuildOnErrors all help ignoreConfig listFilesOnly quiet showConfig version"),
    ...entries("checking", "Refuse active checking bypasses with a typed remedy; never silently change compiler diagnostics.", "refuse", "noCheck noResolve skipLibCheck skipDefaultLibCheck"),
    ...entries("neutral", "Preserve consumer checking strength and defaults; these select which diagnostics TypeScript reports.", "preserve", "allowJs checkJs strict noImplicitAny noImplicitThis strictNullChecks strictFunctionTypes strictBindCallApply strictPropertyInitialization strictBuiltinIteratorReturn useUnknownInCatchVariables noUncheckedSideEffectImports forceConsistentCasingInFileNames"),
    ...entries("neutral", "Preserve consumer module and declaration selection; compiler-resolved file provenance independently requires selected inputs to stay isolated.", "preserve", "allowArbitraryExtensions allowImportingTsExtensions allowUmdGlobalAccess baseUrl customConditions module moduleResolution moduleSuffixes paths resolveJsonModule resolvePackageJsonExports resolvePackageJsonImports rootDir rootDirs typeRoots types preserveSymlinks lib noLib libReplacement jsxImportSource"),
    ...entries("neutral", "Preserve the consumer language and interop contract; these options change accepted syntax or modeled runtime semantics without bypassing binding or semantic checking.", "preserve", "allowSyntheticDefaultImports erasableSyntaxOnly esModuleInterop isolatedDeclarations isolatedModules verbatimModuleSyntax exactOptionalPropertyTypes noUncheckedIndexedAccess noPropertyAccessFromIndexSignature experimentalDecorators jsx jsxFactory jsxFragmentFactory moduleDetection reactNamespace target useDefineForClassFields"),
    ...entries("neutral", "Only adds supplementary control-flow or unused-code diagnostics; disabling it does not suppress SDK binding or declaration diagnostics.", "preserve", "allowUnreachableCode allowUnusedLabels alwaysStrict noFallthroughCasesInSwitch noImplicitOverride noImplicitReturns noUnusedLocals noUnusedParameters"),
    ...entries("neutral", "Only controls emitted representation; the compiler may emit with unchanged values into disposable storage.", "preserve", "mapRoot sourceRoot rewriteRelativeImportExtensions downlevelIteration emitBOM importHelpers newLine noEmitHelpers preserveConstEnums removeComments stripInternal emitDecoratorMetadata"),
    ...entries("neutral", "Only affects language-service or watch behavior; neither service nor watch mode is invoked.", "preserve", "disableReferencedProjectLoad disableSolutionSearching disableSourceOfProjectReferenceRedirect disableSizeLimit plugins watchInterval watchFile watchDirectory fallbackPolling synchronousWatchDirectory excludeDirectories excludeFiles preserveWatchOutput maxNodeModuleJsDepth"),
    ...entries("neutral", "Inspect original performance and presentation values; typechecking selects stable pretty-false output.", "preserve", "checkers locale project singleThreaded noErrorTruncation pretty deduplicatePackages stableTypeOrdering"),
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
/** Follow existing write ancestors without following a dangling or cyclic link outside the sandbox. */
function containedWrite(project, target) {
    const seen = new Set();
    let path = target;
    while (!existsSync(path)) {
        if (seen.has(path))
            return false;
        seen.add(path);
        const info = lstatSync(path, { throwIfNoEntry: false });
        path = info?.isSymbolicLink() ? resolve(dirname(path), readlinkSync(path)) : dirname(path);
    }
    const relativePath = relative(realpathSync(project), realpathSync(path));
    return !isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith("../") && !relativePath.startsWith("..\\");
}
/** Identify explicit paths that would emit outside the disposable project copy. */
export function escapingCompilerOutputs(policy, original, project, config = join(project, "tsconfig.json")) {
    const context = dirname(config);
    const outputs = { ...original };
    // noEmit and build mode can still write the compiler's default incremental cache.
    if ((original.incremental === true || original.composite === true) && original.tsBuildInfoFile === undefined) {
        const cache = basename(config).replace(/\.json$/, "") + ".tsbuildinfo";
        const output = typeof original.outFile === "string" ? original.outFile.replace(/\.[^/.\\]+$/, "") + ".tsbuildinfo"
            : typeof original.outDir === "string" ? resolve(context, original.outDir, typeof original.rootDir === "string"
                ? relative(resolve(context, original.rootDir), resolve(context, cache)) : cache) : resolve(context, cache);
        outputs.tsBuildInfoFile = relative(context, resolve(context, output));
    }
    return [...policy].filter(([name, row]) => {
        const value = outputs[name];
        if (row.safe !== "confine" || typeof value !== "string")
            return false;
        const path = relative(project, resolve(context, value));
        return isAbsolute(value) || path === ".." || path.startsWith("../") || path.startsWith("..\\") || (existsSync(project) && !containedWrite(project, resolve(context, value)));
    }).map(([name]) => name);
}
/** Identify enabled checking bypasses and command modes without changing their values. */
export function refusedCompilerOptions(policy, original) {
    return [...policy].filter(([name, row]) => (row.safe === "refuse" || row.safe === "command") && original[name] === true).map(([name]) => name);
}
//# sourceMappingURL=sdk-compiler-policy.js.map