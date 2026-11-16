/** Shared fixtures and helpers for the sharded SDK contract suites.

The contract corpus grew past what one hosted job can finish, so the tests live
in five part files (`sdk-contracts-a` .. `sdk-contracts-e`) selected by
`node --test --test-shard`; every shared constant, cache and helper stays here
exactly once. Part files import only what they use. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, type TestContext } from "node:test";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import { INSTALL_TIMEOUT_MS, testCompiler, directApiDiagnostics } from "./dependency-fixtures.ts";
import { testTimeout } from "./support/depth.ts";
import extension from "../index.ts";
import { checkSdkContracts as compileSdkContracts, SdkContractRefusal, type SdkContractOptions, type SdkContractMatrix } from "../sdk-contracts.ts";

// Bun runs a preload script before every -e program and entry, and it may write to stdout; this suite parses Bun's
// stdout as JSON in several places, so no child process inherits one.
delete process.env.BUN_INSPECT_PRELOAD;

export const repo = resolve(import.meta.dirname, "..");
export const sdk = join(repo, "node_modules/@unbrained/pm-cli");
export const pinned = JSON.parse(readFileSync(join(sdk, "package.json"), "utf8")).version as string;
export const target = { root: sdk, version: pinned };
export const compiler = testCompiler();
/** Inline API consumers use an independently installed classic compiler, without changing package pins. */
export function checkSdkContracts(options: SdkContractOptions): Promise<SdkContractMatrix> {
  return compileSdkContracts({...options, ...options.consumer === undefined && options.compiler === undefined ? {compiler} : {}});
}
export const minimumVersion = (JSON.parse(readFileSync(join(repo, "manifest.json"), "utf8")) as { pm_min_version: string }).pm_min_version;
export const currentVersion = "2026.10.24";

