/** Real compiler, isolated tracker and emitted-package compatibility contracts. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, lstatSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import test, { after, type TestContext } from "node:test";
import { Worker } from "node:worker_threads";
import {dependencyEntry, dependencyBound, filesystemSnapshot, boundaryRandom} from "./dependency-fixtures.ts";
import { PmClient } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import extension from "../index.ts";
import { checkSdkContracts, parseSdkConsumerExamples, resolveSdkContractCompiler, SDK_CONSUMER_EXAMPLES, SdkContractRefusal, type SdkContractOptions, type SdkContractMatrix } from "../sdk-contracts.ts";

const repo = resolve(import.meta.dirname, "..");
const sdk = join(repo, "node_modules/@unbrained/pm-cli");
const pinned = JSON.parse(readFileSync(join(sdk, "package.json"), "utf8")).version as string;
const target = { root: sdk, version: pinned };
const compiler = join(repo, "node_modules/typescript/bin/tsc");
const minimumVersion = (JSON.parse(readFileSync(join(repo, "manifest.json"), "utf8")) as { pm_min_version: string }).pm_min_version;
const currentVersion = "2026.10.24";

/** Keep ignore-scripts installs independent of package-manager wrapper allowlist settings. */
function installationEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"));
}

/** Reuse independently installed registry endpoints across the integration cases. */
let published: { root: string; minimum: string; current: string } | undefined;
after(() => { if (published) rmSync(published.root, { recursive: true, force: true }); });
/** Provision exact published endpoints without changing the repository dependency pins. */
function publishedSdks(): { root: string; minimum: string; current: string } {
  if (published) return published;
  const root = mkdtempSync(join(tmpdir(), "sdk-published-test-"));
  published = { root, minimum: join(root, "minimum/node_modules/@unbrained/pm-cli"), current: join(root, "current/node_modules/@unbrained/pm-cli") };
  for (const [name, version] of [["minimum", minimumVersion], ["current", currentVersion]]) {
    const install = spawnSync("npm", ["install", "--prefix", join(root, name!), "--ignore-scripts", "--no-package-lock", "--no-audit", "--no-fund", `@unbrained/pm-cli@${version}`], { encoding: "utf8", timeout: 120000, env: installationEnv() });
    assert.equal(install.status, 0, install.stderr);
  }
  return published;
}

/** Allocate only test-owned disposable directories outside Git. */
function scratch(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "sdk-consumer-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
/** Check every negative control, so an always-green resolver cannot certify itself. */
function assertMutationDrift(matrix: SdkContractMatrix, mutations: readonly { id: string; code: string }[]): void {
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
function removeGraphExport(source: string, destination: string): void {
  cpSync(source, destination, { recursive: true });
  const file = join(destination, "package.json");
  const metadata = JSON.parse(readFileSync(file, "utf8")) as { exports: Record<string, unknown> };
  delete metadata.exports["./sdk/graph"];
  writeFileSync(file, JSON.stringify(metadata));
}

test("resolution self-test rejects every SDK import mutation at both published bounds", async t => {
  const root = scratch(t), endpoints = publishedSdks();
  const targets = { minimum: { root: join(root, "minimum"), version: minimumVersion }, current: { root: join(root, "current"), version: currentVersion } };
  for (const bound of ["minimum", "current"] as const) {
    // Keep the real declaration on disk: exports, rather than file presence,
    // decides whether a selected SDK ships a public subpath.
    removeGraphExport(endpoints[bound], targets[bound].root);
  }
  const mutations = [
    { id: "nonexistent-subpath", code: "TS2307", source: 'import * as sdk from "@unbrained/pm-cli/sdk/does-not-exist"; export const api = sdk;' },
    { id: "removed-subpath", code: "TS2307", source: 'import * as sdk from "@unbrained/pm-cli/sdk/graph"; export const api = sdk;' },
    { id: "misspelled-package", code: "TS2307", source: 'import * as sdk from "@unbrained/pm-clii/sdk"; export const api = sdk;' },
    { id: "missing-named-export", code: "TS2305", source: 'import { absentPublicApi } from "@unbrained/pm-cli/sdk/authoring"; export const api = absentPublicApi;' },
    { id: "missing-type-export", code: "TS2305", source: 'import type { AbsentPublicType } from "@unbrained/pm-cli/sdk"; export type Api = AbsentPublicType;' },
    { id: "wrong-export-kind", code: "TS2693", source: 'import { ExtensionCommandSdk } from "@unbrained/pm-cli/sdk/authoring"; export const api = ExtensionCommandSdk;' },
    { id: "type-import-as-value", code: "TS1361", source: 'import type { PmClient } from "@unbrained/pm-cli/sdk"; export const api = PmClient;' },
    { id: "default-vs-namespace", code: "TS1192", source: 'import sdk from "@unbrained/pm-cli/sdk/authoring"; export const api = sdk;' },
  ];
  const examples = mutations.map(({ id, source }) => ({ id, source }));
  const result = await checkSdkContracts({ ...targets, examples, compiler });
  assertMutationDrift(result, mutations);
  const good = await checkSdkContracts({ ...targets, compiler, examples: [...SDK_CONSUMER_EXAMPLES,
    { id: "namespace-control", source: 'import * as sdk from "@unbrained/pm-cli/sdk/authoring"; export const api = sdk.defineCommand;' },
  ] });
  assert.equal(good.ok, true); assert.equal(good.checks, 6); assert.equal(good.failed, 0);
  // Exercise the self-test itself against an intentionally stubbed compiler
  // that accepts every import, including the namespace-import blind spot.
  const stub = join(root, "blind-compiler.cjs"); writeFileSync(stub, "process.exit(0);\n");
  await assert.rejects(checkSdkContracts({ ...targets, examples, compiler: stub }), refuses("isolation_refused"));
});

/** Hostile names retain their bytes across source literals, compiler ASTs and structured resolution. */
const hostileSpecifiers = [
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
function refuses(code: SdkContractRefusal["code"]): (error: unknown) => boolean {
  return error => error instanceof SdkContractRefusal && error.code === code && error.remedy.length > 20;
}
/** Activate registered SDK command using the real host harness. */
async function command() {
  const harness = await createExtensionTestHarness(extension, { name: "pm-ts-starter", capabilities: ["commands", "renderers", "hooks", "schema", "importers", "search", "parser", "preflight", "services"] });
  return harness.activation.commands.handlers.find(entry => entry.command === "ts-starter sdk-contracts")!;
}

test("real SDK examples pass; removing a real public export fails only its current fixture", async t => {
  const root = scratch(t), changed = join(root, "sdk");
  cpSync(sdk, changed, { recursive: true });
  const file = join(changed, "dist/sdk/define.d.ts");
  const before = readFileSync(file, "utf8");
  assert.match(before, /export declare function defineCommand</);
  writeFileSync(file, before.replace("export declare function defineCommand<", "declare function removedDefineCommand<"));
  const result = await checkSdkContracts({ minimum: target, current: { ...target, root: changed } });
  assert.equal(result.checks, 4); assert.equal(result.failed, 1); assert.equal(result.ok, false);
  assert.deepEqual(result.rows.filter(row => !row.ok).map(row => [row.target, row.example]), [["current", "authoring"]]);
  assert.ok(result.rows[2]!.codes.includes("TS2305"));
  assert.match(result.remedy, /Restore/);
  const good = await checkSdkContracts({ minimum: target, current: target, compiler });
  assert.equal(good.ok, true); assert.equal(good.checks, 4); assert.equal(good.failed, 0);
});

test("refuse malformed, duplicate, oversized and empty examples without vacuous success", () => {
  for (const value of [null, {}, [], Array(17).fill(SDK_CONSUMER_EXAMPLES[0]), [null], [{}], [{ id: 1, source: "x" }],
    [{ id: "../bad", source: "x" }], [{ id: "ok", source: 1 }], [{ id: "ok", source: " " }],
    [{ id: "ok", source: "x".repeat(65537) }], [{ id: "ok", source: "x", extra: 1 }],
    [{ id: "ok", source: "x" }, { id: "ok", source: "x" }]]) assert.throws(() => parseSdkConsumerExamples(value), refuses("invalid_input"));
  const cloned = parseSdkConsumerExamples(SDK_CONSUMER_EXAMPLES);
  assert.deepEqual(cloned, SDK_CONSUMER_EXAMPLES); assert.notEqual(cloned, SDK_CONSUMER_EXAMPLES);
});

test("wrong SDK identity, unavailable packages and compiler crashes have typed safe remedies", async t => {
  const root = scratch(t);
  for (const minimum of [null, { root: sdk, version: "latest" }, { root: 1, version: pinned }, { root: " ", version: pinned },
    { root, version: pinned }, { root: sdk, version: "1900.1.1" }]) {
    await assert.rejects(checkSdkContracts({ minimum, current: target } as SdkContractOptions), refuses("sdk_unavailable"));
  }
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "foreign", version: pinned }));
  await assert.rejects(checkSdkContracts({ minimum: { ...target, root }, current: target }), refuses("sdk_unavailable"));
  for (const body of ["process.exit(3)", "process.kill(process.pid, 'SIGTERM')", "process.stdout.write('x'.repeat(9000000))"]) {
    const bad = join(root, "compiler.cjs"); writeFileSync(bad, body);
    await assert.rejects(checkSdkContracts({ minimum: target, current: target, compiler: bad }), refuses("compiler_unavailable"));
  }
  for (const entry of [root, join(root, "missing")]) await assert.rejects(checkSdkContracts({ minimum: target, current: target, compiler: entry }), refuses("compiler_unavailable"));
  assert.throws(() => resolveSdkContractCompiler(join(root, "consumer.cjs")), refuses("compiler_unavailable"));
  assert.equal(resolveSdkContractCompiler(), compiler);
});

test("diagnostic output is bounded and never echoes source text or machine paths", async () => {
  const result = await checkSdkContracts({ minimum: target, current: target, examples: [{ id: "removed", source: Array.from({ length: 8 }, (_, index) => `const privateSecret${index}: string = ${index};`).join("\n") }] });
  assert.equal(result.failed, 2);
  assert.ok(result.rows.every(row => row.diagnostic_count === 8 && row.codes.length === 3));
  assert.doesNotMatch(JSON.stringify(result), /privateSecret|sdk-consumer-test/);
  assert.deepEqual(result.rows[0]!.diagnostics[0], { code: "TS2322", file: "consumer.ts", line: 1, column: 7, message: "Type 'number' is not assignable to type 'string'." });
});

test("each overlapping caller boundary preserves peer success and foreign state on one plain tracker", async t => {
  const root = scratch(t), tracker = join(root, "tracker");
  const client = new PmClient({ pmRoot: tracker, noExtensions: true, author: "fixture" });
  await client.init("contract");
  const item = await client.create({ title: "Original public fixture" });
  const original = readFileSync(join(tracker, "tasks", `${item.item.id}.toon`), "utf8");
  const peerItem = await client.create({ title: "Peer-owned independent state" });
  // There is no shared mutation path: every meaningful phase receives a competing
  // real tracker transition plus a second complete matrix. Foreign bytes survive.
  const phases: string[] = [];
  await checkSdkContracts({ minimum: target, current: target, examples: [SDK_CONSUMER_EXAMPLES[0]!], onProgress(phase) {
    phases.push(phase);
    writeFileSync(join(tracker, "foreign-peer.json"), JSON.stringify({ phase, owner: "peer", success: true }));
    const peer = spawnSync(process.execPath, ["--input-type=module", "-e", `import {checkSdkContracts} from ${JSON.stringify(join(repo, "sdk-contracts.ts"))};
import {PmClient} from ${JSON.stringify(join(sdk, "dist/sdk/index.js"))};
await new PmClient({pmRoot: ${JSON.stringify(tracker)}, noExtensions: true, author: 'peer'}).update(${JSON.stringify(peerItem.item.id)}, {description: ${JSON.stringify(phase + "-" + phases.length)}});
const result = await checkSdkContracts(${JSON.stringify({ minimum: target, current: target, compiler, examples: [SDK_CONSUMER_EXAMPLES[0]] })});
if (!result.ok) process.exit(1);`], { encoding: "utf8", env: { ...process.env, GIT_CEILING_DIRECTORIES: root, PATH: "" } });
    assert.equal(peer.status, 0, peer.stderr);
    assert.equal(JSON.parse(readFileSync(join(tracker, "foreign-peer.json"), "utf8")).success, true);
  } });
  assert.deepEqual(phases, ["allocated", "linked", "compiled", "linked", "compiled", "cleanup"]);
  rmSync(join(tracker, "foreign-peer.json"));
  assert.equal(readFileSync(join(tracker, "tasks", `${item.item.id}.toon`), "utf8"), original);
  assert.equal((await client.listAllComplete()).items.find(row => row.id === peerItem.item.id)?.description, "cleanup-6");
  const before = filesystemSnapshot(tracker);
  // Observer failures still clean exclusive scratch and leave peer state alone.
  for (const phase of ["allocated", "cleanup"]) await assert.rejects(checkSdkContracts({ minimum: target, current: target, onProgress(current) {
    if (current === phase) throw new Error("observer stopped");
  } }), /observer stopped/);
  assert.equal(filesystemSnapshot(tracker), before);
});

