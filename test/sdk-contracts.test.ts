/** Real compiler, isolated tracker and emitted-package compatibility contracts. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, lstatSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import test, { after, type TestContext } from "node:test";
import { PmClient } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import extension from "../index.ts";
import { classifiedCompilerOptions } from "../sdk-compiler-policy.ts";
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

/** Hash-equivalent exact file inventory for preservation assertions. */
function bytes(root: string): string {
  const digest = createHash("sha256");
  for (const name of readdirSync(root, { recursive: true }).map(String).sort()) {
    const file = join(root, name);
    if (lstatSync(file).isFile()) digest.update(name).update(readFileSync(file));
  }
  return digest.digest("hex");
}
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
  assert.deepEqual(result.rows[0]!.diagnostics[0], { code: "TS2322", file: "consumer.ts", line: 1, column: 7 });
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
  const before = bytes(tracker);
  // Observer failures still clean exclusive scratch and leave peer state alone.
  for (const phase of ["allocated", "cleanup"]) await assert.rejects(checkSdkContracts({ minimum: target, current: target, onProgress(current) {
    if (current === phase) throw new Error("observer stopped");
  } }), /observer stopped/);
  assert.equal(bytes(tracker), before);
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
          cwd: project, encoding: "utf8", timeout: 120000, env: { ...process.env, PATH: noGit, GIT_CEILING_DIRECTORIES: root },
        });
        assert.equal(cliRun.status, 0, cliRun.stderr);
        if (format.length) assert.equal(JSON.parse(cliRun.stdout).checks, 4);
        else assert.match(cliRun.stdout, /checks: 4/);
      }
    }
    // The same packed module also works with PATH containing no git (or other tools).
    const noGitRun = spawnSync(executable, [entry], {
      cwd: project, encoding: "utf8", timeout: 120000, env: { ...process.env, PATH: noGit, GIT_CEILING_DIRECTORIES: root },
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
import {appendFileSync,readFileSync} from 'node:fs'; import {createRequire} from 'node:module';
const plain = new URL('./plain-tsc', import.meta.url).pathname;
if (process.argv.includes('--help') || process.argv.includes('--showConfig') || process.argv.includes('--listFilesOnly')) {
  const probe = spawnSync(process.execPath, [plain,...process.argv.slice(2)], {stdio:'inherit'}); process.exit(probe.status ?? 1);
}
const oracle = spawnSync(process.execPath, [plain,'--project','tsconfig.json','--noEmit','--pretty','false'], {encoding:'utf8'});
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
    assert.equal(row.diagnostic_count, (oracle.output.match(/error TS\d+:/g) ?? []).length);
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

test("all compiler errors drift, including external TS2304 hidden by a consumer skipLibCheck true", async t => {
  const project = installedConsumer("bun", "current");
  const config = consumerConfig(project, "nodenext", "esm").replace('"skipLibCheck": false', '"skipLibCheck": true');
  writeFileSync(join(project, "tsconfig.json"), config);
  writeFileSync(join(project, "contract.d.mts"), "export declare const value: AbsentType;");
  writeFileSync(join(project, "consumer.mts"), 'import {value} from "./contract.mjs"; export const use = value;');
  // The product must override only this compiler flag; the source/config bytes survive.
  const minimum = { root: join(installedConsumer("npm", "minimum"), "node_modules/@unbrained/pm-cli"), version: minimumVersion };
  const current = { root: join(project, "node_modules/@unbrained/pm-cli"), version: currentVersion };
  const before = bytes(project);
  const matrix = await checkSdkContracts({ minimum, current, consumer: project });
  assert.equal(matrix.failed, 2);
  for (const row of matrix.rows) {
    assert.deepEqual(row.codes, ["TS2304"]);
    assert.deepEqual(row.diagnostics, [{ code: "TS2304", file: "contract.d.mts", line: 1, column: 29 }]);
  }
  assert.equal(bytes(project), before);
  t.diagnostic("Consumer sources, configuration and installed packages are unchanged.");
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
if (process.argv.includes("--help") || process.argv.includes("--showConfig") || process.argv.includes("--listFilesOnly")) { const result = spawnSync(process.execPath, [${JSON.stringify(compiler)}, ...process.argv.slice(2)], {stdio:"inherit"}); process.exit(result.status ?? 1); }
process.stdout.write(${JSON.stringify(output)}); process.exit(1);`);
  const matrix = await checkSdkContracts({ minimum: target, current: target, compiler: stub, examples: [SDK_CONSUMER_EXAMPLES[0]!] });
  assert.equal(matrix.failed, 2);
  assert.deepEqual(matrix.rows[0]!.diagnostics, [
    {code: "TS5099", file: "<config>", line: 0, column: 0},
    {code: "TS9999", file: "<external>", line: 2, column: 3},
    {code: "TS2322", file: "consumer.ts", line: 4, column: 5},
  ]);
  assert.doesNotMatch(JSON.stringify(matrix), /private source|secret|private configuration/);
});

test("review reproductions require and versioned types declarations report TS2339 and TS2305 instead of false success", async t => {
  const root = scratch(t);
  for (const layout of ["types", "types@"]) await t.test(layout, async () => {
    const project = join(root, layout);
    const rootSdk = declarationLayout(join(project, "node_modules/@unbrained/pm-cli"), pinned, layout);
    const contract = join(project, "contract.d.cts");
    writeFileSync(contract, 'import sdk = require("@unbrained/pm-cli/sdk"); import {onlyImport} from "@unbrained/pm-cli/sdk"; export declare const use: typeof sdk.api.onlyImport;');
    const matrix = await checkSdkContracts({ minimum: { root: rootSdk, version: pinned }, current: { root: rootSdk, version: pinned }, compiler,
      examples: [{ id: "review", source: `import {use} from ${JSON.stringify(contract.replace(/\.d\.cts$/, ".cjs"))}; export const value = use;` }] });
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
  for (const name of ["typescript", "@typescript"]) symlinkSync(join(repo, "node_modules", name), join(modules, name), "junction");
  const matrix = await checkSdkContracts({ minimum: target, current: target, compiler: join(modules, "typescript/bin/tsc"),
    examples: [{ id: "ambient", source: "export const value = 1;" }] });
  assert.equal(matrix.failed, 2);
  assert.ok(matrix.rows.every(row => row.codes.includes("TS2688")));
});

test("absolute-import inline declarations rebind newer-only acquireLockLease to each isolated SDK", async t => {
  const root = scratch(t), endpoints = publishedSdks();
  const external = join(dirname(dirname(dirname(endpoints.current))), "external.d.mts");
  writeFileSync(external, 'import * as sdk from "@unbrained/pm-cli/sdk"; export declare const publicSdk: typeof sdk;');
  const before = readFileSync(external, "utf8");
  for (const [quote, suffix] of [['"', ".d.mts"], ["'", ".d.mts"], ['"', ".d.ts"], ['"', ".d.cts"]]) {
    const declaration = external.replace(".d.mts", suffix!);
    writeFileSync(declaration, before);
    const matrix = await checkSdkContracts({ minimum: { root: endpoints.minimum, version: minimumVersion }, current: { root: endpoints.current, version: currentVersion }, compiler,
      examples: [{ id: "absolute-import", source: `import {publicSdk} from ${quote}${declaration.replace(/\.d\.mts$/, ".mjs").replace(/\.d\.cts$/, ".cjs").replace(/\.d\.ts$/, ".js")}${quote}; export const lease = publicSdk.acquireLockLease;` }] });
    assertLeaseDrift(matrix);
    assert.doesNotMatch(JSON.stringify(matrix), /sdk-published-test/);
  }
  assert.equal(readFileSync(external, "utf8"), before);
  const relative = join(root, "relative.d.mts");
  writeFileSync(relative, 'export {publicSdk} from "./other.mjs";');
  await assert.rejects(checkSdkContracts({ minimum: target, current: target, examples: [{ id: "external-graph", source: `export * from ${JSON.stringify(relative)};` }] }), refuses("isolation_refused"));
});

test("compiler entries run in place: ESM wrapper, CJS wrapper, lib/tsc.js and bin shim", async t => {
  const root = scratch(t), receipt = join(root, "receipt.jsonl");
  const helper = `const {spawnSync} = require('node:child_process'); const {appendFileSync,existsSync} = require('node:fs');
for (const key of ['NODE_PATH','NODE_OPTIONS','TS_NODE_PROJECT','TSC_WATCHFILE','TSGO_TEST_SETTING']) if (process.env[key] !== undefined) throw new Error('inherited resolution state');
if (existsSync('compiler.cjs') || existsSync('node_modules/typescript/bin/tsc')) throw new Error('compiler copied');
appendFileSync(${JSON.stringify(receipt)}, JSON.stringify({entry:process.argv[1],cwd:process.cwd(),args:process.argv.slice(2)})+'\\n');
const result = spawnSync(process.execPath,[${JSON.stringify(compiler)},...process.argv.slice(2)],{stdio:'inherit'}); process.exit(result.status ?? 1);`;
  writeFileSync(join(root, "helper.cjs"), helper);
  writeFileSync(join(root, "wrapper.cjs"), 'require("./helper.cjs");');
  writeFileSync(join(root, "wrapper.mjs"), 'import "./helper.cjs";');
  const shim = join(root, "bin-shim");
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  writeFileSync(shim, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(compiler)} "$@"\n`); chmodSync(shim, 0o755);
  const keys = ["NODE_PATH", "NODE_OPTIONS", "TS_NODE_PROJECT", "TSC_WATCHFILE", "TSGO_TEST_SETTING"];
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
  assert.equal(records.filter(row => row.args.includes("--pretty") && !row.args.includes("--showConfig") && !row.args.includes("--listFilesOnly")).length, 4);
  assert.ok(records.every(row => [join(root, "wrapper.mjs"), join(root, "wrapper.cjs")].includes(row.entry) && row.cwd !== root));
  assert.equal(records.filter(row => row.args.includes("--help")).length, 2, "query each wrapper once across both targets");
});

test("hermetic project refuses outside imports, reference paths, config aliases and nested SDK installations", async t => {
  const root = scratch(t), project = installedConsumer("npm", "current");
  const config = consumerConfig(project, "nodenext", "esm");
  const external = join(root, "external.d.mts"); writeFileSync(external, "export declare const value: number;");
  const outside = external.replace(/\.d\.mts$/, ".mjs");
  writeFileSync(join(project, "bridge.d.mts"), `export {value} from ${JSON.stringify(outside)};`);
  const sources = [`import {value} from ${JSON.stringify(outside)}; export const use = value;`,
    `/// <reference path=${JSON.stringify(external)} />\nexport const use = 1;`,
    `export * from ${JSON.stringify(join(root, "missing.mjs"))};`,
    `/// <reference path=${JSON.stringify(join(root, "missing.d.ts"))} />\nexport const use = 1;`,
    'import {value} from "./bridge.mjs"; export const use = value;'];
  for (const [index, source] of sources.entries()) {
    writeFileSync(join(project, "consumer.mts"), source);
    await assert.rejects(checkSdkContracts({ minimum: target, current: target, consumer: project }), refuses("isolation_refused"), `outside source ${index}`);
  }
  writeFileSync(join(project, "consumer.mts"), "export const use = 1;");
  const patches = [{ paths: { unused: [external] } }, { typeRoots: [root] }, { baseUrl: root }, { rootDirs: [root] }, { rootDir: root }, { types: [external] }];
  for (const patch of patches) {
    const changed = JSON.parse(config) as {compilerOptions: Record<string, unknown>}; Object.assign(changed.compilerOptions, patch);
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify(changed));
    await assert.rejects(checkSdkContracts({ minimum: target, current: target, consumer: project }), refuses("isolation_refused"));
  }
  for (const patch of [{ files: [external] }, { references: [{path: root}] }]) {
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({...JSON.parse(config), ...patch}));
    await assert.rejects(checkSdkContracts({ minimum: target, current: target, consumer: project }), refuses("isolation_refused"));
  }
  writeFileSync(join(project, "tsconfig.json"), config);
  const nested = join(project, "node_modules/nested");
  cpSync(sdk, join(nested, "node_modules/@unbrained/pm-cli"), {recursive: true});
  writeFileSync(join(nested, "package.json"), JSON.stringify({type: "module"}));
  writeFileSync(join(nested, "contract.d.mts"), 'export * from "@unbrained/pm-cli/sdk";');
  writeFileSync(join(project, "consumer.mts"), 'import {PmClient} from "./node_modules/nested/contract.mjs"; export const use = PmClient;');
  await assert.rejects(checkSdkContracts({ minimum: target, current: target, consumer: project }), refuses("isolation_refused"));
  rmSync(nested, {recursive: true, force: true});
});

