/** Compile author-owned consumer examples against exact installed SDK declarations. */
import { spawnSync } from "node:child_process";
import { cpSync, constants, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, readlinkSync, lstatSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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
  /** Entry inside the installed TypeScript artifact selected for inline examples. */
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
  /** Compiler API status: zero for success, one when error diagnostics exist. */
  exit_code: number;
  /** Full number of diagnostics returned by the compiler. */
  diagnostic_count: number;
  /** At most three compiler diagnostic codes. */
  codes: string[];
  /** Compiler diagnostics with project-relative locations and original messages. */
  diagnostics: SdkContractDiagnostic[];
}
/** One structured diagnostic returned by the consumer compiler API. */
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
  readonly code: "invalid_input" | "sdk_unavailable" | "compiler_unavailable" | "compiler_api_unavailable" | "unsupported_project_shape" | "isolation_refused";
  /** Safe retry guidance without raw tool output or machine paths. */
  readonly remedy: string;
  /** Stable explanation for the single-SDK-copy project-shape refusal. */
  readonly reason: "multiple_sdk_copies" | undefined;
  /** Canonical SDK declaration roots expressed relative to the prepared consumer. */
  readonly roots: readonly string[] | undefined;
  /** Construct a typed boundary failure with a safe operator remedy. */
  constructor(code: SdkContractRefusal["code"], remedy: string, details?: {reason: "multiple_sdk_copies"; roots: string[]}) {
    super(remedy);
    this.code = code;
    this.remedy = remedy;
    this.reason = details?.reason;
    this.roots = details?.roots.slice();
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
  const installed = dependency ? [] : [...dependencyRoots(source)].filter(root => root !== source && inside(source, root));
  cpSync(source, destination, { recursive: true, mode: constants.COPYFILE_FICLONE,
    filter: (file, copied) => {
      if (relative(source, file) === ".git") return false;
      const components = relative(source, file).split(sep);
      if (!lstatSync(file).isSymbolicLink()) return true;
      const dependencyPath = dependency || components.includes("node_modules") || installed.some(root => inside(root, file));
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
/** Refuse unsafe resolution without exposing source text or machine paths. */
function isolationRefusal(): never {
  throw new SdkContractRefusal("isolation_refused", "Provide a self-contained consumer with complete structured compiler diagnostics and resolver identities; use the selected SDK package import instead of an external SDK path.");
}
/** Compare complete path components, including canonical symlink destinations. */
function inside(root: string, file: string): boolean {
  const path = relative(root, file);
  return !isAbsolute(path) && path !== ".." && !path.startsWith("../") && !path.startsWith("..\\");
}
/** Resolve package links once per real path, including mutually linked external dependencies. */
function dependencyRoots(project: string): Set<string> {
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
  return visited;
}
/** Run the consumer compiler API in a confined child; JSON is the only result channel. */
function compileConsumer(project: string, installed: string, version: string, output: string): {ok: boolean; exit_code: number; diagnostics: SdkContractDiagnostic[]} {
  let api: string;
  try {
    const installedCompiler = realpathSync(join(project, "node_modules/typescript"));
    api = realpathSync(createRequire(join(project, "package.json")).resolve("typescript"));
    if (!inside(installedCompiler, api)) throw new Error("foreign compiler API");
  }
  catch { throw new SdkContractRefusal("compiler_unavailable", "Install the consumer TypeScript JavaScript compiler API before retrying."); }
  const entry = join(output, "compiler.cjs"), resultFile = join(output, "diagnostics.json");
  writeFileSync(entry, `const ts=require(${JSON.stringify(api)}),fs=require('node:fs'),path=require('node:path');
const project=fs.realpathSync(process.argv[2]),installed=fs.realpathSync(process.argv[3]),version=process.argv[4];
const finish=report=>fs.writeFileSync(process.argv[6],JSON.stringify(report),{flag:'wx'});
if(!['createProgram','getPreEmitDiagnostics','getParsedCommandLineOfConfigFile'].every(name=>typeof ts[name]==='function')){
 finish({refusal:'compiler_unavailable',remedy:'Install a consumer TypeScript version exposing createProgram, getPreEmitDiagnostics and getParsedCommandLineOfConfigFile.'});
}else{
 ts.sys.write=()=>{};ts.sys.writeFile=()=>{throw new Error('Compiler API is read-only');};
 const canonical=file=>{try{return fs.realpathSync(file);}catch{throw {refusal:'isolation_refused',remedy:'Compiler path '+JSON.stringify(typeof file==='string'?path.basename(file):'<missing>')+' has no readable canonical destination.'};}},inside=(root,file)=>{const r=path.relative(root,file);return !path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep);};
 /** Find a known canonical ancestor without filesystem reads or metadata inference. */
 const closestRoot=(file,roots)=>{for(let root=path.dirname(file);;root=path.dirname(root)){if(roots.has(root))return root;if(path.dirname(root)===root)return undefined;}};
 const label=file=>inside(project,file)?path.relative(project,file):path.basename(file);
 const refused=file=>{throw {refusal:'isolation_refused',remedy:'Resolved file '+JSON.stringify(label(file))+' leaves the prepared project and installed dependencies.'};};
 const diagnostics=[],roots=new Set(JSON.parse(process.argv[5]).map(canonical)),sdkFiles=new Set(),owners=new Map();
 /** Cache each file's nearest named package root; unnamed format-only metadata never masks its owner. */
 function packageOwner(directory){
  if(owners.has(directory))return owners.get(directory);
  const metadata=path.join(directory,'package.json');let owner;
  try{if(fs.statSync(metadata,{throwIfNoEntry:false})?.isFile()){
   const data=JSON.parse(fs.readFileSync(metadata,'utf8'));
   if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Invalid metadata');
   if(typeof data.name==='string'&&data.name)owner={root:canonical(directory),name:data.name};
  }}catch{throw {refusal:'isolation_refused',remedy:'Provide readable package metadata at '+JSON.stringify(label(metadata))+'.'};}
  const parent=path.dirname(directory);owner??=parent===directory?undefined:packageOwner(parent);owners.set(directory,owner);return owner;
 }
 const isSdk=name=>name==='@unbrained/pm-cli'||name.startsWith('@unbrained/pm-cli/');
 const record=d=>{if(d.category!==ts.DiagnosticCategory.Error)return;const location=d.file&&d.start!==undefined?d.file.getLineAndCharacterOfPosition(d.start):undefined;
 diagnostics.push({code:'TS'+d.code,file:d.file?(inside(project,canonical(d.file.fileName))?path.relative(project,canonical(d.file.fileName)).split(path.sep).join('/'):'<external>'):'<config>',message:ts.flattenDiagnosticMessageText(d.messageText,'\\n').replaceAll(project,'.'),line:location?location.line+1:0,column:location?location.character+1:0});};
 function collectImports(program,source,file){
  if(Array.isArray(source.imports)&&!source.imports.some(specifier=>isSdk(specifier.text)))return;
  const accept=(result,name)=>{if(isSdk(name)&&result?.resolvedModule)sdkFiles.add(canonical(result.resolvedModule.resolvedFileName));};
  if(typeof program.forEachResolvedModule==='function'){program.forEachResolvedModule(accept,source);return;}
  if(Array.isArray(source.imports)&&typeof program.getResolvedModuleFromModuleSpecifier==='function'){
   for(const specifier of source.imports)accept(program.getResolvedModuleFromModuleSpecifier(specifier,source),specifier.text);
  }else if(Array.isArray(source.imports)&&typeof program.getModeForUsageLocation==='function'&&typeof program.getResolvedModule==='function'){
   for(const specifier of source.imports)accept(program.getResolvedModule(source,specifier.text,program.getModeForUsageLocation(source,specifier)),specifier.text);
  }else throw {refusal:'compiler_api_unavailable',remedy:'Consumer Program must expose usage-mode module resolutions for '+JSON.stringify(label(file))+'.'};
 }
 /** Every SDK declaration is owned by its own package, including copies vendored inside another dependency. */
 function verifySdkCopies(program){
  const sdkRoots=new Set([installed]),files=program.getSourceFiles().map(source=>({source,file:canonical(source.fileName)}));
  for(const {source,file} of files)collectImports(program,source,file);
  for(const file of new Set([...files.map(entry=>entry.file),...sdkFiles])){
   const owner=packageOwner(path.dirname(file));
   if(owner?.name==='@unbrained/pm-cli')sdkRoots.add(owner.root);
   else if(sdkFiles.has(file)&&!inside(installed,file))sdkRoots.add(owner?.root??path.dirname(file));
  }
  if(sdkRoots.size>1){
   const roots=[...sdkRoots].map(root=>(path.relative(project,root)||'.').split(path.sep).join('/')).sort();
   throw {refusal:'unsupported_project_shape',reason:'multiple_sdk_copies',roots,remedy:'multiple_sdk_copies: SDK declaration roots '+JSON.stringify(roots)+'. Dedupe to one @unbrained/pm-cli package and resolve SDK imports to the selected root.'};
  }
  for(const {file} of files)if(!inside(project,file)&&!closestRoot(file,roots))refused(file);
 }
 const checkRoot=config=>{
  if(!inside(project,config)||(fs.existsSync(config)&&!inside(project,canonical(config))))refused(config);
  const fatal=[],parsed=ts.getParsedCommandLineOfConfigFile(config,{noEmit:true},{...ts.sys,onUnRecoverableConfigFileDiagnostic:d=>fatal.push(d)});
  if(!parsed){fatal.forEach(record);return;}
  if(parsed.projectReferences?.length){
   const reference=ts.resolveProjectReferencePath(parsed.projectReferences[0]);
   throw {refusal:'unsupported_project_shape',remedy:'Project references are unsupported: '+JSON.stringify(path.relative(project,config))+' references '+JSON.stringify(path.relative(project,reference))+'. Check each referenced project separately as its own root, or flatten the references; referenced declarations must be regenerated for each SDK bound.'};
  }
  const options=parsed.options;options.noEmit=true;options.generateTrace=undefined;options.generateCpuProfile=undefined;options.pprofDir=undefined;
  const program=ts.createProgram({rootNames:parsed.fileNames,options,configFileParsingDiagnostics:parsed.errors});
  ts.getPreEmitDiagnostics(program).forEach(record);
  verifySdkCopies(program);
 };
 try{
  checkRoot(path.join(project,'tsconfig.json'));
  finish({ok:!diagnostics.length,exit_code:diagnostics.length?1:0,diagnostics});
 }catch(error){if(error.refusal)finish(error);else throw error;}
}`);
  const result = spawnSync(process.execPath, [entry, project, installed, version, JSON.stringify([...dependencyRoots(project)]), resultFile], {
    cwd: project, encoding: "utf8", timeout: 90000, maxBuffer: 8 * 1024 * 1024, env: subprocessEnvironment(project), stdio: ["ignore", "ignore", "pipe"],
  });
  if (result.error || result.signal || result.status !== 0 || !existsSync(resultFile) || !lstatSync(resultFile).isFile() || statSync(resultFile).size > 8 * 1024 * 1024) {
    const failure = result.error ? (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT" ? "deadline" : "spawn/buffer" : result.signal ? "signal" : result.status !== 0 ? "exit" : "result channel";
    throw new SdkContractRefusal("compiler_unavailable", `Compiler API worker failed (${failure}); provide a working consumer API within 90 seconds and 8 MiB of JSON.`);
  }
  let report: {refusal?: SdkContractRefusal["code"]; remedy?: string; ok: boolean; exit_code: number; diagnostics: SdkContractDiagnostic[]; reason?: "multiple_sdk_copies"; roots?: string[]};
  try { report = JSON.parse(readFileSync(resultFile, "utf8")) as typeof report; }
  catch { isolationRefusal(); }
  if (!report || typeof report !== "object") isolationRefusal();
  if (report.refusal) {
    if (!["invalid_input", "sdk_unavailable", "compiler_unavailable", "compiler_api_unavailable", "unsupported_project_shape", "isolation_refused"].includes(report.refusal) || typeof report.remedy !== "string") isolationRefusal();
    if (report.reason !== undefined || report.roots !== undefined) {
      if (report.refusal !== "unsupported_project_shape" || report.reason !== "multiple_sdk_copies" || !Array.isArray(report.roots) || !report.roots.length || report.roots.some(root => typeof root !== "string" || isAbsolute(root))) isolationRefusal();
    }
    throw new SdkContractRefusal(report.refusal, report.remedy, report.reason ? {reason: report.reason, roots: report.roots!} : undefined);
  }
  if (typeof report.ok !== "boolean" || !Array.isArray(report.diagnostics) || report.exit_code !== Number(!report.ok)) isolationRefusal();
  if (report.diagnostics.some(diagnostic => !diagnostic || typeof diagnostic.file !== "string" || typeof diagnostic.message !== "string" || !/^TS\d+$/.test(diagnostic.code) || !Number.isSafeInteger(diagnostic.line) || diagnostic.line < 0 || !Number.isSafeInteger(diagnostic.column) || diagnostic.column < 0)) isolationRefusal();
  if (report.ok !== (report.diagnostics.length === 0)) isolationRefusal();
  return report;
}

/** Prepare strict inline sources and copy matching compiler and ambient artifacts. */
function inlineConsumer(project: string, compiler: string): void {
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    strict: true, noEmit: true, skipLibCheck: false, target: "ES2022", lib: ["ES2022"], module: "NodeNext", moduleResolution: "NodeNext", types: ["node"],
  }, files: ["consumer.ts"] }));
  const entry = resolve(compiler);
  if (!existsSync(entry) || !statSync(entry).isFile()) throw new SdkContractRefusal("compiler_unavailable", "Provide an installed TypeScript compiler entry and its JavaScript API.");
  const parts = entry.split(/[/\\]node_modules[/\\]/);
  const modules = parts.length > 1 ? join(parts.slice(0, -1).join("/node_modules/"), "node_modules") : dirname(dirname(dirname(resolveSdkContractCompiler())));
  const artifact = join(modules, "typescript");
  if (!existsSync(artifact) || !inside(realpathSync(artifact), realpathSync(entry))) throw new SdkContractRefusal("compiler_unavailable", "Select an entry inside the installed TypeScript package whose JavaScript API will check these examples.");
  const ambient = existsSync(join(modules, "@types")) ? readdirSync(join(modules, "@types")).map(name => "@types/" + name) : [];
  const native = existsSync(join(modules, "@typescript")) ? readdirSync(join(modules, "@typescript")).map(name => "@typescript/" + name) : [];
  materializeInlineDependencies(project, modules, ["typescript", "undici-types", ...ambient, ...native]);
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
  try {
    options.onProgress?.("allocated");
    const template = join(scratch, "template");

    if (options.consumer === undefined) inlineConsumer(template, compiler);
    else {
      copyConsumer(resolve(options.consumer), template);
      privateDirectory(template, join(template, "node_modules"));

    }
    validateDependencies(template);
    registryConfiguration(template);
    for (const target of ["minimum", "current"] as const) {
      const project = join(scratch, target);
      // Clone the consumer-owned resolution unchanged, then replace only the selected SDK.
      copyConsumer(template, project);
      const installed = join(project, "node_modules", "@unbrained", "pm-cli");
      privateDirectory(project, dirname(installed));
      rmSync(installed, { recursive: true, force: true });
      copyConsumer(targets[target].root, installed, true);
      targetRoot({ root: installed, version: targets[target].version });
      const installedRoot = realpathSync(installed);
      options.onProgress?.("linked");
      for (const example of examples) {
        if (options.consumer === undefined) writeFileSync(join(project, "consumer.ts"), example.source);
        const {ok, exit_code, diagnostics} = compileConsumer(project, installedRoot, targets[target].version, mkdtempSync(join(scratch, "compiler-output-")));
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