test("registered command supports both flag forms, typed refusals and nonzero drift", async t => {
  const root = scratch(t), handler = await command();
  const base = { command: "ts-starter sdk-contracts", args: [], options: {}, global: {}, pm_root: root };
  const options = { minimumSdk: sdk, currentSdk: sdk, currentVersion: pinned, compiler };
  const minimum = publishedSdks().minimum;
  options.minimumSdk = minimum;
  const examples = join(root, "examples.json"); writeFileSync(examples, JSON.stringify([{ id: "authoring", source: SDK_CONSUMER_EXAMPLES[0]!.source }]));
  const success = await handler.run({ ...base, options: { ...options, examples } }) as { ok: boolean };
  assert.equal(success.ok, true);
  const consumer = installedConsumer("npm", "current");
  const ownConfig = consumerConfig(consumer, "nodenext", "esm").replace('"types": []', '"types": ["node"]');
  writeFileSync(join(consumer, "tsconfig.json"), ownConfig);
  writeFileSync(join(consumer, "consumer.mts"), SDK_CONSUMER_EXAMPLES[0]!.source);
  assert.equal((await handler.run({ ...base, options: { minimumSdk: minimum, currentSdk: sdk, currentVersion: pinned, consumer } }) as {ok: boolean}).ok, true);
  assert.equal((await handler.run({ ...base, options: { "minimum-sdk": minimum, "current-sdk": sdk, "current-version": pinned, compiler } }) as { checks: number }).checks, 4);
  for (const patch of [{}, { ...options, minimumSdk: true }, { ...options, currentSdk: true }, { ...options, currentVersion: true }, { ...options, compiler: true }, { ...options, examples: true }, { ...options, consumer: true }, { ...options, examples: "missing" }, { ...options, examples, unknown: true }]) {
    await assert.rejects(async () => handler.run({ ...base, options: patch }), error => error instanceof Error && error.name === "PmCliError" && "code" in error);
  }
  await assert.rejects(async () => handler.run({ ...base, options: null as unknown as typeof base.options }), error => error instanceof Error && error.name === "PmCliError");
  const { compiler: _compiler, ...withoutCompiler } = options;
  assert.equal((await handler.run({ ...base, options: withoutCompiler }) as { ok: boolean }).ok, true);
  await assert.rejects(async () => handler.run({ ...base, args: ["extra"] }), error => error instanceof Error && error.name === "PmCliError");
  writeFileSync(examples, JSON.stringify([{ id: "removed", source: "import { removedApi } from '@unbrained/pm-cli/sdk'; export const use = removedApi;" }]));
  const saved = process.exitCode;
  try {
    assert.equal((await handler.run({ ...base, options: { ...options, examples } }) as { ok: boolean }).ok, false);
    assert.equal(process.exitCode, 1);
  } finally { process.exitCode = saved; }
});

test("packed npm and Bun consumers resolve each exact SDK bound and compile emitted contracts without git", async t => {
  const root = scratch(t), endpoints = publishedSdks();
  const pack = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], { cwd: repo, encoding: "utf8", timeout: 30000, env: installationEnv() });
  assert.equal(pack.status, 0, pack.stderr);
  const tarball = join(root, (JSON.parse(pack.stdout) as { filename: string }[])[0]!.filename);
  const noGit = join(root, "no-git"); mkdirSync(noGit);
  for (const runtime of ["npm", "bun"]) for (const bound of ["minimum", "current"] as const) {
    const version = bound === "minimum" ? minimumVersion : currentVersion;
    const project = join(root, `${runtime}-${bound}`); mkdirSync(project);
    writeFileSync(join(project, "package.json"), JSON.stringify({ private: true, type: "module" }));
    const install = spawnSync(runtime, runtime === "npm"
      ? ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", tarball, `@unbrained/pm-cli@${version}`, "typescript@7.0.2", "@types/node@26.6.5"]
      : ["add", "--ignore-scripts", tarball, `@unbrained/pm-cli@${version}`, "typescript@7.0.2", "@types/node@26.6.5"], { cwd: project, encoding: "utf8", timeout: 120000, env: installationEnv() });
    assert.equal(install.status, 0, install.stderr);
    const emitted = join(project, "node_modules/pm-ts-starter/dist/index.js").replaceAll("\\", "/");
    const ownMinimum = join(installedConsumer(runtime as "npm" | "bun", "minimum"), "node_modules/@unbrained/pm-cli");
    const ownCurrent = join(installedConsumer(runtime as "npm" | "bun", "current"), "node_modules/@unbrained/pm-cli");
    const options = { minimum: { root: ownMinimum, version: minimumVersion }, current: { root: ownCurrent, version: currentVersion }, consumer: project };
    for (const example of SDK_CONSUMER_EXAMPLES) writeFileSync(join(project, `${example.id}.ts`), example.source);
    writeFileSync(join(project, "emitted-consumer.ts"), `import { checkSdkContracts, type SdkContractMatrix, type SdkContractOptions } from "pm-ts-starter";
export async function consume(options: SdkContractOptions): Promise<SdkContractMatrix> { return checkSdkContracts(options); }`);
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: false,
      module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022", types: ["node"] },
      files: ["authoring.ts", "complete-read.ts", "emitted-consumer.ts"] }));
    const entry = join(project, "consumer.mjs");
    writeFileSync(entry, `import {checkSdkContracts} from 'pm-ts-starter';
import {createRequire} from 'node:module'; import {readFileSync} from 'node:fs';
const require = createRequire(${JSON.stringify(emitted)});
const resolved = require.resolve('@unbrained/pm-cli/package.json');
const sdkVersion = JSON.parse(readFileSync(resolved, 'utf8')).version;
const sdkEntry = require.resolve('@unbrained/pm-cli/sdk');
console.log(JSON.stringify({sdkVersion, resolved, sdkEntry, matrix: await checkSdkContracts(${JSON.stringify(options)})}));`);
    const executable = runtime === "npm" ? process.execPath : spawnSync("bun", ["-e", "console.log(process.execPath)"], { encoding: "utf8" }).stdout.trim();
    const run = spawnSync(executable, [entry], { cwd: project, encoding: "utf8", timeout: 120000, env: { ...process.env, GIT_CEILING_DIRECTORIES: root } });
    assert.equal(run.status, 0, `${runtime} ${bound}: ${run.error?.message ?? run.stderr}`);
    const receipt = JSON.parse(run.stdout) as { sdkVersion: string; resolved: string; sdkEntry: string; matrix: { ok: boolean; checks: number; rows: { sdk: string; target: string }[] } };
    assert.equal(receipt.sdkVersion, version, `${runtime} ${bound} resolved SDK`);
    const installedSdk = join(project, "node_modules/@unbrained/pm-cli");
    assert.equal(receipt.resolved, join(installedSdk, "package.json"));
    assert.ok(receipt.sdkEntry.startsWith(`${installedSdk}/`));
    assert.equal(receipt.matrix.ok, true); assert.equal(receipt.matrix.checks, 2);
    assert.deepEqual(receipt.matrix.rows.map(row => row.sdk), [minimumVersion, currentVersion]);
    if (runtime === "npm" && bound === "current") {
      const tracker = join(project, "tracker");
      await new PmClient({ pmRoot: tracker, noExtensions: true, author: "fixture" }).init("packed");
      const cli = join(project, "node_modules/@unbrained/pm-cli/dist/cli.js");
      const activated = spawnSync(process.execPath, [cli, "--pm-path", tracker, "package", "install", join(project, "node_modules/pm-ts-starter"), "--project"], { cwd: project, encoding: "utf8", timeout: 30000 });
      assert.equal(activated.status, 0, activated.stderr);
      for (const format of [[], ["--json"]]) {
        const cliRun = spawnSync(process.execPath, [cli, "--pm-path", tracker, "ts-starter", "sdk-contracts", "--minimum-sdk", endpoints.minimum,
          "--current-sdk", endpoints.current, "--current-version", currentVersion, "--compiler", compiler, ...format], {
          cwd: project, encoding: "utf8", timeout: 120000, env: { ...process.env, PATH: noGit, npm_node_execpath: process.execPath, GIT_CEILING_DIRECTORIES: root },
        });
        assert.equal(cliRun.status, 0, cliRun.stderr);
        if (format.length) assert.equal(JSON.parse(cliRun.stdout).checks, 4);
        else assert.match(cliRun.stdout, /checks: 4/);
      }
    }
    // The same packed module also works with PATH containing no git (or other tools).
    const noGitRun = spawnSync(executable, [entry], {
      cwd: project, encoding: "utf8", timeout: 120000, env: { ...process.env, PATH: noGit, npm_node_execpath: process.execPath, GIT_CEILING_DIRECTORIES: root },
    });
    assert.equal(noGitRun.status, 0, `${runtime} ${bound}: ${noGitRun.error?.message ?? noGitRun.stderr}`);
    assert.equal(JSON.parse(noGitRun.stdout).matrix.ok, true);
  }
});

/** Exact npm and Bun installations used as consumer-owned toolchains, without Git. */
const installedConsumers = new Map<string, string>();
const tscConsumerRoots = new Set<string>();
after(() => { for (const root of tscConsumerRoots) rmSync(root, { recursive: true, force: true }); });
/** Install and runtime-verify each consumer's own exact SDK and compiler. */
function installedConsumer(runtime: "npm" | "bun", bound: "minimum" | "current"): string {
  const key = `${runtime}-${bound}`;
  const cached = installedConsumers.get(key);
  if (cached) return cached;
  const root = mkdtempSync(join(tmpdir(), "sdk-owned-consumer-"));
  tscConsumerRoots.add(root);
  const version = bound === "minimum" ? minimumVersion : currentVersion;
  writeFileSync(join(root, "package.json"), JSON.stringify({ private: true, type: "module" }));
  const packages = [`@unbrained/pm-cli@${version}`, "typescript@7.0.2", "@types/node@26.6.5"];
  const result = spawnSync(runtime, runtime === "npm" ? ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...packages]
    : ["add", "--ignore-scripts", ...packages], { cwd: root, encoding: "utf8", timeout: 120000, env: installationEnv() });
  assert.equal(result.status, 0, result.stderr);
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
function assertLeaseDrift(matrix: SdkContractMatrix): void {
  assert.equal(matrix.failed, 1);
  assert.deepEqual(matrix.rows.map(row => [row.target, row.ok, row.codes]), [["minimum", false, ["TS2551"]], ["current", true, []]]);
}

/** A real installed compiler runs the independent oracle in the very same isolated cwd. */
function instrumentOracle(project: string, receipt: string, t: TestContext): void {
  const bin = join(project, "node_modules/typescript/bin");
  writeFileSync(join(bin, "plain-tsc"), readFileSync(join(bin, "tsc")));
  // Bun may hardlink installed files to its cache: detach before instrumenting.
  unlinkSync(join(bin, "tsc"));
  t.after(() => writeFileSync(join(bin, "tsc"), readFileSync(join(bin, "plain-tsc"))));
  writeFileSync(join(bin, "tsc"), `import {spawnSync} from 'node:child_process';
import {appendFileSync,readFileSync,cpSync,mkdtempSync,rmSync} from 'node:fs'; import {join} from 'node:path'; import {tmpdir} from 'node:os'; import {createRequire} from 'node:module';
const plain = new URL('./plain-tsc', import.meta.url).pathname;
if (process.argv.includes('--help') || process.argv.includes('--showConfig') || process.argv.includes('--listFilesOnly')) {
  const probe = spawnSync(process.execPath, [plain,...process.argv.slice(2)], {stdio:'inherit'}); process.exit(probe.status ?? 1);
}
const baseline = mkdtempSync(join(process.cwd(),'..','sdk-plain-matrix-'));
cpSync(process.cwd(),baseline,{recursive:true});
const oracle = spawnSync(process.execPath, [plain,...process.argv.slice(2)], {cwd:baseline,encoding:'utf8'});
rmSync(baseline,{recursive:true,force:true});
const require = createRequire(process.cwd() + '/package.json');
const sdk = require.resolve('@unbrained/pm-cli/package.json');
appendFileSync(${JSON.stringify(receipt)}, JSON.stringify({cwd:process.cwd(),sdk,version:JSON.parse(readFileSync(sdk)).version,config:readFileSync('tsconfig.json','utf8'),sources:JSON.parse(readFileSync('tsconfig.json')).files.map(file => readFileSync(file,'utf8')),status:oracle.status,output:oracle.stdout}) + '\\n');
const checked = spawnSync(process.execPath, [plain,...process.argv.slice(2)], {stdio:'inherit'});
process.exit(checked.status ?? 1);`);
}

/** A declaration fixture makes each compiler resolution rule distinguishable from Node resolution. */
function declarationLayout(root: string, version: string, layout: string): string {
  mkdirSync(join(root, "sdk"), { recursive: true });
  const good = 'export declare const api: {common: number; onlyImport: number}; export declare const onlyImport: number;';
  const bad = 'export declare const api: {common: number};';
  writeFileSync(join(root, "import.d.ts"), good);
  writeFileSync(join(root, "require.d.cts"), bad);
  writeFileSync(join(root, "fallback.d.ts"), good);
  writeFileSync(join(root, "selected.d.ts"), bad);
  writeFileSync(join(root, "sdk/index.js"), 'exports.api = {common: 1};');
  const metadata: Record<string, unknown> = { name: "@unbrained/pm-cli", version, types: "./fallback.d.ts" };
  if (layout === "typesVersions") metadata.typesVersions = { ">=7.0": { "*": ["selected.d.ts"] } };
  else metadata.exports = { "./package.json": "./package.json", "./sdk": layout === "types"
    ? { import: { types: "./import.d.ts", default: "./sdk/index.js" }, require: { types: "./require.d.cts", default: "./sdk/index.js" } }
    : { "types@>=7.0": "./selected.d.ts", types: "./fallback.d.ts", default: "./sdk/index.js" } };
  writeFileSync(join(root, "package.json"), JSON.stringify(metadata));
  return root;
}