test("hermetic provenance fails closed on empty, forged and post-compilation external file lists", async t => {
  const root = scratch(t), entry = join(root, "compiler.cjs"), external = join(root, "external.d.ts");
  writeFileSync(external, "export declare const value: number;");
  for (const mode of ["empty", "forged", "missing", "indented", "post", "config", "config-path", "diagnostics"]) {
    writeFileSync(entry, `const {spawnSync}=require('node:child_process'); const {existsSync,writeFileSync}=require('node:fs');
const marker = require('node:path').join(process.cwd(),'checked');
if (['config','config-path'].includes(${JSON.stringify(mode)}) && process.argv.includes('--showConfig')) {process.stdout.write(${JSON.stringify(mode === 'config-path' ? JSON.stringify({compilerOptions: {paths: {unused: [7]}}, files: ['consumer.ts']}) : '{}')}); process.exit(0);}
if (${JSON.stringify(mode)} === 'diagnostics' && !process.argv.includes('--help') && !process.argv.includes('--showConfig') && !process.argv.includes('--listFilesOnly')) {process.stdout.write('noise error TS9999:'); process.exit(1);}
if (process.argv.includes('--listFilesOnly') && (!['post','config','diagnostics'].includes(${JSON.stringify(mode)}) || existsSync(marker))) {
  process.stdout.write(${mode === "indented" ? `require("node:path").join(process.cwd(),"consumer.ts") + ${JSON.stringify(`\n  ${external}\n`)}` : JSON.stringify(mode === "empty" ? "" : mode === "forged" ? `unstructured ${external}\n` : mode === "missing" ? `${external}.missing\n` : `${external}\n`)}); process.exit(0);
}
const result=spawnSync(process.execPath,[${JSON.stringify(compiler)},...process.argv.slice(2)],{stdio:'inherit'});
if (!process.argv.includes('--help') && !process.argv.includes('--showConfig') && !process.argv.includes('--listFilesOnly')) writeFileSync(marker,'compiled'); process.exit(result.status ?? 1);`);
    await assert.rejects(checkSdkContracts({ minimum: target, current: target, compiler: entry, examples: [SDK_CONSUMER_EXAMPLES[0]!] }), refuses(mode === "diagnostics" ? "compiler_unavailable" : "isolation_refused"));
  }
});