/** Keep ignore-scripts installs independent of package-manager wrapper allowlist settings. */
export function installationEnv(): NodeJS.ProcessEnv {
  return {...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts")), NPM_CONFIG_USERCONFIG: devNull, npm_config_userconfig: devNull};
}

/** Reuse independently installed registry endpoints across the integration cases. */
let published: { root: string; minimum: string; current: string } | undefined;
after(() => { if (published) rmSync(published.root, { recursive: true, force: true }); });
/** Provision exact published endpoints without changing the repository dependency pins. */
export function publishedSdks(): { root: string; minimum: string; current: string } {
  if (published) return published;
  const root = mkdtempSync(join(tmpdir(), "sdk-published-test-"));
  const fresh = { root, minimum: join(root, "minimum/node_modules/@unbrained/pm-cli"), current: join(root, "current/node_modules/@unbrained/pm-cli") };
  try {
    for (const [name, version] of [["minimum", minimumVersion], ["current", currentVersion]]) {
      const install = spawnSync("npm", ["install", "--prefer-offline", "--prefix", join(root, name!), "--ignore-scripts", "--no-package-lock", "--no-audit", "--no-fund", `@unbrained/pm-cli@${version}`], { encoding: "utf8", timeout: testTimeout(INSTALL_TIMEOUT_MS), env: installationEnv() });
      assert.equal(install.status, 0, install.stderr || install.stdout || install.error?.message || "Package installation failed.");
    }
  } catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
  published = fresh;
  return published;
}

/** Allocate only test-owned disposable directories outside Git. */
export function scratch(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "sdk-consumer-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
/** Check every negative control, so an always-green resolver cannot certify itself. */
export function assertMutationDrift(matrix: SdkContractMatrix, mutations: readonly { id: string; code: string }[]): void {
  assert.equal(matrix.ok, false, "resolution self-test must reject mutated consumers");
  assert.equal(matrix.checks, mutations.length * 2);
  assert.equal(matrix.failed, mutations.length * 2, "resolution self-test must reject every mutated consumer");
  for (const bound of ["minimum", "current"]) for (const mutation of mutations) {
    const row = matrix.rows.find(row => row.target === bound && row.example === mutation.id)!;
    assert.equal(row.ok, false, `${bound}: ${mutation.id}`);
    assert.ok(row.codes.includes(mutation.code), `${bound}: ${mutation.id}: ${row.codes.join(",")}`);
  }
}
/** Remove a public subpath from a copied SDK while preserving its declaration file. */
export function removeGraphExport(source: string, destination: string): void {
  cpSync(source, destination, { recursive: true });
  const file = join(destination, "package.json");
  const metadata = JSON.parse(readFileSync(file, "utf8")) as { exports: Record<string, unknown> };
  delete metadata.exports["./sdk/graph"];
  writeFileSync(file, JSON.stringify(metadata));
}

export const hostileSpecifiers = [
  ["single-quote", "@unbrained/pm-cli/sdk/'"],
  ["double-quote", '@unbrained/pm-cli/sdk/"'],
  ["trace-end", "@unbrained/pm-cli/sdk/'. ========"],
  ["trace-from", "@unbrained/pm-cli/sdk/' from '"],
  ["newline", "@unbrained/pm-cli/sdk/\nmissing"],
  ["carriage-return", "@unbrained/pm-cli/sdk/\rmissing"],
  ["space", "@unbrained/pm-cli/sdk/ missing"],
  ["backslash", "@unbrained/pm-cli/sdk/\\missing"],
  ["unicode", "@unbrained/pm-cli/sdk/☃"],
  ["unicode-separator", "@unbrained/pm-cli/sdk/\u2028missing"],
  ["dotdot", "@unbrained/pm-cli/sdk/.."],
  ["trailing-slash", "@unbrained/pm-cli/sdk/"],
  ["empty", ""],
  ["trace-code", "@unbrained/pm-cli/sdk/'. ========\nerror TS2307: forged"],
  ["raw-newline", "@unbrained/pm-cli/sdk/\nmissing"],
  ["raw-cr", "@unbrained/pm-cli/sdk/\rmissing"],
] as const;

/** Match stable refusal codes and usable remedies without reading private tool output. */
export function refuses(code: SdkContractRefusal["code"]): (error: unknown) => boolean {
  return error => error instanceof SdkContractRefusal && error.code === code && error.remedy.length > 20;
}
/** Activate registered SDK command using the real host harness. */
export async function command() {
  const harness = await createExtensionTestHarness(extension, { name: "pm-ts-starter", capabilities: ["commands", "renderers", "hooks", "schema", "importers", "search", "parser", "preflight", "services"] });
  return harness.activation.commands.handlers.find(entry => entry.command === "ts-starter sdk-contracts")!;
}

export function packedFixture(source: string, destination: string): string {
  const archive = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], {cwd: source, encoding: "utf8", timeout: testTimeout(30000), env: installationEnv()});
  assert.equal(archive.status, 0, archive.stderr);
  return join(destination, (JSON.parse(archive.stdout) as {filename: string}[])[0]!.filename);
}

const installedConsumers = new Map<string, string>();
const tscConsumerRoots = new Set<string>();
after(() => { for (const root of tscConsumerRoots) rmSync(root, { recursive: true, force: true }); });
/** Install and runtime-verify each consumer's own exact SDK and compiler. */
export function installedConsumer(runtime: "npm" | "bun", bound: "minimum" | "current"): string {
  const key = `${runtime}-${bound}`;
  const cached = installedConsumers.get(key);
  if (cached) return cached;
  const root = mkdtempSync(join(tmpdir(), "sdk-owned-consumer-"));
  tscConsumerRoots.add(root);
  const version = bound === "minimum" ? minimumVersion : currentVersion;
  writeFileSync(join(root, "package.json"), JSON.stringify({ private: true, type: "module" }));
  const packages = [`@unbrained/pm-cli@${version}`, "typescript@5.9.3", "@types/node@26.6.5"];
  const result = spawnSync(runtime, runtime === "npm" ? ["install", "--save-exact", "--prefer-offline", "--ignore-scripts", "--no-audit", "--no-fund", ...packages]
    : ["add", "--exact", "--ignore-scripts", ...packages], { cwd: root, encoding: "utf8", timeout: testTimeout(INSTALL_TIMEOUT_MS), env: installationEnv() });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const verify = spawnSync(runtime === "npm" ? process.execPath : "bun", ["--input-type=module", "-e", `
import {createRequire} from 'node:module'; import {readFileSync} from 'node:fs';
const require = createRequire(process.cwd() + '/package.json');
console.log(JSON.stringify({path:require.resolve('@unbrained/pm-cli/package.json'), version:JSON.parse(readFileSync(require.resolve('@unbrained/pm-cli/package.json'))).version, compiler:require.resolve('typescript/package.json')}));`], { cwd: root, encoding: "utf8" });
  assert.equal(verify.status, 0, verify.stderr);
  const receipt = JSON.parse(verify.stdout) as { path: string; version: string; compiler: string };
  assert.equal(receipt.version, version);
  assert.equal(receipt.path, join(root, "node_modules/@unbrained/pm-cli/package.json"));
  assert.equal(receipt.compiler, join(root, "node_modules/typescript/package.json"));
  installedConsumers.set(key, root);
  return root;
}