/** Retain the consumer's own complete configuration byte for byte, including skipLibCheck false. */
function consumerConfig(project: string, resolution: string, mode: string): string {
  const config = JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: false, target: "ES2022", types: [],
    moduleResolution: resolution, module: resolution === "bundler" ? "Preserve" : resolution === "node16" ? "Node16" : "NodeNext" },
    files: [`consumer.${mode === "esm" ? "mts" : "cts"}`] }, null, 2);
  writeFileSync(join(project, "tsconfig.json"), config);
  return config;
}

/** Compare every checker row with the plain compiler and the preserved project bytes. */
function compareOracle(matrix: SdkContractMatrix, receipt: string, source: string, config: string): void {
  const records = readFileSync(receipt, "utf8").trim().split("\n").map(line => JSON.parse(line) as {
    cwd: string; sdk: string; version: string; config: string; sources: string[]; status: number; output: string;
  });
  assert.equal(records.length, matrix.rows.length);
  for (const [index, row] of matrix.rows.entries()) {
    const oracle = records[index]!;
    assert.notEqual(oracle.cwd, source, "compile in an isolated copy");
    assert.equal(oracle.sdk, join(oracle.cwd, "node_modules/@unbrained/pm-cli/package.json"));
    assert.equal(oracle.version, row.sdk, "runtime resolution must find this bound's own installation");
    assert.equal(oracle.config, config, "copy the consumer tsconfig unchanged");
    assert.deepEqual(oracle.sources, (JSON.parse(config) as {files: string[]}).files.map(file => readFileSync(join(source, file), "utf8")), "copy consumer sources unchanged");
    assert.equal(row.ok, oracle.status === 0, `${row.target}: ${oracle.output}`);
    assert.equal(row.diagnostic_count, oracle.status === 0 ? 0 : (oracle.output.match(/^(?:.+\(\d+,\d+\): )?error TS\d+:/gm) ?? []).length);
  }
}

test("differential compiler matrix covers node16 nodenext bundler, ESM import CJS require, types types@ typesVersions and both bounds", async t => {
  const root = scratch(t);
  let rows = 0, drift = 0;
  for (const runtime of ["npm", "bun"] as const) {
    // Both installed endpoints are independently verified under this package manager.
    const project = installedConsumer(runtime, "minimum");
    installedConsumer(runtime, "current");
    const receipt = join(root, `${runtime}.jsonl`);
    instrumentOracle(project, receipt, t);
    for (const layout of ["types", "types@", "typesVersions"]) {
      const minimum = { root: declarationLayout(join(root, `${runtime}-${layout}-min`), minimumVersion, layout), version: minimumVersion };
      const current = { root: declarationLayout(join(root, `${runtime}-${layout}-cur`), currentVersion, layout), version: currentVersion };
      for (const resolution of ["node16", "nodenext", "bundler"]) for (const mode of ["esm", "cjs"]) {
        const config = consumerConfig(project, resolution, mode);
        for (const control of ["common", "onlyImport"]) {
          const source = mode === "esm" ? `import {api${control === "onlyImport" ? ", onlyImport" : ""}} from "@unbrained/pm-cli/sdk"; export const use = api.${control};`
            : `import sdk = require("@unbrained/pm-cli/sdk"); ${control === "onlyImport" ? 'import {onlyImport} from "@unbrained/pm-cli/sdk";' : ""} export const use = sdk.api.${control};`;
          writeFileSync(join(project, `consumer.${mode === "esm" ? "mts" : "cts"}`), source);
          writeFileSync(receipt, "");
          const matrix = await checkSdkContracts({ minimum, current, consumer: project });
          compareOracle(matrix, receipt, project, config);
          const expected = control === "common" || (layout === "types" && mode === "esm");
          assert.equal(matrix.ok, expected, `${runtime}/${layout}/${resolution}/${mode}/${control}`);
          if (!expected) for (const row of matrix.rows) {
            assert.ok(row.codes.includes("TS2339"), row.codes.join(","));
            assert.ok(row.codes.includes("TS2305"), row.codes.join(","));
            assert.ok(row.diagnostics.every(diagnostic => diagnostic.line > 0 && diagnostic.column > 0));
          }
          rows += matrix.checks; drift += matrix.failed;
        }
      }
    }
  }
  assert.equal(rows, 144); assert.equal(drift, 60);
  t.diagnostic(`Differential matrix: ${rows}/${rows} compiler verdicts agree; ${drift} drift, ${rows - drift} clean.`);
});

test("differential hostile specifiers in consumer and external declarations preserve every earlier row at both bounds", async t => {
  const root = scratch(t), project = installedConsumer("npm", "current");
  const receipt = join(root, "hostile.jsonl"); instrumentOracle(project, receipt, t);
  const config = consumerConfig(project, "nodenext", "esm");
  const minimum = { root: declarationLayout(join(root, "min"), minimumVersion, "types"), version: minimumVersion };
  const current = { root: declarationLayout(join(root, "cur"), currentVersion, "types"), version: currentVersion };
  let rows = 0;
  for (const location of ["consumer", "declaration"]) for (const [id, specifier] of hostileSpecifiers) {
    const literal = id.startsWith("raw-") ? `"${specifier}"` : JSON.stringify(specifier);
    const source = `import * as sdk from ${literal}; export declare const api: typeof sdk;`;
    writeFileSync(join(project, "contract.d.mts"), source);
    writeFileSync(join(project, "consumer.mts"), location === "consumer" ? source : 'import {api} from "./contract.mjs"; export const use = api;');
    writeFileSync(receipt, "");
    const matrix = await checkSdkContracts({ minimum, current, consumer: project });
    compareOracle(matrix, receipt, project, config);
    assert.equal(matrix.failed, 2, `${location}/${id}`);
    assert.ok(matrix.rows.every(row => row.codes.some(code => /^(TS2307|TS1002)$/.test(code))));
    rows += matrix.checks;
  }
  assert.equal(rows, 64);
  t.diagnostic(`Hostile differential: ${rows}/${rows} compiler verdicts agree.`);
});

test("consumer checking options pass unchanged to the real compiler", async t => {
  const project = linkedCompilerConsumer(t);
  for (const name of ["skipLibCheck", "skipDefaultLibCheck", "noCheck", "noResolve"]) {
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], module: "NodeNext", [name]: true}, files: ["consumer.mts"]}));
    writeFileSync(join(project, "consumer.mts"), "export const value: string = 1;");
    const plain = plainCopy(project, t), before = filesystemSnapshot(project);
    assertPlainRows(await checkSdkContracts({minimum: target, current: target, consumer: project}), plain);
    assert.equal(filesystemSnapshot(project), before);
  }
});

test("project inputs refuse ambiguous options and missing compilers; diagnostics retain safe locations without code filtering", async t => {
  const root = scratch(t);
  for (const patch of [{ consumer: 1 }, { consumer: " " }, { consumer: root, examples: SDK_CONSUMER_EXAMPLES }, { consumer: root, compiler }]) {
    await assert.rejects(checkSdkContracts({ minimum: target, current: target, ...patch } as SdkContractOptions), refuses("invalid_input"));
  }
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "sentinel"), "foreign state");
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ files: ["consumer.ts"] }));
  await assert.rejects(checkSdkContracts({ minimum: target, current: target, consumer: root }), refuses("compiler_unavailable"));
  const stub = join(root, "diagnostics.cjs");
  const output = `error TS5099: private configuration text\n${join(root, "secret.ts")}(2,3): error TS9999: private source text\nconsumer.ts(4,5): error TS2322: private source text\n`;
  writeFileSync(stub, `const {spawnSync} = require("node:child_process");
if (process.argv.includes("--help") || process.argv.includes("--showConfig") || process.argv.includes("--listFilesOnly")) { const result = spawnSync(process.execPath, [require('node:path').join(process.cwd(),'node_modules/typescript/bin/tsc'), ...process.argv.slice(2)], {stdio:"inherit"}); process.exit(result.status ?? 1); }
process.stdout.write(${JSON.stringify(output)}); process.exit(1);`);
  const matrix = await checkSdkContracts({ minimum: target, current: target, compiler: stub, examples: [SDK_CONSUMER_EXAMPLES[0]!] });
  assert.equal(matrix.failed, 2);
  assert.deepEqual(matrix.rows[0]!.diagnostics, [
    {code: "TS5099", file: "<config>", line: 0, column: 0, message: "private configuration text"},
    {code: "TS9999", file: "<external>", line: 2, column: 3, message: "private source text"},
    {code: "TS2322", file: "consumer.ts", line: 4, column: 5, message: "private source text"},
  ]);
  assert.doesNotMatch(JSON.stringify(matrix), /secret\.ts/);
});

test("review reproductions require and versioned types declarations report TS2339 and TS2305 instead of false success", async t => {
  const root = scratch(t);
  for (const layout of ["types", "types@"]) await t.test(layout, async () => {
    const project = join(root, layout);
    const rootSdk = declarationLayout(join(project, "node_modules/@unbrained/pm-cli"), pinned, layout);
    const contract = join(project, "contract.d.cts");
    writeFileSync(contract, 'import sdk = require("@unbrained/pm-cli/sdk"); import {onlyImport} from "@unbrained/pm-cli/sdk"; export declare const use: typeof sdk.api.onlyImport;');
    symlinkSync(dirname(dirname(compiler)), join(project, "node_modules/typescript"), "junction");
    writeFileSync(join(project, "consumer.cts"), 'import {use} from "./contract.cjs"; export const value = use;');
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], noEmit: true, module: "NodeNext"}, files: ["consumer.cts"]}));
    const matrix = await checkSdkContracts({minimum: {root: rootSdk, version: pinned}, current: {root: rootSdk, version: pinned}, consumer: project});
    assert.equal(matrix.failed, 2, `${layout}: both selected bounds must reject the consumer`);
    for (const row of matrix.rows) {
      assert.ok(row.codes.includes("TS2305"), `${layout}: ${row.codes}`);
      assert.ok(row.codes.includes("TS2339"), `${layout}: ${row.codes}`);
    }
  });
});

test("native SDK exports honor string, conditional, wildcard, blocked and missing-file targets", async t => {
  const root = join(scratch(t), "sdk"); cpSync(sdk, root, { recursive: true });
  const file = join(root, "package.json");
  const metadata = JSON.parse(readFileSync(file, "utf8")) as { exports: Record<string, unknown> };
  Object.assign(metadata.exports, {
    "./sdk/string": "./dist/sdk/authoring.d.ts",
    "./sdk/conditional": { import: { types: "./dist/sdk/authoring.d.ts" } },
    "./sdk/pattern/*": { types: "./dist/sdk/*.d.ts" },
    "./sdk/blocked": null,
    "./sdk/missing-file": { types: "./dist/sdk/does-not-exist.d.ts" },
    "./sdk/quoted'alias": { types: "./dist/sdk/authoring.d.ts" },
  });
  writeFileSync(file, JSON.stringify(metadata));
  const names = ["string", "conditional", "pattern/authoring", "blocked", "missing-file", "quoted'alias"];
  const result = await checkSdkContracts({ minimum: { root, version: pinned }, current: { root, version: pinned }, compiler,
    examples: names.map((name, index) => ({ id: `export-${index}`, source: `import * as sdk from "@unbrained/pm-cli/sdk/${name}"; export const api = sdk;` })) });
  assert.equal(result.failed, 4); assert.equal(result.checks, 12);
  for (const row of result.rows) {
    const missing = ["export-3", "export-4"].includes(row.example);
    assert.equal(row.ok, !missing);
    if (missing) assert.ok(row.codes.includes("TS2307"));
  }
});

test("copied external declarations resolve newer-only real SDK APIs as minimum drift under npm and Bun", async t => {
  const root = scratch(t);
  for (const runtime of ["npm", "bun"] as const) {
    const project = installedConsumer(runtime, "current");
    const config = consumerConfig(project, "nodenext", "esm").replace('"types": []', '"types": ["node"]');
    writeFileSync(join(project, "tsconfig.json"), config);
    writeFileSync(join(project, "contract.d.mts"), 'import * as sdk from "@unbrained/pm-cli/sdk"; export declare const publicSdk: typeof sdk;');
    writeFileSync(join(project, "consumer.mts"), 'import {publicSdk} from "./contract.mjs"; export const lease = publicSdk.acquireLockLease;');
    const receipt = join(root, `${runtime}.jsonl`); instrumentOracle(project, receipt, t);
    const matrix = await checkSdkContracts({
      minimum: { root: join(installedConsumer(runtime, "minimum"), "node_modules/@unbrained/pm-cli"), version: minimumVersion },
      current: { root: join(project, "node_modules/@unbrained/pm-cli"), version: currentVersion }, consumer: project,
    });
    compareOracle(matrix, receipt, project, config);
    assertLeaseDrift(matrix);
  }
});