test("inline relocation preserves module kind, nested absolute imports and reference directives", async t => {
  const root = scratch(t);
  writeFileSync(join(root, "package.json"), JSON.stringify({type: "module"}));
  const selected = {root: declarationLayout(join(root, "sdk"), pinned, "types"), version: pinned};
  const leaf = join(root, "leaf.d.ts"), parent = join(root, "parent.d.mts"), globals = join(root, "globals.d.mts");
  writeFileSync(leaf, 'import {api} from "@unbrained/pm-cli/sdk"; export declare const use: typeof api.onlyImport;');
  writeFileSync(parent, `export {use} from ${JSON.stringify(leaf.replace(".d.ts", ".js"))};`);
  writeFileSync(globals, "export {}; declare global { type ReferenceValue = number; }");
  const module = leaf.replace(".d.ts", ".js"), nested = parent.replace(".d.mts", ".mjs");
  const matrix = await checkSdkContracts({ minimum: selected, current: selected, compiler, examples: [
    {id: "module-kind", source: `import {use} from ${JSON.stringify(module)}; import {use as again} from ${JSON.stringify(module)}; export const value = [use, again, "/"];`},
    {id: "nested", source: `import {use} from ${JSON.stringify(nested)}; export const value = use;`},
    {id: "reference", source: `/// <reference path=${JSON.stringify(globals)} />\nexport const value: ReferenceValue = 1;`},
  ] });
  assert.equal(matrix.ok, true); assert.equal(matrix.checks, 6);
});

