/** Confine compiler writers without classifying or rejecting checking options. */
import {existsSync, lstatSync, mkdtempSync, readdirSync, realpathSync, statSync} from "node:fs";
import {basename, dirname, isAbsolute, join, relative, resolve} from "node:path";

/** Writer destinations whose CLI capability is queried from the actual compiler. */
export const COMPILER_WRITERS = ["outDir", "outFile", "declarationDir", "tsBuildInfoFile", "generateCpuProfile", "generateTrace", "pprofDir"] as const;
/** Discover only writer overrides; unknown checking options never need classification. */
export function supportedWriterOptions(help: string): ReadonlySet<string> {
  return new Set(COMPILER_WRITERS.filter(name => new RegExp("^--" + name + "(?:,|\\s|$)", "m").test(help)));
}
/** Identify a path in the disposable copy, including Windows drive boundaries. */
function contained(project: string, path: string): boolean {
  const value = relative(realpathSync(project), path);
  return !isAbsolute(value) && !/^\.\.(?:[\\/]|$)/.test(value);
}
/** Inspect the complete existing output subtree, not merely its parent directory. */
function writableTree(project: string, target: string): boolean {
  let ancestor = target;
  while (!existsSync(ancestor)) {
    if (lstatSync(ancestor, {throwIfNoEntry: false})) return false;
    ancestor = dirname(ancestor);
  }
  if (!contained(project, realpathSync(ancestor))) return false;
  const visited = new Set<string>();
  const visit = (path: string): boolean => {
    if (!existsSync(path)) return false;
    const canonical = realpathSync(path);
    if (!contained(project, canonical)) return false;
    if (visited.has(canonical)) return true;
    visited.add(canonical);
    return !statSync(canonical).isDirectory() || readdirSync(canonical).every(name => visit(join(canonical, name)));
  };
  return !existsSync(target) || visit(target);
}
/** Redirect supported active writers into a fresh directory that contains no input links. */
export function compilerWriterArguments(supported: ReadonlySet<string>, options: Record<string, unknown>, project: string, build: boolean): {args: string[]; neutralized: ReadonlySet<string>} {
  const names = ["generateTrace", "generateCpuProfile", "pprofDir"].filter(name => typeof options[name] === "string" && supported.has(name));
  if (!build && (options.incremental === true || options.composite === true) && supported.has("tsBuildInfoFile")) names.push("tsBuildInfoFile");
  const directory = names.length ? mkdtempSync(join(project, ".sdk-output-")) : "";
  const args = names.flatMap(name => ["--" + name, join(directory, name === "generateCpuProfile" ? "compiler.cpuprofile" : name === "tsBuildInfoFile" ? "compiler.tsbuildinfo" : name)]);
  return {args, neutralized: new Set(names)};
}
/** Refuse unneutralized writers that can reach outside the copy or linked dependencies. */
export function escapingCompilerOutputs(original: Record<string, unknown>, project: string, config = join(project, "tsconfig.json"), neutralized: ReadonlySet<string> = new Set(), build = false): string[] {
  const context = dirname(config), outputs = {...original};
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
    if (neutralized.has(name) || typeof value !== "string") return false;
    const target = resolve(context, value);
    return isAbsolute(value) || relative(project, target).split(/[\\/]/).includes("node_modules") || !writableTree(project, target);
  });
}
