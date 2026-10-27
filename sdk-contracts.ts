/** Compile author-owned consumer examples against exact installed SDK declarations. */
import { supportedWriterOptions, escapingCompilerOutputs, compilerWriterArguments } from "./sdk-compiler-policy.ts";
import { spawnSync } from "node:child_process";
import { cpSync, constants, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, readlinkSync, lstatSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

/** An exact, independently provisioned published SDK installation; never modified. */
export interface SdkContractTarget {
  /** Published three-part version expected in the installed package metadata. */
  version: string;
  /** Directory containing the SDK's package.json and emitted declarations. */
  root: string;
}
/** A real consumer source; compiled but never executed by the checker. */
export interface SdkConsumerExample {
  /** Stable agent-facing name, independent of source paths. */
  id: string;
  /** TypeScript ESM consumer code, limited to 64 KiB per example. */
  source: string;
}
/** Observable boundaries; each call owns independent disposable storage. */
export type SdkContractPhase = "allocated" | "linked" | "compiled" | "cleanup";
/** Bounded inputs for two independently verified SDK targets. */
export interface SdkContractOptions {
  /** The extension's declared minimum supported published SDK. */
  minimum: SdkContractTarget;
  /** The explicitly selected current published SDK, pinned for repeatability. */
  current: SdkContractTarget;
  /** Author-controlled public API usage, or the shipped starter examples. */
  examples?: readonly SdkConsumerExample[];
  /** Self-contained consumer directory, including its own tsconfig and installed TypeScript. */
  consumer?: string;
  /** Compiler entry for inline examples, including JavaScript wrappers and executable shell shims. */
  compiler?: string;
  /** Optional progress observer, also useful when checking overlapping callers. */
  onProgress?: (phase: SdkContractPhase) => void;
}
/** One compiler verdict with complete diagnostics and a compact code sample. */
export interface SdkContractRow {
  /** Which declared endpoint was checked. */
  target: "minimum" | "current";
  /** Verified installed SDK version. */
  sdk: string;
  /** Consumer identity from the input. */
  example: string;
  /** True only when the consumer compiler reports no errors. */
  ok: boolean;
  /** Actual tsc exit code, including native builder error statuses. */
  exit_code: number;
  /** Full number of diagnostics returned by the compiler. */
  diagnostic_count: number;
  /** At most three compiler diagnostic codes. */
  codes: string[];
  /** Compiler diagnostics with project-relative locations and original messages. */
  diagnostics: SdkContractDiagnostic[];
}
/** One diagnostic parsed from the consumer compiler executable. */
export interface SdkContractDiagnostic {
  /** TypeScript diagnostic code. */
  code: string;
  /** Project-relative source file, or a safe external/configuration marker. */
  file: string;
  /** Compiler message with the disposable project prefix normalized. */
  message: string;
  /** One-based source line; zero for configuration errors. */
  line: number;
  /** One-based source column; zero for configuration errors. */
  column: number;
}
/** Native TOON/JSON-compatible matrix containing compiler results for each bound. */
export interface SdkContractMatrix {
  /** Artifact schema version. */
  version: 1;
  /** All selected-target consumer compilations succeeded. */
  ok: boolean;
  /** Number of independent target/example compilations. */
  checks: number;
  /** Failed consumer compilations. */
  failed: number;
  /** At most 32 rows. */
  rows: SdkContractRow[];
  /** Next action for an agent; dependency versions are never changed automatically. */
  remedy: string;
}
/** Actionable input/tooling refusals, distinct from a valid matrix with API drift. */
export class SdkContractRefusal extends Error {
  /** Stable refusal discriminator. */
  readonly code: "invalid_input" | "sdk_unavailable" | "compiler_unavailable" | "isolation_refused";
  /** Safe retry guidance without raw tool output or machine paths. */
  readonly remedy: string;
  /** Construct a typed boundary failure with a safe operator remedy. */
  constructor(code: SdkContractRefusal["code"], remedy: string) {
    super(remedy);
    this.code = code;
    this.remedy = remedy;
  }
}
/** Public authoring and certified all-status read examples, with checked return semantics. */
export const SDK_CONSUMER_EXAMPLES: readonly SdkConsumerExample[] = [
  { id: "authoring", source: `import { defineCommand, composeExtension, defineExtensionBlueprint } from "@unbrained/pm-cli/sdk/authoring";
export const extension = composeExtension(defineExtensionBlueprint({ commands: [defineCommand({
  name: "consumer greeting", description: "Return a typed greeting", run(ctx) {
    const root: string = ctx.pm_root;
    return { root };
  }
})] }));\n` },
  { id: "complete-read", source: `import { PmClient, certifyCompleteListResult } from "@unbrained/pm-cli/sdk";
export async function count(pmRoot: string): Promise<number> {
  const result = await new PmClient({ pmRoot, noExtensions: true }).listAllComplete();
  certifyCompleteListResult(result);
  return result.items.length;
}\n` },
];

/** Validate author input before creating scratch files; reject vacuous and unbounded checks. */
export function parseSdkConsumerExamples(value: unknown): readonly SdkConsumerExample[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw new SdkContractRefusal("invalid_input", "Provide 1 to 16 consumer examples with unique ids and TypeScript source.");
  const seen = new Set<string>();
  for (const entry of value as Partial<SdkConsumerExample>[]) {
    if (!entry || typeof entry.id !== "string" || !/^[a-z][a-z0-9-]{0,47}$/.test(entry.id) || seen.has(entry.id) ||
      typeof entry.source !== "string" || !entry.source.trim() || Buffer.byteLength(entry.source) > 65536 ||
      Object.keys(entry).some(key => !["id", "source"].includes(key))) throw new SdkContractRefusal("invalid_input", "Use unique lowercase example ids and nonempty TypeScript source of at most 64 KiB; only id and source are accepted.");
    seen.add(entry.id);
  }
  return structuredClone(value) as SdkConsumerExample[];
}
/** Check installation identity without loading or executing target SDK code. */
function targetRoot(target: SdkContractTarget): string {
  try {
    if (!target || !/^\d+\.\d+\.\d+$/.test(target.version) || typeof target.root !== "string" || !target.root.trim()) throw new Error("invalid target");
    const root = resolve(target.root);
    const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name?: unknown; version?: unknown };
    if (metadata.name !== "@unbrained/pm-cli" || metadata.version !== target.version) throw new Error("identity mismatch");
    return root;
  } catch {
    throw new SdkContractRefusal("sdk_unavailable", "Install the exact declared SDK versions in separate directories and pass their package roots; package name and version must match. Registry provenance remains the provisioner's responsibility.");
  }
}
/** Copy installed names and bytes without writes to caller files; rebase internal links into the copy. */
function copyConsumer(source: string, destination: string, dependency = false): void {
  source = realpathSync(source);
  const installed = dependency ? [] : [...dependencyRoots(source, source)].filter(root => root !== source && inside(source, root));
  cpSync(source, destination, { recursive: true, mode: constants.COPYFILE_FICLONE,
    filter: (file, copied) => {
      if (relative(source, file) === ".git") return false;
      if (!lstatSync(file).isSymbolicLink()) return true;
      const dependencyPath = dependency || relative(source, file).split(/[/\\]/).includes("node_modules") || installed.some(root => inside(root, file));
      if (!dependencyPath && !existsSync(file)) throw new SdkContractRefusal("isolation_refused", "Replace unresolved non-dependency symlinks with local files before retrying.");
      const linked = existsSync(file) ? realpathSync(file) : resolve(dirname(file), readlinkSync(file));
      if (!dependencyPath && !inside(source, linked)) throw new SdkContractRefusal("isolation_refused", "Materialize non-dependency symlinks whose targets leave the consumer root before retrying; external targets must remain read-only.");
      mkdirSync(dirname(copied), {recursive: true});
      if (inside(source, linked)) symlinkSync(resolve(destination, relative(source, linked)), copied);
      else symlinkSync(linked, copied);
      return false;
    } });
}
/** Detach writable containers while retaining their other entries as read-only installed links. */
function privateDirectory(project: string, path: string): void {
  const info = lstatSync(path, {throwIfNoEntry: false});
  if (!info) { mkdirSync(path, {recursive: true}); return; }
  if (!info.isSymbolicLink()) return;
  const source = existsSync(path) ? realpathSync(path) : undefined;
  if (source && inside(project, source)) return;
  unlinkSync(path); mkdirSync(path, {recursive: true});
  if (source) for (const name of readdirSync(source)) {
    const entry = join(source, name);
    symlinkSync(entry, join(path, name), existsSync(entry) && statSync(entry).isDirectory() ? "junction" : "file");
  }
}
/** Give every child private homes, caches and temporary storage with no inherited npm execution settings. */
function subprocessEnvironment(project: string): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(project, ".sdk-process-")), cache = join(home, "cache"), temporary = join(home, "tmp");
  mkdirSync(cache, {recursive: true}); mkdirSync(temporary, {recursive: true});
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(npm_config_|NODE_PATH$|NODE_OPTIONS$|NODE_V8_COVERAGE$|NODE_COMPILE_CACHE$|BUN_RUNTIME_TRANSPILER_CACHE_PATH$|TS)/i.test(key))),
    HOME: home, USERPROFILE: home, XDG_CACHE_HOME: cache, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home,
    TMPDIR: temporary, TMP: temporary, TEMP: temporary, NODE_V8_COVERAGE: "", GIT_CEILING_DIRECTORIES: dirname(project) };
}
/** Retain only registry connection and scoped credentials; installation policy belongs to the checker. */
function registryConfiguration(project: string): void {
  const file = join(project, ".npmrc");
  if (!existsSync(file)) return;
  const allowed = readFileSync(file, "utf8").split(/\r?\n/).filter(line => {
    const key = line.match(/^\s*([^=;#]+?)\s*=/)?.[1];
    return key !== undefined && /^(?:registry|@[a-z0-9_.-]+:registry|strict-ssl|ca(?:\[\])?|cafile|\/\/[^\s=]+\/:(?:_authToken|_auth|username|_password|email|always-auth))$/i.test(key);
  });
  rmSync(file, {force: true});
  writeFileSync(file, allowed.join("\n") + "\n");
}
/** Provision only generated inline projects from installed compiler and ambient artifacts. */
function materializeInlineDependencies(project: string, modules: string, names: string[]): void {
  const destination = join(project, "node_modules");
  privateDirectory(project, destination);
  for (const name of names) if (existsSync(join(modules, name))) {
    privateDirectory(project, dirname(join(destination, name)));
    copyConsumer(join(modules, name), join(destination, name), true);
  }
  // A linked compiler can own native companions beside its canonical package root.
  const typescript = join(modules, "typescript");
  if (existsSync(typescript)) {
    const nativeRoot = join(dirname(realpathSync(typescript)), "@typescript");
    if (existsSync(nativeRoot)) for (const name of readdirSync(nativeRoot)) {
      const installed = join(destination, "@typescript", name);
      if (/^typescript-[a-z0-9-]+$/.test(name) && !existsSync(installed)) {
        privateDirectory(project, dirname(installed));
        rmSync(installed, {recursive: true, force: true});
        copyConsumer(join(nativeRoot, name), installed, true);
      }
    }
  }
}
/** Enumerate installed directory names without dereferencing absent scoped links. */
function installedNames(modules: string): string[] {
  return readdirSync(modules).flatMap(name => name.startsWith("@")
    ? existsSync(join(modules, name)) ? readdirSync(join(modules, name)).map(child => name + "/" + child) : [] : [name]);
}
/** Retain typed malformed installed-package refusals without using metadata to choose installation names. */
function validateDependencies(project: string): void {
  const modules = join(project, "node_modules");
  const names = installedNames(modules).filter(name => !name.startsWith("."));
  for (const name of names) {
    const file = join(modules, name, "package.json");
    if (!existsSync(file)) continue;
    try {
      const metadata: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("invalid metadata");
    } catch { throw new SdkContractRefusal("sdk_unavailable", "Provide installed dependency packages with valid package metadata before retrying; installed directory names are preserved."); }
  }
}
/** Execute the identical installed compiler artifact inside the copy so its libraries are isolated too. */
function installedCompiler(project: string, entry: string): string {
  if (!existsSync(entry)) return entry;
  const canonical = realpathSync(entry), owner = owningPackage(canonical);
  return owner.name === "typescript" ? join(project, "node_modules", "typescript", relative(owner.root, canonical)) : entry;
}
/** Refuse unsafe resolution without exposing source text or machine paths. */
function isolationRefusal(): never {
  throw new SdkContractRefusal("isolation_refused", "Provide a self-contained consumer and a compiler with a complete JSON source inventory; use the selected SDK package import instead of an external SDK path.");
}
/** Compare complete path components, including canonical symlink destinations. */
function inside(root: string, file: string): boolean {
  const path = relative(root, file);
  return !isAbsolute(path) && path !== ".." && !path.startsWith("../") && !path.startsWith("..\\");
}
/** Name malformed paths without exposing an absolute host or scratch prefix. */
function pathLabel(value: unknown): string {
  return typeof value !== "string" ? "<missing>" : isAbsolute(value) ? join(basename(dirname(value)), basename(value)) : value;
}
/** Canonicalize both existing files and missing compiler inputs through their nearest real ancestor. */
function canonicalPath(path: string): string {
  try {
    let ancestor = path;
    const root = parse(path).root;
    while (ancestor !== root && !existsSync(ancestor)) {
      if (lstatSync(ancestor, {throwIfNoEntry: false})) throw new Error("unresolved link");
      ancestor = dirname(ancestor);
    }
    return resolve(realpathSync(ancestor), relative(ancestor, path));
  } catch { throw new SdkContractRefusal("isolation_refused", `Compiler path ${JSON.stringify(pathLabel(path))} has no representable canonical destination; materialize unresolved links before retrying.`); }
}
/** Locate package ownership using metadata, never substring matches on diagnostic text. */
function owningPackage(file: string): { root: string; name: string } {
  let root = dirname(file);
  while (!existsSync(join(root, "package.json")) && dirname(root) !== root) root = dirname(root);
  try {
    const metadata = existsSync(join(root, "package.json")) ? JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name?: string } : {};
    return { root, name: metadata.name ?? "" };
  } catch { return {root, name: ""}; }
}
/** Invoke JavaScript compiler entries in their original module context with clean resolution state. */
function runCompiler(project: string, compiler: string, args: string[], discardOutput = false) {
  const env = subprocessEnvironment(project);
  let shellShim: boolean;
  try { shellShim = existsSync(compiler) && /^#![^\n]*\b(?:sh|bash)\b/.test(readFileSync(compiler, "utf8").slice(0, 256)); }
  catch { throw new SdkContractRefusal("compiler_unavailable", "Provide a readable JavaScript compiler entry or an executable shell shim with its original dependencies."); }
  const result = spawnSync(shellShim ? compiler : process.execPath, shellShim ? args : [compiler, ...args], {
    cwd: project, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    env, stdio: discardOutput ? "ignore" : "pipe",
  });
  const stdout = result.stdout ?? "";
  if (result.error || result.signal || result.status === null || (args.includes("--help") && result.status !== 0)) throw new SdkContractRefusal("compiler_unavailable", "Provide the consumer's working TypeScript compiler; each invocation must finish within 30 seconds and 8 MiB of private output.");
  return {...result, stdout, status: result.status};
}
/** Keep the compiler output channel limited to diagnostics; these flags do not change checking. */
const diagnosticPresentation = ["pretty", "traceResolution", "explainFiles", "diagnostics", "extendedDiagnostics", "listFiles", "listEmittedFiles"].flatMap(name => ["--" + name, "false"]);

/** Read compiler source paths through its JSON trace, never its ambiguous line-oriented file list. */
function compilerFiles(project: string, compiler: string, empty: boolean, config: string, writers: string[], failed = false): string[] {
  const trace = mkdtempSync(join(dirname(project), "resolved-files-"));
  // Resolution-only mode emits a textual list; discard it in the OS, before any parent-side transport.
  const result = runCompiler(project, compiler, ["--project", config, "--listFilesOnly", "--noEmit", ...writers, "--tsBuildInfoFile", join(trace, "state.tsbuildinfo"), "--generateTrace", trace, ...diagnosticPresentation, "--locale", "en"], true);
  const report = join(trace, "trace.json");
  if (!existsSync(report) && failed && result.status !== 0) return [];
  let events: unknown;
  try { events = JSON.parse(readFileSync(report, "utf8")); } catch { isolationRefusal(); }
  if (!Array.isArray(events)) isolationRefusal();
  const files = new Set<string>();
  for (const event of events as {name?: unknown; args?: {path?: unknown}}[]) {
    if (event?.name !== "createSourceFile") continue;
    const path = event.args?.path;
    if (typeof path !== "string" || !isAbsolute(path) || (existsSync(path) && !statSync(path).isFile())) throw new SdkContractRefusal("isolation_refused", `Compiler source path ${JSON.stringify(pathLabel(path))} cannot be represented as an absolute file; provide a complete JSON compiler trace.`);
    files.add(path);
  }
  if (!files.size && !empty && result.status === 0) isolationRefusal();
  return [...files];
}
/** Resolve package links once per real path, including mutually linked external dependencies. */
function dependencyRoots(project: string, context: string, compiler?: string): Set<string> {
  const visited = new Set<string>();
  const visit = (modules: string): void => {
    if (!existsSync(modules)) return;
    const container = realpathSync(modules);
    if (visited.has(container)) return;
    visited.add(container);
    const names = installedNames(modules);
    for (const name of names) {
      const path = join(modules, name);
      if (!existsSync(path) || !statSync(path).isDirectory()) continue;
      const root = realpathSync(path);
      if (visited.has(root)) continue;
      visited.add(root);
      visit(join(root, "node_modules"));
    }
  };
  visit(join(project, "node_modules"));
  if (context !== project) visit(join(context, "node_modules"));
  if (!compiler) return visited;
  const typescript = join(project, "node_modules/typescript"), owner = owningPackage(realpathSync(compiler));
  const compilers = new Set<string>();
  if (existsSync(typescript)) compilers.add(realpathSync(typescript));
  if (owner.name && owner.root !== dirname(owner.root)) compilers.add(owner.root);
  for (const root of compilers) { visited.add(root); visit(join(dirname(root), "@typescript")); }
  return visited;
}
/** Read effective writer paths and references without altering configuration. */
function isolatedConfig(project: string, compiler: string, file: string): {empty: boolean; references: string[]; options: Record<string, unknown> | undefined} {
  let config: { compilerOptions?: Record<string, unknown>; files?: string[]; references?: {path: string}[] };
  try {
    const inspected = runCompiler(project, compiler, ["--project", file, "--showConfig"]);
    if (inspected.status !== 0) {
      if (compilerDiagnostics(project, inspected.stdout).length) return {empty: false, references: [], options: undefined};
      throw new SdkContractRefusal("compiler_unavailable", "Provide a compiler that can inspect this project configuration before invoking the isolated typecheck.");
    }
    config = JSON.parse(inspected.stdout) as typeof config;
  }
  catch (error) { if (error instanceof SdkContractRefusal) throw error; isolationRefusal(); }
  if (!config.compilerOptions) isolationRefusal();
  const options = config.compilerOptions;
  return {empty: !config.files?.length && !!config.references?.length, options, references: (config.references ?? []).map(reference => resolve(dirname(file), reference.path))};
}
/** Check actual compiler-resolved inputs; installed external packages stay linked and read-only. */
function verifyCompilation(project: string, compiler: string, installed: string, empty: boolean, config: string, writers: string[], failed = false): string[] {
  const roots = dependencyRoots(project, dirname(config), compiler);
  const files = compilerFiles(project, compiler, empty, config, writers, failed);
  for (const path of files) {
    const file = canonicalPath(path), contained = inside(canonicalPath(project), file), owner = owningPackage(file);
    if (!failed && !existsSync(file)) throw new SdkContractRefusal("isolation_refused", `Compiler source path ${JSON.stringify(pathLabel(path))} has no readable file after a successful compilation; provide a lossless JSON source inventory.`);
    if ((!contained && ![...roots].some(root => inside(canonicalPath(root), file))) || (owner.name === "@unbrained/pm-cli" && canonicalPath(owner.root) !== canonicalPath(installed))) {
      const name = contained ? relative(canonicalPath(project), file).replaceAll(sep, "/") : basename(file);
      throw new SdkContractRefusal("isolation_refused", `Resolved file ${JSON.stringify(name)} is outside the isolated project or selected SDK bound (parent ${JSON.stringify(basename(dirname(file)))}); move that dependency inside the consumer project and retry.`);
    }
  }
  return files;
}
/** Match diagnostic locations against JSON paths, including embedded CR/LF, without splitting paths. */
function compilerDiagnostics(project: string, output: string, files: readonly string[] = []): SdkContractDiagnostic[] {
  const locations = [...new Set([...files, join(project, "tsconfig.json")].flatMap(file => [file, relative(project, file)]).map(file => file.replaceAll(sep, "/")))].sort((a, b) => b.length - a.length);
  const headers: {start: number; end: number; diagnostic: SdkContractDiagnostic}[] = [];
  const matches = [...output.matchAll(/(?:\((\d+),(\d+)\): |^|(?<=\n))error (TS\d+): /g)];
  for (const match of matches.sort((a, b) => Number(b[1] !== undefined) - Number(a[1] !== undefined))) {
    if (match[1] === undefined && headers.some(header => header.start <= match.index && match.index < header.end)) continue;
    let start = match.index, file = "<config>";
    if (match[1] !== undefined) {
      const path = locations.find(path => output.slice(start - path.length, start) === path && (start === path.length || output[start - path.length - 1] === "\n"));
      if (path === undefined) throw new SdkContractRefusal("isolation_refused", `Compiler diagnostic path ${JSON.stringify(pathLabel(output.slice(0, start)))} is absent from the JSON source inventory; provide a compiler with complete path transport.`);
      start -= path.length;
      const absolute = resolve(project, path);
      file = inside(project, absolute) ? relative(project, absolute).replaceAll(sep, "/") : "<external>";
    }
    headers.push({start, end: match.index + match[0].length, diagnostic: {code: match[3]!, file, line: Number(match[1] ?? 0), column: Number(match[2] ?? 0), message: ""}});
  }
  return headers.sort((a, b) => a.start - b.start).map((header, index) => ({...header.diagnostic, message: output.slice(header.end, headers[index + 1]?.start).replaceAll(project, ".").trimEnd()}));
}
/** Delegate verdict, fatal-error ordering, global diagnostics and references to the actual tsc. */
function compileConsumer(project: string, compiler: string, installed: string, supported: ReadonlySet<string>, output: string): {ok: boolean; exit_code: number; diagnostics: SdkContractDiagnostic[]} {
  const config = join(project, "tsconfig.json"), root = isolatedConfig(project, compiler, config);
  const projects = new Map([[config, root]]), seen = new Set([realpathSync(config)]);
  // Build can write incremental metadata: inspect its self-contained reference graph first.
  const visit = (path: string): void => {
    const file = existsSync(path) && statSync(path).isDirectory() ? join(path, "tsconfig.json") : path;
    if (!inside(project, file) || (existsSync(file) && !inside(project, realpathSync(file)))) isolationRefusal();
    if (!existsSync(file) || seen.has(realpathSync(file))) return;
    seen.add(realpathSync(file));
    const settings = isolatedConfig(project, compiler, file);
    projects.set(file, settings);
    for (const reference of settings.references) visit(reference);
  };
  const build = root.empty;
  if (build) for (const reference of root.references) visit(reference);
  // Failed inspection can still precede writes: conservatively redirect every known writer.
  const unknownWriters = {incremental: true, ...Object.fromEntries(["generateTrace", "generateCpuProfile", "pprofDir"].filter(name => supported.has(name)).map(name => [name, ""]))};
  if (build && [...projects.values()].some(settings => !settings.options)) isolationRefusal();
  const writing: Record<string, unknown> = {...root.options ?? unknownWriters};
  for (const settings of projects.values()) for (const name of ["generateTrace", "generateCpuProfile", "pprofDir"]) if (typeof settings.options?.[name] === "string") writing[name] = settings.options![name];
  const writers = compilerWriterArguments(supported, writing, output, build);
  // Native build mode rejects CLI metadata overrides (TS5094); protect every actual input.
  const inputs = new Set(build ? [...seen, ...[...projects].flatMap(([file, settings]) => compilerFiles(project, compiler, settings.empty, file, writers.args)).map(file => canonicalPath(file))] : []);
  for (const [file, settings] of projects) {
    const escaping = escapingCompilerOutputs(settings.options ?? unknownWriters, project, file, writers.neutralized, build, inputs);
    if (escaping.length) throw new SdkContractRefusal("isolation_refused", `Confine compiler writers (${escaping.join(", ")}) to the disposable project; linked dependencies and compiler inputs cannot be overwritten.`);
  }
  const args = [build ? "--build" : "--project", "tsconfig.json", ...build ? ["--force"] : root.options?.composite === true ? [] : ["--incremental", "false"], "--noEmit", ...writers.args, ...diagnosticPresentation, ...build ? [] : ["--locale", "en"]];
  const result = runCompiler(project, compiler, args);
  const files = [...projects].flatMap(([file, settings]) => verifyCompilation(project, compiler, installed, settings.empty, file, writers.args, result.status !== 0));
  const diagnostics = result.status === 0 ? [] : compilerDiagnostics(project, result.stdout, files);
  if (result.status !== 0 && !diagnostics.length) throw new SdkContractRefusal("compiler_unavailable", "Provide the consumer's real tsc executable with pretty-false error diagnostics; the compiler exited unsuccessfully without a diagnostic header.");
  return {ok: result.status === 0, exit_code: result.status, diagnostics};
}
/** Prepare strict inline sources and copy matching compiler and ambient artifacts. */
function inlineConsumer(project: string, compiler: string): string {
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    strict: true, noEmit: true, skipLibCheck: false, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: ["node"],
  }, files: ["consumer.ts"] }));
  const entry = resolve(compiler);
  const parts = entry.split(/[/\\]node_modules[/\\]/);
  const modules = parts.length > 1 ? join(parts.slice(0, -1).join("/node_modules/"), "node_modules") : dirname(dirname(dirname(resolveSdkContractCompiler())));
  const ambient = existsSync(join(modules, "@types")) ? readdirSync(join(modules, "@types")).map(name => "@types/" + name) : [];
  const native = existsSync(join(modules, "@typescript")) ? readdirSync(join(modules, "@typescript")).map(name => "@typescript/" + name) : [];
  materializeInlineDependencies(project, modules, ["typescript", "undici-types", ...ambient, ...native]);
  return installedCompiler(project, entry);
}
/** Locate a compiler only when the caller did not supply one; omit-dev installs get a remedy. */
export function resolveSdkContractCompiler(from: string = import.meta.url): string {
  try {
    return join(dirname(createRequire(from).resolve("typescript/package.json")), "bin", "tsc");
  } catch {
    throw new SdkContractRefusal("compiler_unavailable", "Install TypeScript or pass --compiler pointing to its executable JavaScript entry.");
  }
}
/** Compile real declarations with original option values and disposable output/cache storage. */
export async function checkSdkContracts(options: SdkContractOptions): Promise<SdkContractMatrix> {
  if (options.consumer !== undefined && (typeof options.consumer !== "string" || !options.consumer.trim() || options.examples !== undefined || options.compiler !== undefined)) throw new SdkContractRefusal("invalid_input", "Provide either a self-contained consumer directory or inline examples and an optional compiler.");
  const examples = options.consumer === undefined ? parseSdkConsumerExamples(options.examples ?? SDK_CONSUMER_EXAMPLES) : [{ id: "consumer", source: "" }];
  const targets = { minimum: { ...options.minimum, root: targetRoot(options.minimum) }, current: { ...options.current, root: targetRoot(options.current) } };
  const compiler = options.compiler ?? (options.consumer === undefined ? resolveSdkContractCompiler() : "");
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "pm-sdk-contract-")));
  const rows: SdkContractRow[] = [];
  const writers = new Map<string, ReadonlySet<string>>();
  try {
    options.onProgress?.("allocated");
    const template = join(scratch, "template");
    let preparedCompiler: string;
    if (options.consumer === undefined) preparedCompiler = inlineConsumer(template, compiler);
    else {
      copyConsumer(resolve(options.consumer), template);
      privateDirectory(template, join(template, "node_modules"));
      const bin = join(template, "node_modules/.bin/tsc");
      preparedCompiler = existsSync(bin) ? bin : join(template, "node_modules/typescript/bin/tsc");
    }
    validateDependencies(template);
    registryConfiguration(template);
    for (const target of ["minimum", "current"] as const) {
      const project = join(scratch, target);
      // Clone the consumer-owned resolution unchanged, then replace only the selected SDK.
      copyConsumer(template, project);
      const entry = inside(template, preparedCompiler) ? resolve(project, relative(template, preparedCompiler)) : preparedCompiler;
      const installed = join(project, "node_modules", "@unbrained", "pm-cli");
      privateDirectory(project, dirname(installed));
      rmSync(installed, { recursive: true, force: true });
      copyConsumer(targets[target].root, installed, true);
      targetRoot({ root: installed, version: targets[target].version });
      const installedRoot = realpathSync(installed);
      options.onProgress?.("linked");
      for (const example of examples) {
        if (options.consumer === undefined) writeFileSync(join(project, "consumer.ts"), example.source);
        const compilerKey = options.consumer ?? compiler;
        let supported = writers.get(compilerKey);
        if (!supported) {
          supported = supportedWriterOptions(runCompiler(project, entry, ["--help", "--all", "--locale", "en"]).stdout);
          writers.set(compilerKey, supported);
        }
        const {ok, exit_code, diagnostics} = compileConsumer(project, entry, installedRoot, supported, mkdtempSync(join(scratch, "compiler-output-")));
        targetRoot({ root: installed, version: targets[target].version });
        rows.push({ target, sdk: targets[target].version, example: example.id, ok, exit_code, diagnostic_count: diagnostics.length,
          codes: diagnostics.slice(0, 3).map(diagnostic => diagnostic.code), diagnostics });
        options.onProgress?.("compiled");
      }
    }
  } finally {
    // Remove only this invocation's exclusive allocation, never caller/peer paths.
    try { options.onProgress?.("cleanup"); } finally { rmSync(scratch, { recursive: true, force: true }); }
  }
  const failed = rows.filter(row => !row.ok).length;
  return { version: 1, ok: failed === 0, checks: rows.length, failed, rows,
    remedy: failed === 0 ? "Keep these examples in the release gate." : "Restore the consumed public API or deliberately revise the compatibility promise and consumer example; dependency bumps remain separate." };
}