test("inline declaration relocation refuses missing, SDK-owned, oversized and excessive external graphs", async t => {
  const root = scratch(t), huge = join(root, "huge.d.ts");
  writeFileSync(huge, " ".repeat(65537));
  for (const file of [join(root, "missing.d.ts"), join(root, "source.ts"), join(sdk, "dist/sdk/index.d.ts"), huge]) {
    await assert.rejects(checkSdkContracts({ minimum: target, current: target, examples: [{id: "outside", source: `export * from ${JSON.stringify(file)};`}] }), refuses("isolation_refused"));
  }
  const imports: string[] = [];
  for (let index = 0; index < 65; index++) {
    const file = join(root, `contract-${index}.d.mts`); writeFileSync(file, `export declare const value${index}: number;`);
    imports.push(`export * from ${JSON.stringify(file.replace(".d.mts", ".mjs"))};`);
  }
  await assert.rejects(checkSdkContracts({ minimum: target, current: target, examples: [{id: "bounded", source: imports.join("\n")}] }), refuses("isolation_refused"));
  writeFileSync(join(root, "package.json"), "{");
  await assert.rejects(checkSdkContracts({ minimum: target, current: target, examples: [{id: "metadata", source: `export * from ${JSON.stringify(huge)};`}] }), refuses("isolation_refused"));
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
  const plain = spawnSync(process.execPath, [compiler, "--project", "tsconfig.json", "--noEmit"], {cwd: root, encoding: "utf8"}); assert.equal(plain.status, 0, plain.stdout);
  const matrix = await checkSdkContracts({minimum: target, current: target, consumer: root});
  assert.equal(matrix.ok, plain.status === 0); assert.equal(matrix.checks, 2);
  // A missing referenced build must remain an error; dropping references would
  // silently compile the referenced source instead of checking its built contract.
  writeFileSync(join(root, "consumer.mts"), 'import {value} from "./reference/index.js"; export const use = value;');
  unlinkSync(join(reference, "dist/index.d.ts"));
  const missing = spawnSync(process.execPath, [compiler, "--project", "tsconfig.json", "--noEmit"], {cwd: root, encoding: "utf8"});
  assert.notEqual(missing.status, 0);
  assert.match(missing.stdout, /TS6305/);
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
  const plain = spawnSync(process.execPath, [compiler, "--project", "tsconfig.json", "--noEmit"], {cwd: root, encoding: "utf8"});
  assert.equal(plain.status, 0, plain.stdout);
  const before = bytes(root);
  const matrix = await checkSdkContracts({minimum: target, current: target, consumer: root});
  assert.equal(matrix.ok, plain.status === 0); assert.equal(matrix.checks, 2);
  assert.equal(bytes(root), before);
});