test("an inline compiler installation without ambient Node types reports TS2688 rather than ignoring environment errors", async t => {
  const root = scratch(t), modules = join(root, "node_modules");
  mkdirSync(modules);
  symlinkSync(join(repo, "node_modules/typescript"), join(modules, "typescript"), "junction");
  const matrix = await checkSdkContracts({ minimum: target, current: target, compiler: join(modules, "typescript/bin/tsc"),
    examples: [{ id: "ambient", source: "export const value = 1;" }] });
  assert.equal(matrix.failed, 2);
  assert.ok(matrix.rows.every(row => row.codes.includes("TS2688")));
});

test("local declaration imports retain newer-only acquireLockLease drift at each SDK bound", async t => {
  const project = installedConsumer("npm", "current"), endpoints = publishedSdks();
  const config = JSON.parse(consumerConfig(project, "nodenext", "esm")) as {compilerOptions: Record<string, unknown>};
  config.compilerOptions.types = ["node"];
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify(config));
  const source = 'import * as sdk from "@unbrained/pm-cli/sdk"; export declare const publicSdk: typeof sdk;';
  for (const [quote, suffix] of [['"', ".d.mts"], ["'", ".d.mts"], ['"', ".d.ts"], ['"', ".d.cts"]]) {
    const declaration = "contract" + suffix!;
    writeFileSync(join(project, declaration), source);
    const specifier = "./" + declaration.replace(/\.d\.mts$/, ".mjs").replace(/\.d\.cts$/, ".cjs").replace(/\.d\.ts$/, ".js");
    writeFileSync(join(project, "consumer.mts"), `import {publicSdk} from ${quote}${specifier}${quote}; export const lease = publicSdk.acquireLockLease;`);
    const matrix = await checkSdkContracts({minimum: {root: endpoints.minimum, version: minimumVersion}, current: {root: endpoints.current, version: currentVersion}, consumer: project});
    assertLeaseDrift(matrix);
    assert.equal(readFileSync(join(project, declaration), "utf8"), source);
  }
});

/** Prepare a real consumer with an independently provisionable compiler artifact. */
function linkedCompilerConsumer(t: TestContext): string {
  const project = join(scratch(t), "consumer");
  mkdirSync(join(project, "node_modules"), {recursive: true});
  symlinkSync(dirname(dirname(compiler)), join(project, "node_modules/typescript"), "junction");
  return project;
}

/** Create a minimal consumer with noEmit enabled for toolchain boundary regressions. */
function noEmitConsumer(t: TestContext): string {
  const project = linkedCompilerConsumer(t);
  writeFileSync(join(project, "consumer.mts"), 'export const value = 1;');
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], noEmit: true, module: "NodeNext"}, files: ["consumer.mts"]}));
  return project;
}
/** Stable diagnostic presentation for independent real-compiler oracles. */
const plainPresentation = Object.keys({pretty: false, traceResolution: false, explainFiles: false, diagnostics: false, extendedDiagnostics: false, listFiles: false, listEmittedFiles: false}).flatMap(key => [`--${key}`, "false"]);

/** Invoke the independent real compiler using the explicit typecheck presentation flags. */
function plainProject(project: string) {
  return spawnSync(process.execPath, [compiler, "--project", "tsconfig.json", "--noEmit", ...plainPresentation, "--locale", "en"], {cwd: project, encoding: "utf8"});
}

/** Restore only the environment variables changed by an isolated fixture. */
function restoreEnvironment(keys: readonly string[], previous: readonly (string | undefined)[]): void {
  for (const [index, key] of keys.entries()) { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }
}

test("resolved trace text resembling diagnostics preserves a successful native compiler verdict", async t => {
  const project = linkedCompilerConsumer(t), name = "trace\nerror TS9999: forged";
  writeFileSync(join(project, "consumer.mts"), `import {value} from ${JSON.stringify(name)}; export const use = value;`);
  writeFileSync(join(project, "ambient.d.ts"), `declare module ${JSON.stringify(name)} { export const value: number; }`);
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {target: "ES2022", module: "NodeNext", types: [],
    traceResolution: true, moduleDetection: "legacy", outDir: "dist"}, files: ["consumer.mts", "ambient.d.ts"]}));
  const plain = spawnSync(process.execPath, [compiler, "--project", "tsconfig.json", "--noEmit", "--pretty", "false", "--locale", "en"], {cwd: project, encoding: "utf8"});
  assert.equal(plain.status, 0, plain.stdout); assert.match(plain.stdout, /^error TS9999:/m);
  const before = filesystemSnapshot(project);
  const matrix = await checkSdkContracts({minimum: target, current: target, consumer: project});
  assert.equal(matrix.ok, true); assert.equal(matrix.checks, 2);
  assert.ok(matrix.rows.every(row => row.diagnostic_count === 0));
  assert.equal(filesystemSnapshot(project), before);
});

test("all supplementary output options preserve plain compiler verdicts and unchanged caller metadata", async t => {
  const project = linkedCompilerConsumer(t);
  for (const name of ["traceResolution", "explainFiles", "diagnostics", "extendedDiagnostics", "listFiles", "listEmittedFiles"]) {
    for (const failing of [false, true]) {
      writeFileSync(join(project, "consumer.mts"), failing ? "export const use: string = 1;" : "export const use = 1;");
      writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {target: "ES2022", module: "NodeNext", types: [], [name]: true, outDir: "dist"}, files: ["consumer.mts"]}));
      const plain = plainProject(project);
      const before = filesystemSnapshot(project);
      const matrix = await checkSdkContracts({minimum: target, current: target, consumer: project});
      const codes = [...plain.stdout.matchAll(/error (TS\d+):/g)].map(match => match[1]);
      for (const row of matrix.rows) {
        assert.equal(row.ok, plain.status === 0, name);
        assert.deepEqual(row.codes, codes, name);
      }
      assert.equal(filesystemSnapshot(project), before, name);
    }
  }
  t.diagnostic("Supplementary output: 12 configurations and 24 bound comparisons agree with plain tsc; caller metadata remains unchanged.");
});

test("diagnostic presentation leaves config bytes unchanged and parses pretty-false compiler output", async t => {
  const project = linkedCompilerConsumer(t);
  writeFileSync(join(project, "consumer.mts"), "export const use: string = 1;");
  for (const pretty of [false, true]) {
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {target: "ES2022", module: "NodeNext", types: [], locale: "de", pretty, outDir: "dist"}, files: ["consumer.mts"]}));
    const plain = plainProject(project);
    assert.notEqual(plain.status, 0, plain.stdout); assert.match(plain.stdout, /TS2322:/);
    const before = filesystemSnapshot(project);
    const matrix = await checkSdkContracts({minimum: target, current: target, consumer: project});
    assert.equal(matrix.failed, 2);
    const expectedCodes = [...plain.stdout.matchAll(/\b(TS\d+):/g)].map(match => match[1]);
    for (const row of matrix.rows) {
      assert.deepEqual(row.codes, expectedCodes);
      assert.deepEqual(row.diagnostics.find(diagnostic => diagnostic.code === "TS2322"), {code: "TS2322", file: "consumer.mts", line: 1, column: 14, message: "Type 'number' is not assignable to type 'string'."});
    }
    assert.equal(filesystemSnapshot(project), before);
  }
});

test("nonexecutable compiler shims receive a typed tooling refusal", async t => {
  const entry = join(scratch(t), "compiler-shim");
  writeFileSync(entry, "#!/bin/sh\nexit 0\n");
  await assert.rejects(checkSdkContracts({minimum: target, current: target, compiler: entry}), refuses("compiler_unavailable"));
});

test("compiler entries run in place: ESM wrapper, CJS wrapper, lib/tsc.js and bin shim", async t => {
  const root = scratch(t), receipt = join(root, "receipt.jsonl");
  const helper = `const {spawnSync} = require('node:child_process'); const {appendFileSync,existsSync} = require('node:fs');
for (const key of ['NODE_PATH','NODE_OPTIONS','NODE_COMPILE_CACHE','BUN_RUNTIME_TRANSPILER_CACHE_PATH','TS_NODE_PROJECT','TSC_WATCHFILE','TSGO_TEST_SETTING']) if (process.env[key] !== undefined) throw new Error('inherited resolution state');
if (process.env.NODE_V8_COVERAGE !== '') throw new Error('inherited coverage output');
if (existsSync('compiler.cjs')) throw new Error('custom wrapper copied');
if (!existsSync('node_modules/typescript/bin/tsc')) throw new Error('isolated compiler missing');
appendFileSync(${JSON.stringify(receipt)}, JSON.stringify({entry:process.argv[1],cwd:process.cwd(),args:process.argv.slice(2)})+'\\n');
const result = spawnSync(process.execPath,[require('node:path').join(process.cwd(),'node_modules/typescript/bin/tsc'),...process.argv.slice(2)],{stdio:'inherit'}); process.exit(result.status ?? 1);`;
  writeFileSync(join(root, "helper.cjs"), helper);
  writeFileSync(join(root, "wrapper.cjs"), 'require("./helper.cjs");');
  writeFileSync(join(root, "wrapper.mjs"), 'import "./helper.cjs";');
  const shim = join(root, "bin-shim");
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  writeFileSync(shim, `#!/bin/sh\nexec ${quote(process.execPath)} "$PWD/node_modules/typescript/bin/tsc" "$@"\n`); chmodSync(shim, 0o755);
  const keys = ["NODE_PATH", "NODE_OPTIONS", "NODE_V8_COVERAGE", "NODE_COMPILE_CACHE", "BUN_RUNTIME_TRANSPILER_CACHE_PATH", "TS_NODE_PROJECT", "TSC_WATCHFILE", "TSGO_TEST_SETTING"];
  const saved = keys.map(key => process.env[key]);
  try {
    for (const key of keys) process.env[key] = "private-inherited-setting";
    for (const [kind, entry] of [["esm", join(root, "wrapper.mjs")], ["cjs", join(root, "wrapper.cjs")],
      ["library", join(repo, "node_modules/typescript/lib/tsc.js")], ["shim", shim], ["javascript-shim", join(repo, "node_modules/.bin/tsc")]]) await t.test(kind!, async () => {
      const before = readFileSync(entry!);
      const matrix = await checkSdkContracts({ minimum: target, current: target, compiler: entry, examples: [SDK_CONSUMER_EXAMPLES[0]!] });
      assert.equal(matrix.ok, true); assert.equal(matrix.checks, 2);
      assert.deepEqual(readFileSync(entry!), before);
    });
  } finally { for (const [index, key] of keys.entries()) { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; } }
  const records = readFileSync(receipt, "utf8").trim().split("\n").map(line => JSON.parse(line) as {entry: string; cwd: string; args: string[]});
  const compilations = records.filter(row => !row.args.includes("--help") && !row.args.includes("--showConfig") && !row.args.includes("--listFilesOnly"));
  assert.equal(compilations.length, 4);
  assert.ok(compilations.every(row => JSON.stringify(row.args) === JSON.stringify(["--project", "tsconfig.json", "--noEmit", ...plainPresentation, "--locale", "en"])), "compiler delegation only adds typecheck and presentation flags");
  assert.ok(records.every(row => [join(root, "wrapper.mjs"), join(root, "wrapper.cjs")].includes(row.entry) && row.cwd !== root));
  assert.equal(records.filter(row => row.args.includes("--help")).length, 2, "query each wrapper once across both targets");
});

test("post-compile isolation refuses resolved external inputs and preserves native missing-input diagnostics", async t => {
  const root = scratch(t), project = installedConsumer("npm", "current");
  const config = consumerConfig(project, "nodenext", "esm");
  const external = join(root, "external.d.mts"); writeFileSync(external, "export declare const value: number;");
  const outside = external.replace(/\.d\.mts$/, ".mjs");
  writeFileSync(join(project, "bridge.d.mts"), `export {value} from ${JSON.stringify(outside)};`);
  for (const source of [`import {value} from ${JSON.stringify(outside)}; export const use = value;`,
    `/// <reference path=${JSON.stringify(external)} />\nexport const use = 1;`,
    'import {value} from "./bridge.mjs"; export const use = value;']) {
    writeFileSync(join(project, "consumer.mts"), source);
    await assert.rejects(checkSdkContracts({minimum: target, current: target, consumer: project}), error => {
      if (!(error instanceof SdkContractRefusal)) return false;
      assert.match(error.remedy, /Resolved file "external\.d\.mts"/);
      assert.doesNotMatch(error.remedy, /sdk-consumer-test/);
      return error.code === "isolation_refused";
    });
  }
  for (const source of [`export * from ${JSON.stringify(join(root, "missing.mjs"))};`,
    `/// <reference path=${JSON.stringify(join(root, "missing.d.ts"))} />\nexport const use = 1;`]) {
    writeFileSync(join(project, "consumer.mts"), source);
    const plain = plainProject(project);
    const matrix = await checkSdkContracts({minimum: target, current: target, consumer: project});
    assert.ok(matrix.rows.every(row => !row.ok));
    for (const row of matrix.rows) assert.deepEqual(row.codes, [...plain.stdout.matchAll(/error (TS\d+):/g)].map(match => match[1]));
  }
  writeFileSync(join(project, "consumer.mts"), "export const use = 1;");
  for (const patch of [{paths: {unused: [external]}}, {typeRoots: [root]}, {baseUrl: root}, {rootDirs: [root]}, {rootDir: root}]) {
    const changed = JSON.parse(config) as {compilerOptions: Record<string, unknown>}; Object.assign(changed.compilerOptions, patch);
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify(changed));
    const matrix = await checkSdkContracts({minimum: target, current: target, consumer: project});
    assertPlainRows(matrix, plainCopy(project, t));
  }
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({...JSON.parse(config), files: [external]}));
  await assert.rejects(checkSdkContracts({minimum: target, current: target, consumer: project}), refuses("isolation_refused"));
  const alternate = join(project, "vendor/alternate-sdk");
  declarationLayout(alternate, pinned, "types");
  writeFileSync(join(project, "tsconfig.json"), config);
  writeFileSync(join(project, "consumer.mts"), 'export {api} from "./vendor/alternate-sdk/import.js";');
  await assert.rejects(checkSdkContracts({minimum: target, current: target, consumer: project}), error => {
    assert.ok(error instanceof SdkContractRefusal);
    assert.match(error.remedy, /vendor\/alternate-sdk\/import\.d\.ts/);
    return error.code === "isolation_refused";
  });
});

