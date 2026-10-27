/** Installed dependency fixtures shared by corpus and property oracles. */
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync, readlinkSync, lstatSync, symlinkSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {tmpdir} from "node:os";
import {after, type TestContext} from "node:test";
import {checkSdkContracts, SdkContractRefusal, type SdkContractOptions, type SdkContractDiagnostic} from "../sdk-contracts.ts";

/** Write a dependency exactly where the consumer installed it, independent of its metadata name. */
export function dependencyEntry(root: string, installed: string, actual: string, declarations = 'export declare const value: "selected";'): void {
  const directory = join(root, installed);
  mkdirSync(directory, {recursive: true});
  writeFileSync(join(directory, "package.json"), JSON.stringify({name: actual, version: "1.0.0", types: "index.d.ts", scripts: {prepare: "exit 42", postinstall: "exit 42"}}));
  writeFileSync(join(directory, "index.d.ts"), declarations);
}

/** Give dependency-only oracles an identical small SDK at the installed current bound. */
export function dependencyBound(project: string): SdkContractOptions["current"] {
  const root = join(project, "node_modules/@unbrained/pm-cli");
  mkdirSync(root, {recursive: true});
  writeFileSync(join(root, "package.json"), JSON.stringify({name: "@unbrained/pm-cli", version: "1.0.0", types: "index.d.ts"}));
  writeFileSync(join(root, "index.d.ts"), 'export declare const sdk: "current";');
  return {root, version: "1.0.0"};
}


/** Detect writes even when a compiler rewrites identical bytes or restores the file inventory. */
export function filesystemSnapshot(root: string): string {
  const digest = createHash("sha256");
  const visit = (name: string): void => {
    const file = join(root, name), info = lstatSync(file, {bigint: true});
    digest.update(name).update([info.mode, info.size, info.mtimeNs, info.ctimeNs].join(":"));
    if (info.isFile()) digest.update(readFileSync(file));
    if (info.isSymbolicLink()) digest.update(readlinkSync(file));
    if (info.isDirectory()) for (const child of readdirSync(file).sort()) visit(join(name, child));
  };
  visit(".");
  return digest.digest("hex");
}

/** Deterministic generator, independent of compiler diagnostics and npm behavior. */
export function boundaryRandom(seed: number): () => number {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed ^ (seed >>> 16)) >>> 0; };
}

/** Provision an exact unmodified public compiler without lifecycle scripts or user credentials. */
export function installTestCompiler(directory: string, version: string): void {
  const result = spawnSync("npm", ["install", "--prefix", directory, "--ignore-scripts", "--no-package-lock", "--no-audit", "--no-fund", `typescript@${version}`], {
    encoding: "utf8", timeout: 120000, env: {...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts")), NPM_CONFIG_USERCONFIG: "/dev/null", npm_config_userconfig: "/dev/null"},
  });
  assert.equal(result.status, 0, result.stderr);
}

/** Lazily install a classic consumer API without changing the repository build compiler pin. */
export function testCompiler(): string {
  if (!compilerTool) {
    compilerTool = mkdtempSync(join(tmpdir(), "sdk-api-tool-"));
    installTestCompiler(compilerTool, "5.9.3");
    for (const name of ["@types", "undici-types"]) symlinkSync(resolve(import.meta.dirname, "../node_modules", name), join(compilerTool, "node_modules", name), "junction");
  }
  return join(compilerTool, "node_modules/typescript/bin/tsc");
}
/** Every test worker owns and cleans its independent compiler fixture. */
let compilerTool: string | undefined;
after(() => { if (compilerTool) rmSync(compilerTool, {recursive: true, force: true}); });

/** Return the actual API diagnostics, without invoking or parsing the command-line compiler. */
export function directApiDiagnostics(project: string): SdkContractDiagnostic[] {
  const script = `const ts=require(require.resolve('typescript',{paths:[process.argv[1]]})),path=require('node:path'),fs=require('node:fs');
ts.sys.write=()=>{};const root=fs.realpathSync(process.argv[1]),diagnostics=[],seen=new Set();
/** Render the public location contract after canonicalizing the native diagnostic file. */
const location=file=>{const name=path.relative(root,fs.realpathSync(file));return path.isAbsolute(name)||name==='..'||name.startsWith('..'+path.sep)?'<external>':name.split(path.sep).join('/');};
function check(file){if(seen.has(file))return;seen.add(file);const errors=[],config=ts.getParsedCommandLineOfConfigFile(file,{noEmit:true},{...ts.sys,onUnRecoverableConfigFileDiagnostic:d=>errors.push(d)});
if(!config){diagnostics.push(...errors);return;}
diagnostics.push(...ts.getPreEmitDiagnostics(ts.createProgram({rootNames:config.fileNames,options:config.options,projectReferences:config.projectReferences,configFileParsingDiagnostics:config.errors})));}
const order=ts.createSolutionBuilder(ts.createSolutionBuilderHost(ts.sys),[path.join(root,'tsconfig.json')],{force:true,noEmit:true}).getBuildOrder();
if(Array.isArray(order))order.forEach(check);else diagnostics.push(...order.circularDiagnostics);
process.stdout.write(JSON.stringify(diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).map(d=>{const pos=d.file&&d.start!==undefined?d.file.getLineAndCharacterOfPosition(d.start):undefined;return {code:'TS'+d.code,file:d.file?location(d.file.fileName):'<config>',message:ts.flattenDiagnosticMessageText(d.messageText,'\\n').replaceAll(root,'.'),line:pos?pos.line+1:0,column:pos?pos.character+1:0};})));`;
  const run = spawnSync(process.execPath, ["-e", script, project], {encoding: "utf8", timeout: 30000});
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout) as SdkContractDiagnostic[];
}