/** Use the compiler's own complete table as the parameter source for safety controls. */
function realCompilerPolicy() {
  const help = spawnSync(process.execPath, [compiler, "--help", "--all", "--locale", "en"], {encoding: "utf8"});
  assert.equal(help.status, 0, help.stderr);
  return classifiedCompilerOptions(help.stdout);
}

for (const [name, row] of realCompilerPolicy()) {
  if (row.category === "neutral") continue;
  test(`compiler option ${row.category}: ${name}`, async t => {
    const root = scratch(t), outside = join(root, "outside"), project = installedConsumer("npm", "minimum"), endpoints = publishedSdks();
    mkdirSync(outside);
    writeFileSync(join(outside, "sentinel"), "unchanged external data");
    const expected = bytes(outside);
    const minimum = {root: endpoints.minimum, version: minimumVersion};
    const current = {root: endpoints.current, version: currentVersion};
    const extension = name === "allowJs" || name === "checkJs" ? "mjs" : "mts";
    const source = row.category === "checking"
      ? 'import {nonexistentSdkExportForPolicyControl} from "@unbrained/pm-cli/sdk/authoring"; export const use = nonexistentSdkExportForPolicyControl;'
      : "export const safe = 1;";
    writeFileSync(join(project, `policy.${extension}`), source);
    const attack = row.safe === null || name === "pprofDir" ? join(outside, name) : (row.safe === "command" || row.safe === "off") ? true : !row.safe;
    const config = JSON.stringify({compilerOptions: {target: "ES2022", module: "NodeNext", types: ["node"],
      // Every output control also carries the cache escape reported in review.
      incremental: true, allowJs: true, checkJs: false, tsBuildInfoFile: join(outside, "build-info"), [name]: attack}, files: [`policy.${extension}`]});
    writeFileSync(join(project, "tsconfig.json"), config);
    if (row.safe === "command" || row.safe === "off") {
      // Command-only modes are disabled or never forwarded. Invalid config uses
      // must also stop without creating or overwriting an external file.
      try { await checkSdkContracts({minimum, current, consumer: project}); }
      catch (error) { assert.ok(refuses("isolation_refused")(error)); }
    } else {
      const matrix = await checkSdkContracts({minimum, current, consumer: project});
      if (row.category === "checking") {
        assert.equal(matrix.rows[0]!.target, "minimum");
        assert.equal(matrix.rows[0]!.ok, false, name);
        assert.ok(matrix.rows[0]!.codes.includes("TS2305"), `${name}: ${matrix.rows[0]!.codes}`);
        assert.equal(matrix.failed, 2, name);
      } else assert.equal(matrix.ok, true, `${name}: ${JSON.stringify(matrix.rows)}`);
    }
    assert.equal(bytes(outside), expected, `${name}: no outside file created or overwritten`);
    assert.equal(readFileSync(join(project, "tsconfig.json"), "utf8"), config);
    assert.equal(readFileSync(join(project, `policy.${extension}`), "utf8"), source);
  });
}