test("hermetic provenance fails closed on empty, forged and post-compilation external file lists", async t => {
  const root = scratch(t), entry = join(root, "compiler.cjs"), external = join(root, "external.d.ts");
  writeFileSync(external, "export declare const value: number;");
  for (const mode of ["empty", "forged", "missing", "indented", "post", "config", "diagnostics"]) {
    writeFileSync(entry, `const {spawnSync}=require('node:child_process'); const {existsSync,writeFileSync}=require('node:fs');
const marker = require('node:path').join(process.cwd(),'checked');
if (['config','config-path'].includes(${JSON.stringify(mode)}) && process.argv.includes('--showConfig')) {process.stdout.write(${JSON.stringify(mode === 'config-path' ? JSON.stringify({compilerOptions: {paths: {unused: [7]}}, files: ['consumer.ts']}) : '{}')}); process.exit(0);}
if (${JSON.stringify(mode)} === 'diagnostics' && !process.argv.includes('--help') && !process.argv.includes('--showConfig') && !process.argv.includes('--listFilesOnly')) {process.stdout.write('noise error TS9999:'); process.exit(1);}
if (process.argv.includes('--listFilesOnly') && (!['post','config','diagnostics'].includes(${JSON.stringify(mode)}) || existsSync(marker))) {
  process.stdout.write(${mode === "indented" ? `require("node:path").join(process.cwd(),"consumer.ts") + ${JSON.stringify(`\n  ${external}\n`)}` : JSON.stringify(mode === "empty" ? "" : mode === "forged" ? `unstructured ${external}\n` : mode === "missing" ? `${external}.missing\n` : `${external}\n`)}); process.exit(0);
}
const result=spawnSync(process.execPath,[require('node:path').join(process.cwd(),'node_modules/typescript/bin/tsc'),...process.argv.slice(2)],{stdio:'inherit'});
if (!process.argv.includes('--help') && !process.argv.includes('--showConfig') && !process.argv.includes('--listFilesOnly')) writeFileSync(marker,'compiled'); process.exit(result.status ?? 1);`);
    await assert.rejects(checkSdkContracts({ minimum: target, current: target, compiler: entry, examples: [SDK_CONSUMER_EXAMPLES[0]!] }), refuses(mode === "diagnostics" ? "compiler_unavailable" : "isolation_refused"));
  }
});

test("project copies preserve declaration module kind, nested imports and reference directives", async t => {
  const project = linkedCompilerConsumer(t);
  writeFileSync(join(project, "package.json"), JSON.stringify({type: "module"}));
  const selected = {root: declarationLayout(join(scratch(t), "sdk"), pinned, "types"), version: pinned};
  cpSync(selected.root, join(project, "node_modules/@unbrained/pm-cli"), {recursive: true});
  writeFileSync(join(project, "leaf.d.ts"), 'import {api} from "@unbrained/pm-cli/sdk"; export declare const use: typeof api.onlyImport;');
  writeFileSync(join(project, "parent.d.mts"), 'export {use} from "./leaf.js";');
  writeFileSync(join(project, "globals.d.mts"), "export {}; declare global { type ReferenceValue = number; }");
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], module: "NodeNext", noEmit: true}, files: ["consumer.mts"]}));
  for (const source of [
    'import {use} from "./leaf.js"; import {use as again} from "./leaf.js"; export const value = [use, again, "/"];',
    'import {use} from "./parent.mjs"; export const value = use;',
    '/// <reference path="./globals.d.mts" />\nexport const value: ReferenceValue = 1;',
  ]) {
    writeFileSync(join(project, "consumer.mts"), source);
    const expected = plainCopy(project, t);
    const matrix = await checkSdkContracts({minimum: selected, current: selected, consumer: project});
    assert.equal(matrix.ok, true); assert.equal(matrix.checks, 2);
    assertPlainRows(matrix, expected);
    assert.equal(readFileSync(join(project, "consumer.mts"), "utf8"), source);
  }
});

test("inline sources are unchanged; actual external declarations refuse after compiler resolution", async t => {
  const root = scratch(t), declaration = join(root, "external.d.mts");
  writeFileSync(declaration, 'export declare const value: number;');
  const source = `import {value} from ${JSON.stringify(declaration.replace(".d.mts", ".mjs"))}; export const use = value;`;
  await assert.rejects(checkSdkContracts({minimum: target, current: target, examples: [{id: "external", source}]}), error => {
    assert.ok(error instanceof SdkContractRefusal);
    assert.match(error.remedy, /Resolved file "external\.d\.mts"/);
    return error.code === "isolation_refused";
  });
  const missing = await checkSdkContracts({minimum: target, current: target, examples: [{id: "missing", source: `export * from ${JSON.stringify(join(root, "missing.mjs"))};`}]});
  assert.ok(missing.rows.every(row => !row.ok && row.codes.includes("TS2307")));
  const literals = await checkSdkContracts({minimum: target, current: target, examples: [{id: "literal", source: 'export const data = `from "/ordinary/data.js"`;'}]});
  assert.equal(literals.ok, true, "path-like string content must reach the compiler unchanged");
});

test("hermetic local config references and unused internal aliases agree with plain tsc", async t => {
  const root = scratch(t), reference = join(root, "reference");
  mkdirSync(join(root, "node_modules")); mkdirSync(reference);
  symlinkSync(join(repo, "node_modules/typescript"), join(root, "node_modules/typescript"), "junction");
  writeFileSync(join(root, "package.json"), JSON.stringify({type: "module"}));
  writeFileSync(join(reference, "tsconfig.json"), JSON.stringify({compilerOptions: {composite: true, target: "ES2022", module: "NodeNext", types: [], outDir: "dist"}, files: ["index.ts"]}));
  writeFileSync(join(reference, "index.ts"), "export const value = 1;");
  const build = spawnSync(process.execPath, [compiler, "--build", "reference"], {cwd: root, encoding: "utf8"}); assert.equal(build.status, 0, build.stdout);
  const config = JSON.parse(consumerConfig(root, "nodenext", "esm")) as {compilerOptions: Record<string, unknown>; references?: {path: string}[]};
  Object.assign(config.compilerOptions, {paths: {unused: ["./reference/index.ts"]}, typeRoots: ["./node_modules/@types"], rootDirs: ["."]});
  config.references = [{path: "./reference"}];
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify(config));
  writeFileSync(join(root, "consumer.mts"), 'import {value} from "./reference/dist/index.js"; import {version} from "typescript"; export const use = {value, version};');
  const plain = plainCopy(root, t); assert.equal(plain.ok, true);
  const matrix = await checkSdkContracts({minimum: target, current: target, consumer: root});
  assert.equal(matrix.ok, plain.ok); assert.equal(matrix.checks, 2);
  // A missing referenced build must remain an error; dropping references would
  // silently compile the referenced source instead of checking its built contract.
  writeFileSync(join(root, "consumer.mts"), 'import {value} from "./reference/index.js"; export const use = value;');
  unlinkSync(join(reference, "dist/index.d.ts"));
  const missing = plainCopy(root, t);
  assert.equal(missing.ok, false);
  assert.ok(missing.codes.includes("TS6305"));
  const rejected = await checkSdkContracts({minimum: target, current: target, consumer: root});
  assert.equal(rejected.failed, 2, "retain project references and refuse missing build declarations");
  assert.ok(rejected.rows.every(row => row.codes.includes("TS6305")));
});

test("hermetic inherited config preserves alias origins and explicit libraries against plain tsc", async t => {
  const root = scratch(t), configRoot = join(root, "config");
  mkdirSync(configRoot); mkdirSync(join(root, "node_modules"));
  symlinkSync(join(repo, "node_modules/typescript"), join(root, "node_modules/typescript"), "junction");
  writeFileSync(join(root, "package.json"), JSON.stringify({type: "module"}));
  writeFileSync(join(configRoot, "base.json"), JSON.stringify({compilerOptions: {target: "ES2022", module: "NodeNext", strict: true, types: [], lib: ["ES2022"], paths: {inherited: ["./contract.d.mts"]}}}));
  writeFileSync(join(configRoot, "contract.d.mts"), "export declare const value: number;");
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({extends: "./config/base.json", files: ["consumer.mts"]}));
  writeFileSync(join(root, "consumer.mts"), 'import {value} from "inherited"; export const use = value;');
  const plain = plainCopy(root, t);
  assert.equal(plain.ok, true);
  const before = filesystemSnapshot(root);
  const matrix = await checkSdkContracts({minimum: target, current: target, consumer: root});
  assert.equal(matrix.ok, plain.ok); assert.equal(matrix.checks, 2);
  assert.equal(filesystemSnapshot(root), before);
});


test("new compiler options do not require checker classification", async t => {
  const root = scratch(t), entry = join(root, "compiler.cjs");
  writeFileSync(entry, `const {spawnSync} = require('node:child_process');
const result = spawnSync(process.execPath,[require('node:path').join(process.cwd(),'node_modules/typescript/bin/tsc'),...process.argv.slice(2)],{encoding:'utf8'});
process.stdout.write(result.stdout + (process.argv.includes('--help') ? '\\n--futureCheckingOption\\ntype: boolean\\n' : '')); process.stderr.write(result.stderr); process.exit(result.status ?? 1);`);
  assert.equal((await checkSdkContracts({minimum: target, current: target, compiler: entry, examples: [SDK_CONSUMER_EXAMPLES[0]!]})).ok, true);
});

test("compiler config inspection crash and malformed JSON retain typed refusals and cleanup after option discovery", async t => {
  const root = scratch(t), entry = join(root, "compiler.cjs"), receipt = join(root, "calls.jsonl");
  for (const failure of ["crash", "malformed"]) {
    writeFileSync(receipt, "");
    writeFileSync(entry, `const {spawnSync} = require('node:child_process'); const {appendFileSync} = require('node:fs');
const discovery = process.argv.includes('--help');
appendFileSync(${JSON.stringify(receipt)}, (discovery ? 'help' : 'config') + '\\n');
if (!discovery) { ${failure === "crash" ? "process.exit(7);" : "process.stdout.write('not JSON'); process.exit(0);"} }
const result = spawnSync(process.execPath, [require('node:path').join(process.cwd(),'node_modules/typescript/bin/tsc'), ...process.argv.slice(2)], {stdio:'inherit'});
process.exit(result.status ?? 1);`);
    const phases: string[] = [];
    await assert.rejects(checkSdkContracts({minimum: target, current: target, compiler: entry,
      examples: [SDK_CONSUMER_EXAMPLES[0]!], onProgress: phase => { phases.push(phase); }}), refuses(failure === "crash" ? "compiler_unavailable" : "isolation_refused"));
    assert.deepEqual(readFileSync(receipt, "utf8").trim().split("\n"), ["help", "config"]);
    assert.deepEqual(phases, ["allocated", "linked", "cleanup"]);
  }
});

/** Each corpus member changes original discovery or diagnostic presentation independently. */
interface DiscoveryCase {
  name: string;
  config: Record<string, unknown>;
  files?: Record<string, string>;
  build?: boolean;
}