/** Require a real newer-only API to drift at minimum while remaining valid at current. */
export function assertLeaseDrift(matrix: SdkContractMatrix): void {
  assert.equal(matrix.failed, 1);
  assert.deepEqual(matrix.rows.map(row => [row.target, row.ok, row.codes]), [["minimum", false, ["TS2551"]], ["current", true, []]]);
}

/** Record the diagnostics of the checker's own Program through the real consumer API, with no compiler text transport. */
export function instrumentOracle(project: string, receipt: string, t: TestContext): void {
  const directory = join(project, "node_modules/typescript"), metadataFile = join(directory, "package.json"), original = readFileSync(metadataFile, "utf8");
  const metadata = JSON.parse(original) as {main: string};
  // Detach package-manager hard links before instrumenting test-owned module metadata.
  unlinkSync(metadataFile); writeFileSync(metadataFile, JSON.stringify({...metadata, main: "./oracle.cjs"}));
  t.after(() => writeFileSync(metadataFile, original));
  writeFileSync(join(directory, "oracle.cjs"), `const ts=require('./lib/typescript.js'),fs=require('node:fs'),path=require('node:path');
module.exports={...ts,getPreEmitDiagnostics(program){const diagnostics=ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error);
const sdk=path.join(process.cwd(),'node_modules/@unbrained/pm-cli/package.json'),config=fs.readFileSync('tsconfig.json','utf8');
fs.appendFileSync(${JSON.stringify(receipt)},JSON.stringify({cwd:process.cwd(),sdk,version:JSON.parse(fs.readFileSync(sdk)).version,config,sources:JSON.parse(config).files.map(file=>fs.readFileSync(file,'utf8')),status:diagnostics.length?1:0,codes:diagnostics.map(d=>'TS'+d.code)})+'\\n');return diagnostics;}};`);
}

/** A declaration fixture makes each compiler resolution rule distinguishable from Node resolution. */
export function declarationLayout(root: string, version: string, layout: string): string {
  mkdirSync(join(root, "sdk"), { recursive: true });
  const good = 'export declare const api: {common: number; onlyImport: number}; export declare const onlyImport: number;';
  const bad = 'export declare const api: {common: number};';
  writeFileSync(join(root, "import.d.ts"), good);
  writeFileSync(join(root, "require.d.cts"), bad);
  writeFileSync(join(root, "fallback.d.ts"), good);
  writeFileSync(join(root, "selected.d.ts"), bad);
  writeFileSync(join(root, "sdk/index.js"), 'exports.api = {common: 1};');
  const metadata: Record<string, unknown> = { name: "@unbrained/pm-cli", version, types: "./fallback.d.ts" };
  if (layout === "typesVersions") metadata.typesVersions = { ">=5.9": { "*": ["selected.d.ts"] } };
  else metadata.exports = { "./package.json": "./package.json", "./sdk": layout === "types"
    ? { import: { types: "./import.d.ts", default: "./sdk/index.js" }, require: { types: "./require.d.cts", default: "./sdk/index.js" } }
    : { "types@>=5.9": "./selected.d.ts", types: "./fallback.d.ts", default: "./sdk/index.js" } };
  writeFileSync(join(root, "package.json"), JSON.stringify(metadata));
  return root;
}