test("future compiler option refuses before config inspection and help is queried once per compiler", async t => {
  const root = scratch(t), entry = join(root, "compiler.cjs");
  writeFileSync(entry, `const {spawnSync} = require('node:child_process');
if (!process.argv.includes('--help')) throw new Error('policy must refuse before config inspection');
const result = spawnSync(process.execPath, [${JSON.stringify(compiler)}, ...process.argv.slice(2)], {encoding:'utf8'});
process.stdout.write(result.stdout + '\\n--futureUnsafeOption\\ntype: boolean\\n');`);
  await assert.rejects(checkSdkContracts({minimum: target, current: target, compiler: entry}), refuses("isolation_refused"));
});

test("compiler config inspection crash and malformed JSON retain typed refusals and cleanup after option discovery", async t => {
  const root = scratch(t), entry = join(root, "compiler.cjs"), receipt = join(root, "calls.jsonl");
  for (const failure of ["crash", "malformed"]) {
    writeFileSync(receipt, "");
    writeFileSync(entry, `const {spawnSync} = require('node:child_process'); const {appendFileSync} = require('node:fs');
const discovery = process.argv.includes('--help');
appendFileSync(${JSON.stringify(receipt)}, (discovery ? 'help' : 'config') + '\\n');
if (!discovery) { ${failure === "crash" ? "process.exit(7);" : "process.stdout.write('not JSON'); process.exit(0);"} }
const result = spawnSync(process.execPath, [${JSON.stringify(compiler)}, ...process.argv.slice(2)], {stdio:'inherit'});
process.exit(result.status ?? 1);`);
    const phases: string[] = [];
    await assert.rejects(checkSdkContracts({minimum: target, current: target, compiler: entry,
      examples: [SDK_CONSUMER_EXAMPLES[0]!], onProgress: phase => { phases.push(phase); }}), refuses(failure === "crash" ? "compiler_unavailable" : "isolation_refused"));
    assert.deepEqual(readFileSync(receipt, "utf8").trim().split("\n"), ["help", "config"]);
    assert.deepEqual(phases, ["allocated", "linked", "cleanup"]);
  }
});