test("original discovery differential corpus equals plain tsc file lists, verdicts and error codes", async t => {
  const project = scratch(t);
  const base = installedConsumer("npm", "current"), endpoints = publishedSdks();
  cpSync(join(base, "node_modules"), join(project, "node_modules"), {recursive: true});
  writeFileSync(join(project, "package.json"), JSON.stringify({type: "module"}));
  const options = {strict: true, skipLibCheck: false, target: "ES2022", module: "NodeNext", types: []};
  const good = 'import {value} from "./contract.mjs"; export const use = value;';
  const bad = 'import {nonexistentSdkExportForDiscovery} from "@unbrained/pm-cli/sdk/authoring"; export const use = nonexistentSdkExportForDiscovery;';
  const stale = 'declare module "@unbrained/pm-cli/sdk/authoring" { export const nonexistentSdkExportForDiscovery: number; }';
  const corpus: DiscoveryCase[] = [
    {name: "include", config: {include: ["input/src/**/*.mts"]}},
    {name: "exclude-stale", config: {include: ["input/**/*"], exclude: ["input/excluded"]}, files: {"excluded/stale.d.ts": stale}},
    {name: "explicit-files-clear-include", config: {files: ["input/src/consumer.mts"], include: []}, files: {"ignored/stale.d.ts": stale}},
    {name: "explicit-files-override-exclude", config: {files: ["input/src/consumer.mts"], exclude: ["input"]}},
    {name: "implicit-outDir-stale", config: {compilerOptions: {outDir: "input/dist", types: ["node"]}, include: ["input/**/*"]}, files: {"dist/stale.d.ts": stale, "src/consumer.mts": bad}},
    {name: "implicit-declarationDir-stale", config: {compilerOptions: {types: ["node"], declaration: true, declarationDir: "input/declarations"}, include: ["input/**/*"]}, files: {"declarations/stale.d.ts": stale, "src/consumer.mts": bad}},
    {name: "default-include-outDir", config: {compilerOptions: {outDir: "input/dist", types: ["node"]}}, files: {"dist/stale.d.ts": stale, "src/consumer.mts": bad}},
    {name: "rootDir", config: {compilerOptions: {rootDir: "input/src"}, include: ["input/src/**/*"]}},
    {name: "rootDir-error", config: {compilerOptions: {rootDir: "input/other"}, files: ["input/src/consumer.mts"]}},
    {name: "deep-rootDir-error-declarations", config: {compilerOptions: {rootDir: "input/a/b/c/d/e", declaration: true, declarationMap: true}, files: ["input/src/consumer.mts"]}},
    {name: "paths", config: {compilerOptions: {paths: {"local-contract": ["./input/contract.d.mts"]}}, files: ["input/src/consumer.mts"]}, files: {"src/consumer.mts": 'import {value} from "local-contract"; export const use = value;', "contract.d.mts": "export declare const value: number;"}},
    {name: "typeRoots-types", config: {compilerOptions: {typeRoots: ["input/typings", "node_modules/@types"], types: ["local", "node"]}, files: ["input/src/consumer.mts"]}, files: {"typings/local/index.d.ts": "declare const localValue: number;", "src/consumer.mts": "export const use = localValue;"}},
    {name: "allowJs-output-collision", config: {compilerOptions: {allowJs: true}, files: ["input/src/consumer.js"]}, files: {"src/consumer.js": "export const value = 1;"}},
    {name: "allowJs-output-directory", config: {compilerOptions: {allowJs: true, outDir: "input/dist"}, files: ["input/src/consumer.js"]}, files: {"src/consumer.js": "export const value = 1;"}},
    {name: "quoted-path-literals", config: {files: ["input/src/consumer.mts"]}, files: {"src/consumer.mts": 'export const data = {"path":"../external-data.json", "extends":"../../data.json"}; export const text = "from relative/path";'}},
    {name: "json-import", config: {compilerOptions: {resolveJsonModule: true}, files: ["input/src/consumer.mts"]}, files: {"src/consumer.mts": 'import data from "./data.json" with {type: "json"}; export const use = data.path;', "src/data.json": '{"path":"../external-data.json"}'}},
    {name: "types-empty", config: {compilerOptions: {types: []}, files: ["input/src/consumer.mts"]}, files: {"src/consumer.mts": "export const use = 1;"}},
    {name: "extends-chain-outDir", config: {extends: "./input/config/child.json", compilerOptions: {types: ["node"]}}, files: {"config/base.json": JSON.stringify({compilerOptions: {...options, outDir: "../dist"}, include: ["../src/**/*", "../dist/**/*"]}), "config/child.json": JSON.stringify({extends: "./base.json"}), "dist/stale.d.ts": stale, "src/consumer.mts": bad}},
    {name: "extends-include-exclude", config: {extends: "./input/config/base.json"}, files: {"config/base.json": JSON.stringify({include: ["../**/*"], exclude: ["../excluded"]}), "excluded/stale.d.ts": stale}},
    {name: "reference-solution", config: {files: [], references: [{path: "input/reference"}]}, files: {"reference/tsconfig.json": JSON.stringify({compilerOptions: {composite: true, types: []}, files: ["index.ts"]}), "reference/index.ts": "export const value = 1;"}},
    {name: "reference-built", config: {files: ["input/src/consumer.mts"], references: [{path: "input/reference"}]}, files: {"reference/tsconfig.json": JSON.stringify({compilerOptions: {composite: true, module: "NodeNext", target: "ES2022", types: [], outDir: "dist"}, files: ["index.ts"]}), "reference/index.ts": "export const value = 1;", "src/consumer.mts": 'import {value} from "../reference/index.js"; export const use = value;'}, build: true},
    {name: "reference-missing-build", config: {files: ["input/src/consumer.mts"], references: [{path: "input/reference"}]}, files: {"reference/tsconfig.json": JSON.stringify({compilerOptions: {composite: true, module: "NodeNext", target: "ES2022", types: [], outDir: "dist"}, files: ["index.ts"]}), "reference/index.ts": "export const value = 1;", "src/consumer.mts": 'import {value} from "../reference/index.js"; export const use = value;'}},
    {name: "composite-unlisted-import", config: {compilerOptions: {composite: true}, files: ["input/src/consumer.mts"]}, files: {"src/consumer.mts": 'import {value} from "./helper.mjs"; export const use = value;', "src/helper.mts": "export const value = 1;"}},
    {name: "composite-listed-import", config: {compilerOptions: {composite: true}, files: ["input/src/consumer.mts", "input/src/helper.mts"]}, files: {"src/consumer.mts": 'import {value} from "./helper.mjs"; export const use = value;', "src/helper.mts": "export const value = 1;"}},
    {name: "incremental-outFile-cache", config: {compilerOptions: {incremental: true, module: "System", outFile: "input/dist/bundle.js", outDir: "input/dist", rootDir: "input/src"}, files: ["input/src/consumer.ts"]}, files: {"src/consumer.ts": "export const use = 1;"}},
    {name: "incremental-default-cache", config: {compilerOptions: {incremental: true}, files: ["input/src/consumer.mts"]}},
    {name: "incremental-explicit-cache", config: {compilerOptions: {incremental: true, tsBuildInfoFile: "input/cache/state.tsbuildinfo"}, files: ["input/src/consumer.mts"]}},
    {name: "composite-cache-declarations", config: {compilerOptions: {composite: true, tsBuildInfoFile: "input/cache/composite.tsbuildinfo", declaration: true, declarationMap: true}, files: ["input/src/consumer.mts"]}},
    {name: "source-map-metadata", config: {compilerOptions: {sourceMap: true, mapRoot: "/public/maps", sourceRoot: "/public/source"}, files: ["input/src/consumer.mts"]}},
    {name: "declaration-map", config: {compilerOptions: {declaration: true, declarationMap: true}, files: ["input/src/consumer.mts"]}},
    {name: "declaration-only", config: {compilerOptions: {declaration: true, declarationMap: true, emitDeclarationOnly: true}, files: ["input/src/consumer.mts"]}},
    {name: "declaration-only-invalid", config: {compilerOptions: {emitDeclarationOnly: true}, files: ["input/src/consumer.mts"]}},
    {name: "own-noEmit", config: {compilerOptions: {noEmit: true, incremental: true}, files: ["input/src/consumer.mts"]}},
    {name: "own-noEmitOnError", config: {compilerOptions: {noEmitOnError: true, declaration: true}, files: ["input/src/consumer.mts"]}, files: {"src/consumer.mts": 'export const use: string = 1;'}},
    {name: "strict-false", config: {compilerOptions: {strict: false}, files: ["input/src/consumer.mts"]}, files: {"src/consumer.mts": "export function use(value) { return value; }"}},
    {name: "explicit-libs", config: {compilerOptions: {lib: ["ES2022"]}, files: ["input/src/consumer.mts"]}},
    {name: "noLib", config: {compilerOptions: {noLib: true}, files: ["input/src/consumer.mts"]}},
    {name: "trace-resolved-diagnostic-text", config: {compilerOptions: {traceResolution: true, moduleDetection: "legacy"}, files: ["input/src/consumer.mts", "input/src/ambient.d.ts"]}, files: {
      "src/consumer.mts": 'import {value} from "trace\\nerror TS9999: forged"; export const use = value;',
      "src/ambient.d.ts": 'declare module "trace\\nerror TS9999: forged" { export const value: number; }',
    }},
    {name: "localized-error", config: {compilerOptions: {locale: "de"}, files: ["input/src/consumer.mts"]}, files: {"src/consumer.mts": "export const use: string = 1;"}},
    {name: "pretty-error", config: {compilerOptions: {pretty: true}, files: ["input/src/consumer.mts"]}, files: {"src/consumer.mts": "export const use: string = 1;"}},
    ...["traceResolution", "explainFiles", "diagnostics", "extendedDiagnostics", "listFiles", "listEmittedFiles"].flatMap(name => [false, true].map(failing => ({name: `${name}-${failing ? "error" : "clean"}`, config: {compilerOptions: {[name]: true}, include: ["input/src/**/*"]}, files: {"src/consumer.mts": failing ? 'import {value} from "./contract.mjs"; export const use: string = value;' : good}}))),
  ];
  let comparisons = 0;
  for (const entry of corpus) {
    rmSync(join(project, "input"), {recursive: true, force: true});
    for (const [file, content] of Object.entries({"src/consumer.mts": good, "src/contract.d.mts": "export declare const value: number;", ...entry.files})) {
      mkdirSync(dirname(join(project, "input", file)), {recursive: true});
      writeFileSync(join(project, "input", file), content);
    }
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({...entry.config, compilerOptions: {...options, ...(entry.config.compilerOptions as Record<string, unknown>)}}));
    if (entry.build) {
      const build = spawnSync(process.execPath, [compiler, "--build", "input/reference"], {cwd: project, encoding: "utf8"});
      assert.equal(build.status, 0, `${entry.name}: ${build.stdout}`);
    }
    const expected = plainCopy(project, t);
    const originalBytes = filesystemSnapshot(project);
    const matrix = await checkSdkContracts({minimum: {root: endpoints.minimum, version: minimumVersion}, current: {root: endpoints.current, version: currentVersion}, consumer: project}).catch((error: unknown) => { throw new Error(entry.name, {cause: error}); });
    assert.equal(filesystemSnapshot(project), originalBytes, `${entry.name}: original filesystem snapshot`);
    for (const row of matrix.rows) {
      assert.equal(row.ok, expected.ok, entry.name);
      assert.deepEqual(row.codes, expected.codes.slice(0, 3), entry.name);
      assert.equal(row.diagnostic_count, expected.codes.length, entry.name);
      comparisons++;
    }

  }
  t.diagnostic(`Discovery differential: ${corpus.length} configs, ${comparisons} verdict/error-code comparisons; all filesystem snapshots unchanged outside the copied bound sandbox.`);
});


test("composite membership comparisons match plain noEmit tsc and never escape the copy", async t => {
  const project = scratch(t);
  mkdirSync(join(project, "node_modules"));
  symlinkSync(join(repo, "node_modules/typescript"), join(project, "node_modules/typescript"), "junction");
  writeFileSync(join(project, "package.json"), JSON.stringify({type: "module"}));
  writeFileSync(join(project, "consumer.mts"), 'import {value} from "./helper.mjs"; export const use = value;');
  writeFileSync(join(project, "helper.mts"), "export const value = 1;");
  for (const noEmit of [false, true]) {
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {composite: true, incremental: true, declaration: true,
      declarationMap: true, noEmit, module: "NodeNext", target: "ES2022", types: [], outDir: "dist", tsBuildInfoFile: "cache/build.tsbuildinfo"}, files: ["consumer.mts"]}));
    const plain = plainCopy(project, t);
    const before = filesystemSnapshot(project);
    const matrix = await checkSdkContracts({minimum: target, current: target, consumer: project});
    assertPlainRows(matrix, plain);
    assert.equal(filesystemSnapshot(project), before, "no source, existing output or cache byte outside the sandbox changes");
  }
  t.diagnostic("Composite project differential: 2 unchanged configurations and 4 bound comparisons with emission enabled and disabled.");
});

/** Run an independent real typecheck executable on a byte-identical project copy. */
function plainCopy(project: string, t: TestContext): {ok: boolean; codes: string[]} {
  const baseline = join(scratch(t), "baseline");
  cpSync(project, baseline, {recursive: true});
  const config = JSON.parse(readFileSync(join(baseline, "tsconfig.json"), "utf8")) as {files?: string[]; references?: unknown[]};
  const result = config.files?.length === 0 && config.references?.length ? spawnSync(process.execPath, [compiler, "--build", "tsconfig.json", "--noEmit", "--pretty", "false"], {cwd: baseline, encoding: "utf8"}) : plainProject(baseline);
  assert.equal(result.error, undefined);
  return {ok: result.status === 0, codes: [...result.stdout.matchAll(/error (TS\d+):/g)].map(match => match[1]!)};
}

/** Compare both selected bounds with the independent native verdict and diagnostic codes. */
function assertPlainRows(matrix: SdkContractMatrix, expected: {ok: boolean; codes: string[]}): void {
  assert.deepEqual(matrix.rows.map(row => ({ok: row.ok, codes: row.codes})), [expected, expected]);
}

test("real noEmit delegation prevents allowJs output collisions while preserving config bytes", async t => {
  const project = linkedCompilerConsumer(t);
  writeFileSync(join(project, "consumer.js"), "export const value = 1;");
  for (const outDir of [undefined, "dist"]) {
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {allowJs: true, types: [], module: "NodeNext", outDir}, files: ["consumer.js"]}));
    const expected = plainCopy(project, t), before = filesystemSnapshot(project);
    assert.equal(expected.ok, true);
    assert.deepEqual(expected.codes, []);
    const matrix = await checkSdkContracts({minimum: target, current: target, consumer: project});
    assertPlainRows(matrix, expected);
    assert.equal(filesystemSnapshot(project), before);
  }
});