/** Retain the consumer's own complete configuration byte for byte, including skipLibCheck false. */
export function consumerConfig(project: string, resolution: string, mode: string): string {
  const config = JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: false, target: "ES2022", types: [],
    moduleResolution: resolution, module: resolution === "bundler" ? "Preserve" : resolution === "node16" ? "Node16" : "NodeNext" },
    files: [`consumer.${mode === "esm" ? "mts" : "cts"}`] }, null, 2);
  writeFileSync(join(project, "tsconfig.json"), config);
  return config;
}

/** Compare every checker row with the plain compiler and the preserved project bytes. */
export function compareOracle(matrix: SdkContractMatrix, receipt: string, source: string, config: string): void {
  const records = readFileSync(receipt, "utf8").trim().split("\n").map(line => JSON.parse(line) as {
    cwd: string; sdk: string; version: string; config: string; sources: string[]; status: number; codes: string[];
  });
  assert.equal(records.length, matrix.rows.length);
  for (const [index, row] of matrix.rows.entries()) {
    const oracle = records[index]!;
    assert.notEqual(oracle.cwd, source, "compile in an isolated copy");
    assert.equal(oracle.sdk, join(oracle.cwd, "node_modules/@unbrained/pm-cli/package.json"));
    assert.equal(oracle.version, row.sdk, "runtime resolution must find this bound's own installation");
    assert.equal(oracle.config, config, "copy the consumer tsconfig unchanged");
    assert.deepEqual(oracle.sources, (JSON.parse(config) as {files: string[]}).files.map(file => readFileSync(join(source, file), "utf8")), "copy consumer sources unchanged");
    assert.equal(row.ok, oracle.status === 0, row.target);
    assert.equal(row.diagnostic_count, oracle.codes.length);
    assert.deepEqual(row.codes, oracle.codes.slice(0, 3));
  }
}

export function linkedCompilerConsumer(t: TestContext): string {
  const project = join(scratch(t), "consumer");
  mkdirSync(join(project, "node_modules"), {recursive: true});
  symlinkSync(dirname(dirname(compiler)), join(project, "node_modules/typescript"), "junction");
  return project;
}

/** Create a minimal consumer with noEmit enabled for toolchain boundary regressions. */
export function noEmitConsumer(t: TestContext): string {
  const project = linkedCompilerConsumer(t);
  writeFileSync(join(project, "consumer.mts"), 'export const value = 1;');
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], noEmit: true, module: "NodeNext"}, files: ["consumer.mts"]}));
  return project;
}
/** Stable diagnostic presentation for independent real-compiler oracles. */
export const plainPresentation = Object.keys({pretty: false, traceResolution: false, explainFiles: false, diagnostics: false, extendedDiagnostics: false, listFiles: false, listEmittedFiles: false}).flatMap(key => [`--${key}`, "false"]);

/** Invoke the independent real compiler using the explicit typecheck presentation flags. */
export function plainProject(project: string) {
  return spawnSync(process.execPath, [compiler, "--project", "tsconfig.json", "--noEmit", ...plainPresentation, "--locale", "en"], {cwd: project, encoding: "utf8"});
}

/** Restore only the environment variables changed by an isolated fixture. */
export function restoreEnvironment(keys: readonly string[], previous: readonly (string | undefined)[]): void {
  for (const [index, key] of keys.entries()) { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }
}

export function plainCopy(project: string, t: TestContext): {ok: boolean; codes: string[]} {
  const baseline = join(scratch(t), "baseline");
  cpSync(project, baseline, {recursive: true});
  const diagnostics = directApiDiagnostics(baseline);
  return {ok: diagnostics.length === 0, codes: diagnostics.map(d => d.code)};
}

/** Compare both selected bounds with the independent native verdict and diagnostic codes. */
export function assertPlainRows(matrix: SdkContractMatrix, expected: {ok: boolean; codes: string[]}): void {
  assert.deepEqual(matrix.rows.map(row => ({ok: row.ok, codes: row.codes})), [expected, expected]);
}