/** Instrument the same compiler to compare untouched and bounded programs at compilation time. */
function instrumentDiscoveryOracle(project: string, receipt: string): void {
  const bin = join(project, "node_modules/typescript/bin");
  writeFileSync(join(bin, "plain-tsc"), readFileSync(join(bin, "tsc")));
  unlinkSync(join(bin, "tsc"));
  writeFileSync(join(bin, "tsc"), `import {spawnSync} from 'node:child_process';
import {appendFileSync,existsSync,statSync} from 'node:fs'; import {relative,basename,resolve} from 'node:path';
const plain = new URL('./plain-tsc', import.meta.url).pathname;
const args = process.argv.slice(2);
const run = args => { const result = spawnSync(process.execPath,[plain,...args],{encoding:'utf8',maxBuffer:64*1024*1024,timeout:30000}); if (result.error || result.signal || result.status === null) throw new Error('plain tsc oracle failed', {cause:result.error}); return result; };
if (!args.includes('--help') && !args.includes('--showConfig') && !args.includes('--listFilesOnly')) {
  const original = run(['--project','tsconfig.json','--noEmit','--pretty','false','--locale','en']);
  const originalFiles = run(['--project','tsconfig.json','--listFilesOnly','--pretty','false','--locale','en']);
  const checkedFiles = run([...args,'--listFilesOnly']);
  const normalize = output => [...new Set(output.split(/\\r?\\n/).filter(line => line && existsSync(resolve(line)) && statSync(resolve(line)).isFile()).map(line => resolve(line)).map(file => /[/\\\\](?:lib|\\.sdk-contract-libs)[/\\\\]lib\\..*\\.d\\.ts$/.test(file) ? '<lib>/' + basename(file) : relative(process.cwd(),file).replaceAll('\\\\','/')))].sort();
  appendFileSync(${JSON.stringify(receipt)},JSON.stringify({original:normalize(originalFiles.stdout),checked:normalize(checkedFiles.stdout),status:original.status,codes:[...original.stdout.matchAll(/error (TS\\d+):/g)].map(match => match[1]).sort()}) + '\\n');
}
const result = run(args); process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exit(result.status ?? 1);`);
}

/** Each corpus member changes original discovery or diagnostic presentation independently. */
interface DiscoveryCase {
  name: string;
  config: Record<string, unknown>;
  files?: Record<string, string>;
  build?: boolean;
}

