/** Confine compiler writers without classifying or rejecting checking options. */
import { existsSync, lstatSync, mkdtempSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
/** Writer destinations whose CLI capability is queried from the actual compiler. */
export const COMPILER_WRITERS = ["outDir", "outFile", "declarationDir", "tsBuildInfoFile", "generateCpuProfile", "generateTrace", "pprofDir"];
/** Discover only writer overrides; unknown checking options never need classification. */
export function supportedWriterOptions(help) {
    return new Set(COMPILER_WRITERS.filter(name => new RegExp("^--" + name + "(?:,|\\s|$)", "m").test(help)));
}
/** Identify a path in the disposable copy, including Windows drive boundaries. */
function contained(project, path) {
    const value = relative(realpathSync(project), path);
    return !isAbsolute(value) && !/^\.\.(?:[\\/]|$)/.test(value);
}
/** Inspect the complete existing output subtree, not merely its parent directory. */
function writableTree(project, target) {
    let ancestor = target;
    while (!existsSync(ancestor)) {
        if (lstatSync(ancestor, { throwIfNoEntry: false }))
            return false;
        ancestor = dirname(ancestor);
    }
    if (!contained(project, realpathSync(ancestor)))
        return false;
    const visited = new Set();
    const visit = (path) => {
        if (!existsSync(path))
            return false;
        const canonical = realpathSync(path);
        if (!contained(project, canonical))
            return false;
        if (visited.has(canonical))
            return true;
        visited.add(canonical);
        return !statSync(canonical).isDirectory() || readdirSync(canonical).every(name => visit(join(canonical, name)));
    };
    return !existsSync(target) || visit(target);
}
/** Redirect supported active writers into a fresh directory that contains no input links. */
export function compilerWriterArguments(supported, options, output, build) {
    const names = ["generateTrace", "generateCpuProfile", "pprofDir"].filter(name => typeof options[name] === "string" && supported.has(name));
    if (!build && supported.has("tsBuildInfoFile"))
        names.push("tsBuildInfoFile");
    const directory = names.length ? mkdtempSync(join(output, "writers-")) : "";
    const args = names.flatMap(name => ["--" + name, join(directory, name === "generateCpuProfile" ? "compiler.cpuprofile" : name === "tsBuildInfoFile" ? "compiler.tsbuildinfo" : name)]);
    return { args, neutralized: new Set(names) };
}
/** Refuse unneutralized writers that can reach outside the copy or linked dependencies. */
export function escapingCompilerOutputs(original, project, config = join(project, "tsconfig.json"), neutralized = new Set(), build = false, inputs = new Set()) {
    const context = dirname(config), outputs = { ...original };
    const incremental = build || original.incremental === true || original.composite === true;
    if (incremental && original.tsBuildInfoFile === undefined) {
        const cache = basename(config).replace(/\.json$/, "") + ".tsbuildinfo";
        const output = typeof original.outFile === "string" ? original.outFile.replace(/\.[^/.\\]+$/, "") + ".tsbuildinfo"
            : typeof original.outDir === "string" ? resolve(context, original.outDir, typeof original.rootDir === "string"
                ? relative(resolve(context, original.rootDir), resolve(context, cache)) : cache) : resolve(context, cache);
        outputs.tsBuildInfoFile = relative(context, resolve(context, output));
    }
    // noEmit neutralizes source/declaration outputs; incremental metadata is independent.
    return ["generateTrace", "generateCpuProfile", "pprofDir", ...incremental ? ["tsBuildInfoFile"] : []].filter(name => {
        const value = outputs[name];
        if (neutralized.has(name) || typeof value !== "string")
            return false;
        const target = resolve(context, value);
        return isAbsolute(value) || relative(project, target).split(/[\\/]/).includes("node_modules") || !writableTree(project, target) || (name === "tsBuildInfoFile" && existsSync(target) && (statSync(target).isDirectory() || inputs.has(realpathSync(target))));
    });
}
//# sourceMappingURL=sdk-compiler-policy.js.map