/** Compile author-owned consumer examples against exact installed SDK declarations. */
import { classifiedCompilerOptions, escapingCompilerOutputs, enforcedCompilerOptions, refusedCompilerOptions, type CompilerOptionPolicy } from "./sdk-compiler-policy.ts";
import { spawnSync } from "node:child_process";
import { cpSync, constants, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";

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
/** A compact row; diagnostics retain codes rather than potentially private source text. */
export interface SdkContractRow {
  /** Which declared endpoint was checked. */
  target: "minimum" | "current";
  /** Verified installed SDK version. */
  sdk: string;
  /** Consumer identity from the input. */
  example: string;
  /** True only when the consumer compiler reports no errors. */
  ok: boolean;
  /** Full diagnostic count, including diagnostics omitted from the sample. */
  diagnostic_count: number;
  /** At most three compiler diagnostic codes. */
  codes: string[];
  /** At most three diagnostics with project-relative locations; no raw messages. */
  diagnostics: SdkContractDiagnostic[];
}
/** A compiler error without source text or machine-specific paths. */
export interface SdkContractDiagnostic {
  /** TypeScript diagnostic code. */
  code: string;
  /** Project-relative source file, or a safe external/configuration marker. */
  file: string;
  /** One-based source line; zero for configuration errors. */
  line: number;
  /** One-based source column; zero for configuration errors. */
  column: number;
}
/** Native TOON/JSON-compatible matrix with no machine paths, source text or tracker content. */
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
/** Copy bytes and dereference links so compiler resolution stays inside the consumer. */
function copyConsumer(source: string, destination: string, projectOnly = false): void {
  cpSync(source, destination, { recursive: true, dereference: true, mode: constants.COPYFILE_FICLONE,
    filter: file => {
      const path = relative(source, file).replaceAll("\\", "/");
      return path !== ".git" && !(projectOnly && /(^|\/)node_modules(?:\/|$)/.test(path));
    } });
}
/** Locate an installed npm CLI without requiring Git or executable search paths. */
function npmInvocation(): {command: string; args: string[]} {
  const configured = process.env.npm_node_execpath;
  const runtime = configured && existsSync(configured) ? configured : process.execPath;
  const candidates = [process.env.npm_execpath, join(dirname(runtime), "npm"),
    join(dirname(runtime), "node_modules/npm/bin/npm-cli.js"), join(dirname(runtime), "../lib/node_modules/npm/bin/npm-cli.js")];
  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue;
    const cli = realpathSync(candidate);
    if (basename(cli) === "npm-cli.js") return {command: runtime, args: [cli]};
  }
  return {command: process.platform === "win32" ? "npm.cmd" : "npm", args: []};
}
/** Install package artifacts separately; never carry the consumer node_modules tree into a project copy. */
function installDependencies(project: string, modules: string, names?: string[]): void {
  if (!existsSync(modules)) return;
  const packages = names ?? readdirSync(modules).filter(name => !name.startsWith(".")).flatMap(name => name.startsWith("@")
    ? readdirSync(join(modules, name)).map(child => name + "/" + child) : [name]);
  const available = packages.filter(name => name !== "@unbrained/pm-cli" && existsSync(join(modules, name, "package.json")));
  const locations = new Map(available.map(name => [name, join(modules, name)]));
  if (locations.has("typescript")) {
    const nativeRoot = join(dirname(realpathSync(locations.get("typescript")!)), "@typescript");
    if (existsSync(nativeRoot)) for (const name of readdirSync(nativeRoot)) {
      const key = "@typescript/" + name;
      if (/^typescript-[a-z0-9-]+$/.test(name) && !locations.has(key)) {
        available.push(key); locations.set(key, join(nativeRoot, name));
      }
    }
  }
  const sources = available.map(name => {
    // Reuse npm's exact-version native tarball cache instead of repacking the compiler binary on every bound.
    const source = locations.get(name)!;
    return /^@typescript\/typescript-[a-z0-9-]+$/.test(name) ? name + "@" + (JSON.parse(readFileSync(join(source, "package.json"), "utf8")) as {version: string}).version : source;
  });
  if (sources.length === 0) return;
  const metadata = join(project, "package.json"), original = existsSync(metadata) ? readFileSync(metadata) : undefined;
  // Install only explicitly provisioned artifacts; peer SDK auto-installation would select an unrelated bound.
  writeFileSync(metadata, JSON.stringify({private: true}));
  // Node propagates coverage automatically unless the child explicitly disables it.
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(NODE_PATH$|NODE_OPTIONS$|NODE_V8_COVERAGE$|TS)/i.test(key) && key.toLowerCase() !== "npm_config_allow_scripts")), NODE_V8_COVERAGE: "" };
  const npm = npmInvocation();
  const result = spawnSync(npm.command, [...npm.args, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", "--install-links", "--prefer-offline", "--legacy-peer-deps", ...sources],
    {cwd: project, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024, env});
  if (original) writeFileSync(metadata, original); else rmSync(metadata, {force: true});
  if (result.status !== 0) throw new SdkContractRefusal("sdk_unavailable", "Provision installable consumer dependencies and a working npm installer; sandbox dependency installation must complete without lifecycle scripts.");
  for (const name of available.filter(name => name === "typescript" || /^@typescript\/typescript-[a-z0-9-]+$/.test(name))) {
    const source = locations.get(name)!;
    for (const path of readdirSync(source, {recursive: true}).map(String)) {
      const file = join(source, path), installed = join(project, "node_modules", name, path);
      if (statSync(file).isFile() && (!existsSync(installed) || !readFileSync(file).equals(readFileSync(installed)))) {
        throw new SdkContractRefusal("compiler_unavailable", "Provision installable compiler artifacts whose sandbox bytes match the original toolchain; the checker must use the same compiler and standard libraries.");
      }
    }
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
  throw new SdkContractRefusal("isolation_refused", "Provide a self-contained consumer and a compiler with a nonempty structured resolved-file list; use the selected SDK package import instead of an external SDK path.");
}
/** Compare complete path components, including canonical symlink destinations. */
function inside(root: string, file: string): boolean {
  const path = relative(root, file);
  return !isAbsolute(path) && path !== ".." && !path.startsWith("../") && !path.startsWith("..\\");
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
function runCompiler(project: string, compiler: string, args: string[]) {
  // Node propagates coverage automatically unless the child explicitly disables it.
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(NODE_PATH$|NODE_OPTIONS$|NODE_V8_COVERAGE$|TS)/i.test(key))), NODE_V8_COVERAGE: "" };
  let shellShim: boolean;
  try { shellShim = existsSync(compiler) && /^#![^\n]*\b(?:sh|bash)\b/.test(readFileSync(compiler, "utf8").slice(0, 256)); }
  catch { throw new SdkContractRefusal("compiler_unavailable", "Provide a readable JavaScript compiler entry or an executable shell shim with its original dependencies."); }
  const result = spawnSync(shellShim ? compiler : process.execPath, shellShim ? args : [compiler, ...args], {
    cwd: project, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    env: { ...env, GIT_CEILING_DIRECTORIES: dirname(project) },
  });
  result.stdout = stripVTControlCharacters(result.stdout ?? "")
    .replace(/^((?:.+\(\d+,\d+\): )?)\p{L}+ (TS\d+:)/gmu, "$1error $2")
    .replace(/^(.+):(\d+):(\d+) - \p{L}+ (TS\d+:)/gmu, "$1($2,$3): error $4");
  if (result.error || result.signal || result.status === null || (result.status !== 0 && !/error TS\d+:/.test(result.stdout))) throw new SdkContractRefusal("compiler_unavailable", "Provide the consumer's working TypeScript compiler; each invocation must finish within 30 seconds and 8 MiB of private output.");
  return result;
}
/** Read one compiler-produced file path per line, refusing empty or unstructured provenance. */
function compilerFiles(project: string, compiler: string, config: string, options: Record<string, unknown>, empty: boolean): string[] {
  const output = runCompiler(project, compiler, ["--project", config, "--listFilesOnly"]).stdout.trim();
  if (!output && empty) return [];
  const files: string[] = [];
  let diagnostic = false;
  const explain = options.explainFiles === true, statistics = options.diagnostics === true || options.extendedDiagnostics === true;
  for (const line of output.split(/\r?\n/)) {
    const file = isAbsolute(line) ? line : explain && !/^\s/.test(line) && existsSync(resolve(project, line)) && statSync(resolve(project, line)).isFile() ? resolve(project, line) : undefined;
    if (file !== undefined) files.push(file);
    else if (/^(?:.+\(\d+,\d+\): )?error TS\d+:/.test(line)) diagnostic = true;
    else if (!(diagnostic && /^(?:$| {2,}|\d+ |Found \d+ errors?\b)/.test(line)) &&
      !(options.traceResolution === true && files.length === 0) &&
      !(statistics && /^(?:$|[\p{L}][\p{L} /()-]*:\s+\d+(?:\.\d+)?[A-Za-z]*)$/u.test(line)) &&
      !(explain && files.length > 0 && /^(?:$| {2,}\p{L})/u.test(line))) isolationRefusal();
  }
  if (files.length === 0 || files.some(file => !existsSync(file))) isolationRefusal();
  return files.map(file => realpathSync(file));
}
/** Inspect effective output paths and checking bypasses without altering configuration. */
function isolatedConfig(project: string, compiler: string, policy: ReadonlyMap<string, CompilerOptionPolicy>): {options: Record<string, unknown>; empty: boolean} {
  let config: { compilerOptions?: Record<string, unknown>; files?: string[]; references?: {path: string}[] };
  try { config = JSON.parse(runCompiler(project, compiler, ["--project", "tsconfig.json", "--showConfig"]).stdout) as typeof config; }
  catch (error) { if (error instanceof SdkContractRefusal) throw error; isolationRefusal(); }
  if (!config.compilerOptions) isolationRefusal();
  const options = config.compilerOptions;
  const refused = refusedCompilerOptions(policy, options);
  if (refused.length) throw new SdkContractRefusal("isolation_refused", `Disable checking bypasses or command modes (${refused.join(", ")}) in the consumer configuration before retrying; the checker preserves option values.`);
  const escaping = escapingCompilerOutputs(policy, options, project);
  if (escaping.length) throw new SdkContractRefusal("isolation_refused", `Use project-relative output/cache paths contained in the project root (${escaping.join(", ")}); absolute and escaping destinations cannot be isolated without changing compiler behavior.`);
  return {options: enforcedCompilerOptions(options), empty: !config.files?.length && !!config.references?.length};
}
/** Verify only compiler-resolved inputs after compilation; source strings are never scanned. */
function verifyCompilation(project: string, compiler: string, installed: string, options: Record<string, unknown>, empty: boolean): void {
  for (const file of compilerFiles(project, compiler, "tsconfig.json", options, empty)) {
    const contained = inside(project, file), owner = contained ? owningPackage(file) : {root: "", name: ""};
    if (!contained || (owner.name === "@unbrained/pm-cli" && owner.root !== installed)) {
      const name = contained ? relative(project, file).replaceAll("\\", "/") : basename(file);
      throw new SdkContractRefusal("isolation_refused", `Resolved file ${JSON.stringify(name)} is outside the isolated project or selected SDK bound; move that dependency inside the consumer project and retry.`);
    }
  }
}
/** Refuse implicit escaping emits before tsc can write beside an external resolved source. */
function guardImplicitOutputs(project: string, compiler: string, options: Record<string, unknown>, empty: boolean): void {
  if (options.noEmit === true || options.outFile !== undefined) return;
  const root = typeof options.rootDir === "string" ? resolve(project, options.rootDir) : options.composite === true ? project : undefined;
  for (const file of compilerFiles(project, compiler, "tsconfig.json", options, empty)) {
    if (!inside(project, file) && !/\.d\.[cm]?ts$/.test(file) &&
      (options.outDir === undefined || (root !== undefined && !inside(root, file)))) {
      throw new SdkContractRefusal("isolation_refused", `Resolved source ${JSON.stringify(basename(file))} has an implicit output outside the project copy; move the source inside the project and use contained output/cache paths before retrying.`);
    }
  }
}
/** Run only the consumer compiler; every error contributes to drift without filtering codes. */
function compileConsumer(project: string, compiler: string, installed: string, policy: ReadonlyMap<string, CompilerOptionPolicy>): SdkContractDiagnostic[] {
  const {options, empty} = isolatedConfig(project, compiler, policy);
  guardImplicitOutputs(project, compiler, options, empty);
  const result = runCompiler(project, compiler, ["--project", "tsconfig.json"]);
  verifyCompilation(project, compiler, installed, options, empty);
  if (result.status === 0) return [];
  const diagnostics = [...result.stdout.matchAll(/^(?:(.+)\((\d+),(\d+)\): |)error (TS\d+):/gm)].map(match => {
    const file = match[1] === undefined ? "<config>" : relative(project, resolve(project, match[1]));
    return { code: match[4]!, file: isAbsolute(file) || file.startsWith("..") ? "<external>" : file.replaceAll("\\", "/"),
      line: Number(match[2] ?? 0), column: Number(match[3] ?? 0) };
  });
  if (diagnostics.length === 0) throw new SdkContractRefusal("compiler_unavailable", "Use a working compiler that reports structured TypeScript diagnostics for every failing compilation.");
  return diagnostics;
}
/** Prepare strict inline sources and install matching compiler and ambient artifacts. */
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
  installDependencies(project, modules, ["typescript", "undici-types", ...ambient, ...native]);
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
  const policies = new Map<string, ReadonlyMap<string, CompilerOptionPolicy>>();
  try {
    options.onProgress?.("allocated");
    const template = join(scratch, "template");
    let preparedCompiler: string;
    if (options.consumer === undefined) preparedCompiler = inlineConsumer(template, compiler);
    else {
      copyConsumer(resolve(options.consumer), template, true);
      installDependencies(template, resolve(options.consumer, "node_modules"));
      preparedCompiler = join(template, "node_modules", "typescript", "bin", "tsc");
    }
    for (const target of ["minimum", "current"] as const) {
      const project = join(scratch, target);
      // Clone only our freshly installed artifacts, never the consumer's node_modules tree.
      copyConsumer(template, project);
      const entry = inside(template, preparedCompiler) ? resolve(project, relative(template, preparedCompiler)) : preparedCompiler;
      const installed = join(project, "node_modules", "@unbrained", "pm-cli");
      rmSync(installed, { recursive: true, force: true });
      copyConsumer(targets[target].root, installed);
      targetRoot({ root: installed, version: targets[target].version });
      options.onProgress?.("linked");
      for (const example of examples) {
        if (options.consumer === undefined) writeFileSync(join(project, "consumer.ts"), example.source);
        const compilerKey = options.consumer ?? compiler;
        let policy = policies.get(compilerKey);
        if (!policy) {
          const help = runCompiler(project, entry, ["--help", "--all", "--locale", "en"]).stdout;
          try { policy = classifiedCompilerOptions(help); }
          catch { throw new SdkContractRefusal("isolation_refused", "Classify every option in this compiler's complete help-all table in the SDK compiler policy before retrying; provide a supported compiler with English help output."); }
          policies.set(compilerKey, policy);
        }
        const diagnostics = compileConsumer(project, entry, installed, policy);
        targetRoot({ root: installed, version: targets[target].version });
        rows.push({ target, sdk: targets[target].version, example: example.id, ok: diagnostics.length === 0, diagnostic_count: diagnostics.length,
          codes: diagnostics.slice(0, 3).map(diagnostic => diagnostic.code), diagnostics: diagnostics.slice(0, 3) });
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