test("original discovery differential corpus equals plain tsc file lists, verdicts and error codes", async t => {
  const project = scratch(t), receipt = join(scratch(t), "discovery.jsonl");
  const base = installedConsumer("npm", "current"), endpoints = publishedSdks();
  cpSync(join(base, "node_modules"), join(project, "node_modules"), {recursive: true});
  writeFileSync(join(project, "package.json"), JSON.stringify({type: "module"}));
  instrumentDiscoveryOracle(project, receipt);
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
    {name: "paths", config: {compilerOptions: {paths: {"local-contract": ["./input/contract.d.mts"]}}, files: ["input/src/consumer.mts"]}, files: {"src/consumer.mts": 'import {value} from "local-contract"; export const use = value;', "contract.d.mts": "export declare const value: number;"}},
    {name: "typeRoots-types", config: {compilerOptions: {typeRoots: ["input/typings", "node_modules/@types"], types: ["local", "node"]}, files: ["input/src/consumer.mts"]}, files: {"typings/local/index.d.ts": "declare const localValue: number;", "src/consumer.mts": "export const use = localValue;"}},
    {name: "types-empty", config: {compilerOptions: {types: []}, files: ["input/src/consumer.mts"]}, files: {"src/consumer.mts": "export const use = 1;"}},
    {name: "extends-chain-outDir", config: {extends: "./input/config/child.json", compilerOptions: {types: ["node"]}}, files: {"config/base.json": JSON.stringify({compilerOptions: {...options, outDir: "../dist"}, include: ["../src/**/*", "../dist/**/*"]}), "config/child.json": JSON.stringify({extends: "./base.json"}), "dist/stale.d.ts": stale, "src/consumer.mts": bad}},
    {name: "extends-include-exclude", config: {extends: "./input/config/base.json"}, files: {"config/base.json": JSON.stringify({include: ["../**/*"], exclude: ["../excluded"]}), "excluded/stale.d.ts": stale}},
    {name: "reference-built", config: {files: ["input/src/consumer.mts"], references: [{path: "input/reference"}]}, files: {"reference/tsconfig.json": JSON.stringify({compilerOptions: {composite: true, module: "NodeNext", target: "ES2022", types: [], outDir: "dist"}, files: ["index.ts"]}), "reference/index.ts": "export const value = 1;", "src/consumer.mts": 'import {value} from "../reference/index.js"; export const use = value;'}, build: true},
    {name: "reference-missing-build", config: {files: ["input/src/consumer.mts"], references: [{path: "input/reference"}]}, files: {"reference/tsconfig.json": JSON.stringify({compilerOptions: {composite: true, module: "NodeNext", target: "ES2022", types: [], outDir: "dist"}, files: ["index.ts"]}), "reference/index.ts": "export const value = 1;", "src/consumer.mts": 'import {value} from "../reference/index.js"; export const use = value;'}},
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
      const build = spawnSync(process.execPath, [join(project, "node_modules/typescript/bin/plain-tsc"), "--build", "input/reference"], {cwd: project, encoding: "utf8"});
      assert.equal(build.status, 0, `${entry.name}: ${build.stdout}`);
    }
    writeFileSync(receipt, "");
    const matrix = await checkSdkContracts({minimum: {root: endpoints.minimum, version: minimumVersion}, current: {root: endpoints.current, version: currentVersion}, consumer: project});
    const records = readFileSync(receipt, "utf8").trim().split("\n").map(line => JSON.parse(line) as {original: string[]; checked: string[]; status: number; codes: string[]});
    assert.equal(records.length, 2, entry.name);
    for (const [index, record] of records.entries()) {
      assert.deepEqual(record.checked, record.original, `${entry.name}: ${matrix.rows[index]!.target} file list`);
      comparisons++;
    }
    const oracle = records[1]!, current = matrix.rows[1]!;
    assert.equal(current.ok, oracle.status === 0, `${entry.name}: current verdict`);
    assert.deepEqual([...current.codes].sort(), oracle.codes, `${entry.name}: current error codes`);
    assert.equal(current.diagnostic_count, oracle.codes.length, entry.name);
  }
  t.diagnostic(`Discovery differential: ${corpus.length} configs, ${comparisons} file-list comparisons, ${corpus.length} current verdict/error-code comparisons; zero disagreements.`);
});