test("unmodified copy accepts JSON imports and ordinary quoted path literals", async t => {
  const project = linkedCompilerConsumer(t);
  writeFileSync(join(project, "consumer.mts"), 'import data from "./data.json" with {type: "json"}; export const use = {"path":"../external-data.json", "extends":"../../ordinary-data.json", value: data.path};');
  writeFileSync(join(project, "data.json"), '{"path":"../external-data.json"}');
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {resolveJsonModule: true, noEmit: true, types: [], module: "NodeNext"}, files: ["consumer.mts"]}));
  const expected = plainCopy(project, t), before = filesystemSnapshot(project);
  assert.equal(expected.ok, true);
  const matrix = await checkSdkContracts({minimum: target, current: target, consumer: project});
  assertPlainRows(matrix, expected);
  assert.equal(filesystemSnapshot(project), before);
});

test("missing compilers refuse but dependency copies never invoke broken npm installers", async t => {
  const project = join(scratch(t), "consumer");
  mkdirSync(join(project, "node_modules/empty-scope"), {recursive: true});
  writeFileSync(join(project, "tsconfig.json"), '{"files":["consumer.ts"]}');
  writeFileSync(join(project, "consumer.ts"), 'export const value = 1;');
  const original = filesystemSnapshot(project);
  await assert.rejects(checkSdkContracts({minimum: target, current: target, consumer: project}), refuses("compiler_unavailable"));
  assert.equal(filesystemSnapshot(project), original);

  const bin = scratch(t), previousPath = process.env.PATH, previousPlatform = process.platform, previousNode = process.env.npm_node_execpath, previousNpm = process.env.npm_execpath;
  for (const executable of ["npm", "npm.cmd"]) { writeFileSync(join(bin, executable), '#!/bin/sh\nexit 42\n'); chmodSync(join(bin, executable), 0o755); }
  try {
    process.env.PATH = bin;
    const fakeNode = join(bin, "node"), fakeNpm = join(bin, "npm-cli.js");
    writeFileSync(fakeNode, "unavailable runtime"); writeFileSync(fakeNpm, "process.exit(42);");
    process.env.npm_node_execpath = process.execPath; process.env.npm_execpath = fakeNpm;
    assert.equal((await checkSdkContracts({minimum: target, current: target})).ok, true);
    process.env.npm_node_execpath = fakeNode; delete process.env.npm_execpath;
    for (const platform of ["linux", "win32"]) {
      Object.defineProperty(process, "platform", {value: platform});
      assert.equal((await checkSdkContracts({minimum: target, current: target})).ok, true);
    }
  } finally {
    Object.defineProperty(process, "platform", {value: previousPlatform});
    process.env.PATH = previousPath;
    if (previousNode === undefined) delete process.env.npm_node_execpath; else process.env.npm_node_execpath = previousNode;
    if (previousNpm === undefined) delete process.env.npm_execpath; else process.env.npm_execpath = previousNpm;
  }
});

test("sandbox dependency artifacts copy original metadata without executing prepare or postinstall", async t => {
  const project = noEmitConsumer(t), dependency = join(project, "node_modules/artifact-fixture");
  mkdirSync(dependency);
  const metadata = join(dependency, "package.json");
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {noEmit: true, types: [], module: "NodeNext", resolveJsonModule: true}, files: ["consumer.mts"]}));
  for (const script of ["prepare", "postinstall"]) {
    writeFileSync(metadata, JSON.stringify({name: "artifact-fixture", version: "1.0.0", scripts: {
      [script]: 'node -e "require(\'node:fs\').writeFileSync(\'executed\',\'forbidden\');process.exit(42)"',
    }}));
    writeFileSync(join(project, "consumer.mts"), `import metadata from "artifact-fixture/package.json" with {type: "json"}; export const script: string = metadata.scripts.${script};`);
    const expected = plainCopy(project, t), original = filesystemSnapshot(project);
    assert.equal(expected.ok, true);
    assertPlainRows(await checkSdkContracts({minimum: target, current: target, consumer: project}), expected);
    assert.equal(filesystemSnapshot(project), original);
  }
  for (const malformed of ["{", "null", "[]", "42"]) {
    writeFileSync(metadata, malformed);
    await assert.rejects(checkSdkContracts({minimum: target, current: target, consumer: project}), refuses("sdk_unavailable"));
  }
});

test("sandbox compiler artifacts retain all native binary and library bytes regardless of npmignore", async t => {
  const project = join(scratch(t), "consumer"), nativeName = "@typescript/" + readdirSync(join(repo, "node_modules/@typescript"))[0]!;
  mkdirSync(join(project, "node_modules/@typescript"), {recursive: true});
  cpSync(join(repo, "node_modules/typescript"), join(project, "node_modules/typescript"), {recursive: true});
  const native = join(project, "node_modules", nativeName);
  cpSync(join(repo, "node_modules", nativeName), native, {recursive: true});
  writeFileSync(join(project, "consumer.ts"), 'export const value = 1;');
  writeFileSync(join(project, "tsconfig.json"), '{"compilerOptions":{"types":[]},"files":["consumer.ts"]}');
  const library = join(native, "lib/lib.es5.d.ts"), original = readFileSync(library);
  for (const missing of [false, true]) {
    const changed = missing ? join(native, "lib/extra-library.d.ts") : library;
    writeFileSync(changed, missing ? 'declare const fixture: number;' : Buffer.concat([original, Buffer.from('\n// fixture compiler patch\n')]));
    writeFileSync(join(native, 'lib/.npmignore'), missing ? 'extra-library.d.ts\n' : 'lib.es5.d.ts\n');
    const before = filesystemSnapshot(project);
    assertPlainRows(await checkSdkContracts({minimum: target, current: target, consumer: project}), plainCopy(project, t));
    assert.equal(filesystemSnapshot(project), before);
    unlinkSync(join(native, "lib/.npmignore"));
    if (missing) unlinkSync(changed); else writeFileSync(library, original);
  }
});

test("implicit external emits are refused before any compiler write outside the copy", async t => {
  const project = linkedCompilerConsumer(t), outside = scratch(t);
  const source = join(outside, "external.ts"), emitted = join(outside, "external.js");
  writeFileSync(source, 'export const value = 1;'); writeFileSync(emitted, 'preserve existing external bytes');
  writeFileSync(join(project, "consumer.mts"), `import {value} from ${JSON.stringify(emitted)}; export const use = value;`);
  const original = filesystemSnapshot(outside);
  for (const output of [{}, {outDir: "dist", rootDir: "."}, {outDir: "dist", composite: true}]) {
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], module: "NodeNext", ...output}, files: ["consumer.mts"]}));
    await assert.rejects(checkSdkContracts({minimum: target, current: target, consumer: project}), error => {
      assert.ok(error instanceof SdkContractRefusal);
      assert.match(error.remedy, /external\.ts.*outside/);
      return error.code === "isolation_refused";
    });
    assert.equal(filesystemSnapshot(outside), original, "native fallback emits must not touch external files");
  }
});

test("canonical sandbox roots accept compiler file lists through a symlinked temporary directory", async t => {
  const project = noEmitConsumer(t), root = scratch(t), physical = join(root, "physical"), logical = join(root, "logical");
  mkdirSync(physical); symlinkSync(physical, logical, "junction");
  const keys = ["TMPDIR", "TMP", "TEMP"], previous = keys.map(key => process.env[key]);
  try {
    for (const key of keys) process.env[key] = logical;
    const matrix = await checkSdkContracts({minimum: target, current: target, consumer: project});
    assert.equal(matrix.checks, 2); assertPlainRows(matrix, {ok: true, codes: []});
  } finally {
    restoreEnvironment(keys, previous);
  }
});

test("working CommonJS compiler wrappers ignore irrelevant malformed package metadata", async t => {
  const root = scratch(t), entry = join(root, "compiler.cjs");
  writeFileSync(join(root, "package.json"), "{");
  writeFileSync(entry, `const cp=require('node:child_process'),path=require('node:path');
const result=cp.spawnSync(process.execPath,[path.join(process.cwd(),'node_modules/typescript/bin/tsc'),...process.argv.slice(2)],{stdio:'inherit'}); process.exit(result.status??1);`);
  const plain = spawnSync(process.execPath, [entry, "--help", "--all", "--locale", "en"], {cwd: repo, encoding: "utf8"});
  assert.equal(plain.status, 0, plain.stderr); assert.match(plain.stdout, /ALL COMPILER OPTIONS/);
  const matrix = await checkSdkContracts({minimum: target, current: target, compiler: entry, examples: [{id: "metadata", source: "export const value = 1;"}]});
  assertPlainRows(matrix, {ok: true, codes: []});
});

test("direct SDK callers need no npm script environment or executable search paths", async t => {
  const project = noEmitConsumer(t);
  const keys = ["PATH", "npm_execpath", "npm_node_execpath"], previous = keys.map(key => process.env[key]);
  try {
    process.env.PATH = ""; delete process.env.npm_execpath;
    for (const runtime of [undefined, join(project, "missing-runtime")]) {
      if (runtime === undefined) delete process.env.npm_node_execpath; else process.env.npm_node_execpath = runtime;
      const matrix = await checkSdkContracts({minimum: target, current: target, consumer: project});
      assertPlainRows(matrix, {ok: true, codes: []});
    }
  } finally {
    restoreEnvironment(keys, previous);
  }
});

test("solution references preserve a valid empty compiler source-file list", async t => {
  const project = linkedCompilerConsumer(t), reference = join(project, "reference");
  mkdirSync(reference);
  writeFileSync(join(reference, "index.ts"), 'export const value = 1;');
  writeFileSync(join(reference, "tsconfig.json"), JSON.stringify({compilerOptions: {composite: true, types: []}, files: ["index.ts"]}));
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: []}, files: [], references: [{path: "./reference"}]}));
  const expected = plainCopy(project, t);
  assert.equal(expected.ok, true);
  const matrix = await checkSdkContracts({minimum: target, current: target, consumer: project});
  assertPlainRows(matrix, expected);
});

test("round 9 npm location tripwires survive the fixed global-prefix case and generated configurations", async t => {
  const project = noEmitConsumer(t), outside = scratch(t), home = join(outside, "home"), prefix = join(outside, "prefix");
  mkdirSync(home); mkdirSync(prefix);
  writeFileSync(join(prefix, "existing-installation"), "preserve");
  writeFileSync(join(home, ".npmrc"), `global=true\nprefix=${prefix}\ncache=${prefix}\n`);
  const keys = ["prefix", "global", "location", "cache", "userconfig", "globalconfig", "workspace", "workspaces", "install-strategy", "global-style",
    "bin-links", "script-shell", "node-options", "ignore-scripts", "foreground-scripts", "tmp", "tmpdir", "link", "install-links"];
  const envKeys = ["HOME", ...keys.flatMap(key => ["npm_config_" + key.replaceAll("-", "_"), "NPM_CONFIG_" + key.toUpperCase().replaceAll("-", "_")])];
  const previous = envKeys.map(key => process.env[key]), random = boundaryRandom(15409);
  const empty = await checkSdkContracts({minimum: target, current: target, consumer: project});
  const cases = [`global=true\nprefix=${prefix}\n`, ...Array.from({length: 12}, (_, index) => keys.map(key => {
    const values = [prefix, "../../" + prefix.slice(1), "true", "false", "global", "nested", "--require=" + join(prefix, "inject.cjs")];
    return `${key}=${values[(random() + index) % values.length]}`;
  }).join("\n"))];
  try {
    process.env.HOME = home;
    for (const [index, config] of cases.entries()) {
      writeFileSync(join(project, ".npmrc"), config);
      if (index > 0) for (const key of envKeys.slice(1)) process.env[key] = [prefix, "../" + prefix.slice(1), "true", "false"][random() % 4]!;
      const original = filesystemSnapshot(project), tripwire = filesystemSnapshot(outside);
      const checked = await checkSdkContracts({minimum: target, current: target, consumer: project});
      assert.deepEqual(checked, empty, `generated configuration ${index}: verdict equals empty npmrc`);
      assert.equal(filesystemSnapshot(project), original, `generated configuration ${index}: consumer untouched`);
      assert.equal(filesystemSnapshot(outside), tripwire, `generated configuration ${index}: HOME and prefix tripwires untouched`);
    }
  } finally { restoreEnvironment(envKeys, previous); }
  t.diagnostic(`npm property: ${cases.length} configurations, 19 keys, both environment casings, absolute and parent-relative values; all consumer/HOME/prefix tree hashes unchanged.`);
});