/** Allocate an exclusive fixture root and register unconditional cleanup with its test. */
export function testDirectory(t: TestContext, prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  return root;
}

/** Give API regressions a real compiler link, isolated consumer and independently named SDK. */
export function apiConsumer(t: TestContext, version?: string): {root: string; project: string; bound: ReturnType<typeof dependencyBound>} {
  const root = testDirectory(t, "sdk-api-review-"), project = join(root, "consumer");
  mkdirSync(join(project, "node_modules"), {recursive: true});
  if (version) installTestCompiler(join(root, "tool"), version);
  symlinkSync(version ? join(root, "tool/node_modules/typescript") : dirname(dirname(testCompiler())), join(project, "node_modules/typescript"), "junction");
  writeFileSync(join(project, "package.json"), '{"type":"module"}');
  writeFileSync(join(project, "consumer.ts"), "export const value: string = 1;");
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], module: "NodeNext"}, files: ["consumer.ts"]}));
  return {root, project, bound: dependencyBound(project)};
}

/** Link a foreign SDK whose unnamed dist metadata must not truncate resolver package identity. */
export function linkForeignSdk(root: string, project: string, bound: ReturnType<typeof dependencyBound>): void {
  const foreign = join(root, "foreign SDK"); cpSync(bound.root, foreign, {recursive: true});
  mkdirSync(join(foreign, "dist")); writeFileSync(join(foreign, "dist/package.json"), '{"type":"module"}');
  writeFileSync(join(foreign, "dist/index.d.ts"), "export declare const onlyCurrent: 1;");
  writeFileSync(join(foreign, "package.json"), JSON.stringify({name: "@unbrained/pm-cli", version: "2.0.0", types: "dist/index.d.ts"}));
  symlinkSync(foreign, join(project, "node_modules/foreign-sdk"), "junction");
  writeFileSync(join(project, "consumer.ts"), 'export {onlyCurrent} from "foreign-sdk";');
}

/** Prove an ordinary compiler accepts the foreign API while bound isolation rejects its identity. */
export async function assertForeignSdk(root: string, project: string, bound: ReturnType<typeof dependencyBound>): Promise<void> {
  await assertResolvedRefusal(root, project, bound, "isolation_refused", "index.d.ts");
}

/** Require a clean direct oracle, a named typed refusal and byte-identical original inputs. */
export async function assertResolvedRefusal(root: string, project: string, bound: ReturnType<typeof dependencyBound>, code: SdkContractRefusal["code"], file: string): Promise<void> {
  assert.deepEqual(directApiDiagnostics(project), []);
  const before = filesystemSnapshot(root);
  await assert.rejects(checkSdkContracts({consumer: project, minimum: bound, current: bound}), error => error instanceof SdkContractRefusal && error.code === code && error.remedy.includes(file));
  assert.equal(filesystemSnapshot(root), before);
}