test("round 9 registry allowlist preserves scoped private registry credentials and CA settings", async t => {
  const project = noEmitConsumer(t), receipt = join(scratch(t), "registry.json"), bin = join(project, "node_modules/typescript/bin");
  // Detach the toolchain before instrumenting a test-owned entry.
  unlinkSync(join(project, "node_modules/typescript"));
  cpSync(dirname(dirname(compiler)), join(project, "node_modules/typescript"), {recursive: true});
  cpSync(join(repo, "node_modules/@typescript"), join(project, "node_modules/@typescript"), {recursive: true});
  writeFileSync(join(bin, "plain-tsc"), readFileSync(join(bin, "tsc")));
  writeFileSync(join(bin, "tsc"), `import {readFileSync,writeFileSync} from 'node:fs'; import {spawnSync} from 'node:child_process';
writeFileSync(${JSON.stringify(receipt)},JSON.stringify({config:readFileSync('.npmrc','utf8'),home:process.env.HOME,cache:process.env.XDG_CACHE_HOME,keys:Object.keys(process.env).filter(key=>/^npm_config_/i.test(key))}));
const result=spawnSync(process.execPath,[new URL('./plain-tsc',import.meta.url).pathname,...process.argv.slice(2)],{stdio:'inherit'});process.exit(result.status??1);`);
  const allowed = ["registry=https://registry.npmjs.org/", "@fixture:registry=https://registry.example.invalid/", "//registry.example.invalid/:_authToken=synthetic-fixture-token", "strict-ssl=false", "ca[]=synthetic-ca", "cafile=fixture-ca.pem"];
  // A CA file is meaningful only for TLS connections; these local artifact installs use the normal registry.
  writeFileSync(join(project, "fixture-ca.pem"), "synthetic-ca");
  writeFileSync(join(project, ".npmrc"), allowed.join("\n") + "\nprefix=../../escape\nignore-scripts=false\nnode-options=--require=forbidden\n");
  const original = filesystemSnapshot(project);
  assert.equal((await checkSdkContracts({minimum: target, current: target, consumer: project})).ok, true);
  const observed = JSON.parse(readFileSync(receipt, "utf8")) as {config: string; home: string; cache: string; keys: string[]};
  assert.deepEqual(observed.config.trim().split("\n"), allowed);
  assert.deepEqual(observed.keys, []);
  assert.ok(observed.cache.startsWith(observed.home + "/"));
  assert.equal(filesystemSnapshot(project), original);
});

test("round 9 scoped registry must-allow preserves a real authenticated private dependency without network", async t => {
  const project = noEmitConsumer(t), root = scratch(t), artifact = join(root, "artifact"), receipt = join(root, "requests.jsonl");
  mkdirSync(artifact);
  writeFileSync(join(artifact, "package.json"), JSON.stringify({name: "@fixture/private", version: "1.0.0", types: "index.d.ts"}));
  writeFileSync(join(artifact, "index.d.ts"), "export declare const value: number;");
  const pack = spawnSync("npm", ["pack", artifact, "--ignore-scripts", "--pack-destination", root], {encoding: "utf8", env: installationEnv()});
  assert.equal(pack.status, 0, pack.stderr);
  const tarball = join(root, pack.stdout.trim().split("\n").at(-1)!);
  const server = spawn(process.execPath, ["--input-type=module", "-e", `import {createServer} from 'node:http'; import {readFileSync,appendFileSync} from 'node:fs';
const tarball=readFileSync(${JSON.stringify(tarball)});
const server=createServer((req,res)=>{
  const authenticated=req.headers.authorization==='Bearer synthetic-fixture-token';
  appendFileSync(${JSON.stringify(receipt)},JSON.stringify({authenticated})+'\\n');
  if(!authenticated){res.writeHead(401);res.end();return;}
  if(req.url.endsWith('.tgz')){res.end(tarball);return;}
  res.setHeader('content-type','application/json');
  res.end(JSON.stringify({name:'@fixture/private','dist-tags':{latest:'1.0.0'},versions:{'1.0.0':{name:'@fixture/private',version:'1.0.0',dist:{tarball:'http://127.0.0.1:'+server.address().port+'/private.tgz'}}}}));
});server.listen(0,'127.0.0.1',()=>console.log(server.address().port));`], {stdio: ["ignore", "pipe", "pipe"]});
  t.after(() => server.kill());
  const port = await new Promise<string>((resolvePort, reject) => {
    server.stdout.once("data", chunk => resolvePort(String(chunk).trim()));
    server.once("error", reject); server.once("exit", () => reject(new Error("registry exited before readiness")));
  });
  const provision = join(root, "provision"); mkdirSync(provision);
  const npmrc = `@fixture:registry=http://127.0.0.1:${port}/\n//127.0.0.1:${port}/:_authToken=synthetic-fixture-token\n`;
  writeFileSync(join(provision, ".npmrc"), npmrc);
  const install = spawnSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "@fixture/private@1.0.0"], {cwd: provision, encoding: "utf8", timeout: 30000, env: installationEnv()});
  assert.equal(install.status, 0, install.stderr);
  cpSync(join(provision, "node_modules/@fixture"), join(project, "node_modules/@fixture"), {recursive: true});
  writeFileSync(join(project, ".npmrc"), npmrc + "global=true\nprefix=../../tripwire\n");
  const requestBytes = readFileSync(receipt, "utf8");
  writeFileSync(join(project, "consumer.mts"), 'import {value} from "@fixture/private"; export const use: number = value;');
  const before = filesystemSnapshot(project);
  assert.equal((await checkSdkContracts({minimum: target, current: target, consumer: project})).ok, true);
  assert.equal(readFileSync(receipt, "utf8"), requestBytes, "checker never contacts the registry");
  const requests = requestBytes.trim().split("\n").map(line => JSON.parse(line) as {authenticated: boolean});
  assert.ok(requests.length >= 2); assert.ok(requests.every(request => request.authenticated));
  assert.equal(filesystemSnapshot(project), before);
});


/** Compare the current checker bound to an untouched independent copy, including failing controls. */
async function dependencyOracle(project: string, bound: SdkContractOptions["current"], t: TestContext): Promise<{ok: boolean; codes: string[]}> {
  const expected = plainCopy(project, t), original = filesystemSnapshot(project);
  const matrix = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
  assert.equal(matrix.rows[1]!.ok, expected.ok);
  assert.equal(matrix.rows[1]!.diagnostic_count, expected.codes.length);
  assert.deepEqual([...matrix.rows[1]!.codes].sort(), [...expected.codes].sort());
  assertPlainRows(matrix, expected);
  assert.equal(filesystemSnapshot(project), original, "consumer dependency files, links, metadata and timestamps remain untouched");
  return expected;
}

test("round 10 dependency-shape differential preserves aliases file link workspaces peers bundled and installed names", async t => {
  const cases = ["review-npm-alias", "scoped-alias", "file-copy", "file-link", "link", "workspace", "peer", "bundled", "metadata-mismatch", "nested-alias", "hidden-store"];
  let comparisons = 0;
  for (const shape of cases) {
    const project = noEmitConsumer(t), bound = dependencyBound(project);
    const installed = shape === "scoped-alias" ? "@scope/alias-fixture" : "alias-fixture";
    const dependencies: Record<string, string> = {[installed]: shape === "scoped-alias" ? "npm:@actual/fixture@1" : "npm:actual-fixture@1"};
    let workspace: string[] | undefined;
    if (["file-link", "link", "workspace", "hidden-store"].includes(shape)) {
      const location = shape === "hidden-store" ? "node_modules/.store/actual-fixture" : "packages/actual-fixture";
      dependencyEntry(project, location, "actual-fixture");
      symlinkSync(join(project, location), join(project, "node_modules", installed), "junction");
      dependencies[installed] = shape === "workspace" ? "workspace:*" : (shape === "link" ? "link:" : "file:") + "./packages/actual-fixture";
      if (shape === "workspace") {
        workspace = ["packages/*"];
        dependencyEntry(project, "packages/sibling", "sibling");
        writeFileSync(join(project, location, "index.d.ts"), 'export {value} from "../sibling/index.js";');
      }
    } else {
      dependencyEntry(join(project, "node_modules"), installed, shape === "scoped-alias" ? "@actual/fixture" : "actual-fixture");
      if (shape === "file-copy") {
        dependencyEntry(project, "packages/actual-fixture", "actual-fixture");
        dependencies[installed] = "file:./packages/actual-fixture";
      }
    }
    if (["peer", "bundled", "nested-alias"].includes(shape)) {
      const owner = join(project, "node_modules", installed), leaf = shape === "peer" ? "peer-fixture" : "child-alias";
      dependencyEntry(join(project, "node_modules"), leaf, "actual-child", 'export declare const value: "wrong-hoist";');
      const nested = shape === "peer" ? join(project, "node_modules") : join(owner, "node_modules");
      dependencyEntry(nested, leaf, "actual-child");
      writeFileSync(join(owner, "index.d.ts"), `export {value} from ${JSON.stringify(leaf)};`);
      const metadata = JSON.parse(readFileSync(join(owner, "package.json"), "utf8")) as Record<string, unknown>;
      metadata[shape === "peer" ? "peerDependencies" : "dependencies"] = {[leaf]: shape === "nested-alias" ? "npm:actual-child@1" : "1.0.0"};
      if (shape === "bundled") metadata.bundledDependencies = [leaf];
      writeFileSync(join(owner, "package.json"), JSON.stringify(metadata));
    }
    writeFileSync(join(project, "package.json"), JSON.stringify({private: true, type: "module", dependencies, workspaces: workspace}));
    // A stale lock must not cause re-resolution of the actual installed tree.
    writeFileSync(join(project, "package-lock.json"), JSON.stringify({name: "fixture", lockfileVersion: 3, packages: {}}));
    for (const valid of [true, false]) {
      writeFileSync(join(project, "consumer.mts"), `import {value} from ${JSON.stringify(installed)}; import {sdk} from "@unbrained/pm-cli"; export const use: ${valid ? '"selected"' : '"wrong"'} = value; export {sdk};`);
      const expected = await dependencyOracle(project, bound, t);
      assert.equal(expected.ok, valid, shape);
      if (!valid) assert.deepEqual(expected.codes, ["TS2322"], shape);
      comparisons += 2;
    }
  }
  t.diagnostic(`Dependency corpus: ${cases.length} installed shapes, 22 untouched plain-tsc oracles, ${comparisons} bound comparisons; matching verdicts and error codes, including the alias-fixture/actual-fixture review case.`);
});

test("round 10 property preserves 200 random alias scoped file dependency graphs by installed import name", async t => {
  const results: {graphs: number; edges: number}[] = [];
  // Keep every deterministic graph while limiting active compiler workers to two.
  for (const shards of [[0, 1], [2, 3]]) results.push(...await Promise.all(shards.map(shard => new Promise<{graphs: number; edges: number}>((resolveWorker, reject) => {
    const worker = new Worker(new URL("./dependency-property-worker.ts", import.meta.url), {workerData: {shard, compiler}});
    let result: {graphs: number; edges: number} | undefined;
    t.after(() => worker.terminate());
    worker.once("message", message => { result = message; });
    worker.once("error", reject);
    worker.once("exit", code => {
      if (code === 0 && result) resolveWorker(result);
      else reject(new Error(`dependency property worker exited ${code} without a completed result`));
    });
  }))));
  assert.equal(results.reduce((sum, row) => sum + row.graphs, 0), 200);
  t.diagnostic(`Dependency property: 4 deterministic shards, at most 2 active workers, 200 independent random graphs, ${results.reduce((sum, row) => sum + row.edges, 0)} edges, alias/scoped/file shapes and nested aliases; 200 passing plain-tsc oracles, 400 checker rows without drift; all original tree snapshots unchanged.`);
});


test("round 10 review alias-fixture resolves by installed name rather than actual-fixture metadata", async t => {
  const project = noEmitConsumer(t), bound = dependencyBound(project);
  dependencyEntry(join(project, "node_modules"), "alias-fixture", "actual-fixture");
  writeFileSync(join(project, "node_modules/alias-fixture/package.json"), JSON.stringify({name:"actual-fixture",version:"1.0.0",types:"index.d.ts"}));
  writeFileSync(join(project, "package.json"), JSON.stringify({type: "module", dependencies: {"alias-fixture": "npm:actual-fixture@1"}}));
  writeFileSync(join(project, "consumer.mts"), 'import {value} from "alias-fixture"; export const use: "selected" = value;');
  const expected = plainCopy(project, t);
  assert.deepEqual(expected, {ok: true, codes: []});
  const matrix = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
  assertPlainRows(matrix, expected);
});


test("round 10 internal module and SDK scope links retain canonical selected SDK identity", async t => {
  for (const shape of ["module-root", "sdk-scope", "workspace-self"]) {
    const project = noEmitConsumer(t);
    if (shape === "module-root") {
      renameSync(join(project, "node_modules"), join(project, "installed-modules"));
      symlinkSync(join(project, "installed-modules"), join(project, "node_modules"), "junction");
    } else if (shape === "sdk-scope") {
      const scope = join(project, "packages/sdk-scope");
      mkdirSync(scope, {recursive:true});
      symlinkSync(scope, join(project, "node_modules/@unbrained"), "junction");
    } else symlinkSync(project, join(project, "node_modules/workspace-self"), "junction");
    const bound = dependencyBound(project);
    dependencyEntry(join(project, "node_modules"), "alias-fixture", "actual-fixture");
    writeFileSync(join(project, "consumer.mts"), 'import {value} from "alias-fixture"; import {sdk} from "@unbrained/pm-cli"; export const use: "selected" = value; export {sdk};');
    assert.equal((await dependencyOracle(project, bound, t)).ok, true, shape);
    if (shape === "workspace-self") {
      const outside = join(scratch(t), "sentinel"); writeFileSync(outside, "retain external bytes");
      symlinkSync(outside, join(project, "trace.json"));
      await assert.rejects(checkSdkContracts({consumer: project, minimum: bound, current: bound}), refuses("isolation_refused"));
      assert.equal(readFileSync(outside, "utf8"), "retain external bytes", "a self workspace does not exempt consumer output links");
    }
  }
});
