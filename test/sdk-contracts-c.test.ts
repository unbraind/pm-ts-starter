/** Resolution self-tests, registered-command and packed-consumer contracts. Part c of the SDK contract suite; see sdk-contracts-support.ts. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {dependencyEntry, testCompiler, directApiDiagnostics, dependencyBound, filesystemSnapshot, boundaryRandom, INSTALL_TIMEOUT_MS, bunExecutable} from "./dependency-fixtures.ts";
import { PmClient } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import extension from "../index.ts";
import { checkSdkContracts as compileSdkContracts, parseSdkConsumerExamples, resolveSdkContractCompiler, SDK_CONSUMER_EXAMPLES, type SdkContractOptions, type SdkContractMatrix } from "../sdk-contracts.ts";
import { testDepth, testTimeout } from "./support/depth.ts";
import test, { type TestContext } from "node:test";
import { repo, sdk, pinned, target, compiler, checkSdkContracts, minimumVersion, currentVersion, installationEnv, publishedSdks, scratch, assertMutationDrift, removeGraphExport, refuses, command, packedFixture, installedConsumer, instrumentOracle, declarationLayout, consumerConfig, compareOracle } from "./sdk-contracts-support.ts";

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
  await assert.rejects(checkSdkContracts({ ...targets, examples, compiler: stub }), refuses("compiler_unavailable"));
});

/** Hostile names retain their bytes across source literals, compiler ASTs and structured resolution. */

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

test("wrong SDK identity, unavailable packages and external wrappers have typed safe remedies", async t => {
  const root = scratch(t);
  for (const minimum of [null, { root: sdk, version: "latest" }, { root: 1, version: pinned }, { root: " ", version: pinned },
    { root, version: pinned }, { root: sdk, version: "1900.1.1" }]) {
    await assert.rejects(checkSdkContracts({ minimum, current: target } as SdkContractOptions), refuses("sdk_unavailable"));
  }
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "foreign", version: pinned }));
  await assert.rejects(checkSdkContracts({ minimum: { ...target, root }, current: target }), refuses("sdk_unavailable"));
  const wrapper = join(root, "compiler.cjs");
  writeFileSync(wrapper, 'throw new Error("external wrapper must not execute");');
  await assert.rejects(checkSdkContracts({ minimum: target, current: target, compiler: wrapper }), error => {
    assert.ok(refuses("compiler_unavailable")(error));
    assert.match((error as Error).message, /Select a file inside node_modules\/typescript.*external shell\/JavaScript wrappers are rejected/);
    return true;
  });
  for (const entry of [root, join(root, "missing")]) await assert.rejects(checkSdkContracts({ minimum: target, current: target, compiler: entry }), refuses("compiler_unavailable"));
  assert.throws(() => resolveSdkContractCompiler(join(root, "consumer.cjs")), refuses("compiler_unavailable"));
  assert.equal(resolveSdkContractCompiler(), join(repo, "node_modules/typescript/bin/tsc"));
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
  // Boundary competition needs real compiler matrices, not repeated copies of
  // the entire published SDK graph (covered by the compatibility tests above).
  const consumer = join(root, "consumer");
  mkdirSync(join(consumer, "node_modules"), {recursive: true});
  symlinkSync(dirname(dirname(compiler)), join(consumer, "node_modules/typescript"), "junction");
  writeFileSync(join(consumer, "consumer.mts"), 'import {sdk} from "@unbrained/pm-cli"; export {sdk};');
  writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], module: "NodeNext"}, files: ["consumer.mts"]}));
  const bound = dependencyBound(consumer);
  const matrix = { minimum: bound, current: bound, consumer };
  const client = new PmClient({ pmRoot: tracker, noExtensions: true, author: "fixture" });
  await client.init("contract");
  const item = await client.create({ title: "Original public fixture" });
  const original = readFileSync(join(tracker, "tasks", `${item.item.id}.toon`), "utf8");
  const peerItem = await client.create({ title: "Peer-owned independent state" });
  // There is no shared mutation path: every meaningful phase receives a competing
  // real tracker transition plus a second complete matrix. Foreign bytes survive.
  const phases: string[] = [];
  await checkSdkContracts({ ...matrix, onProgress(phase) {
    phases.push(phase);
    writeFileSync(join(tracker, "foreign-peer.json"), JSON.stringify({ phase, owner: "peer", success: true }));
    const peer = spawnSync(process.execPath, ["--input-type=module", "-e", `import {checkSdkContracts} from ${JSON.stringify(pathToFileURL(join(repo, "sdk-contracts.ts")).href)};
import {PmClient} from ${JSON.stringify(import.meta.resolve("@unbrained/pm-cli/sdk/core"))};
await new PmClient({pmRoot: ${JSON.stringify(tracker)}, noExtensions: true, author: 'peer'}).update(${JSON.stringify(peerItem.item.id)}, {description: ${JSON.stringify(phase + "-" + phases.length)}});
const compile = ${process.env.PM_TEST_DEPTH !== "quick" || phases.length === 1};
const result = compile ? await checkSdkContracts(${JSON.stringify(matrix)}) : {ok: true};
process.exit(result.ok ? 0 : 1);`], { encoding: "utf8", timeout: testTimeout(60_000), killSignal: "SIGKILL", env: { ...process.env, GIT_CEILING_DIRECTORIES: root, PATH: "" } });
    assert.equal(peer.status, 0, `${peer.error?.message ?? ""} ${peer.stdout} ${peer.stderr}`);
    assert.equal(JSON.parse(readFileSync(join(tracker, "foreign-peer.json"), "utf8")).success, true);
  } });
  assert.deepEqual(phases, ["allocated", "linked", "compiled", "linked", "compiled", "cleanup"]);
  rmSync(join(tracker, "foreign-peer.json"));
  assert.equal(readFileSync(join(tracker, "tasks", `${item.item.id}.toon`), "utf8"), original);
  assert.equal((await client.listAllComplete()).items.find(row => row.id === peerItem.item.id)?.description, "cleanup-6");
  const before = filesystemSnapshot(tracker);
  // Observer failures still clean exclusive scratch and leave peer state alone.
  for (const phase of ["allocated", "cleanup"]) await assert.rejects(checkSdkContracts({ ...matrix, onProgress(current) {
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
  // A malformed --consumer gets a remedy that names the flag and its directory value.
  await assert.rejects(async () => handler.run({ ...base, options: { ...options, consumer: true } }), error => error instanceof Error && /--consumer takes a project directory/.test(error.message));
  const { compiler: _compiler, ...withoutCompiler } = options;
  await assert.rejects(async () => handler.run({...base, options: withoutCompiler}), error => error instanceof Error && error.message.includes("createProgram"));
  await assert.rejects(async () => handler.run({ ...base, args: ["extra"] }), error => error instanceof Error && error.name === "PmCliError");
  writeFileSync(examples, JSON.stringify([{ id: "removed", source: "import { removedApi } from '@unbrained/pm-cli/sdk'; export const use = removedApi;" }]));
  const saved = process.exitCode;
  try {
    assert.equal((await handler.run({ ...base, options: { ...options, examples } }) as { ok: boolean }).ok, false);
    assert.equal(process.exitCode, 1);
  } finally { process.exitCode = saved; }
});

/** Get the exact npm archive filename through JSON, including whitespace and control characters. */

test("packed npm and Bun consumers resolve each exact SDK bound and compile emitted contracts without git", async t => {
  const root = scratch(t);
  const tarball = packedFixture(repo, root);
  const noGit = join(root, "no-git"); mkdirSync(noGit);
  const verified = new Set<string>();
  const paths = ["sdk", "cli-json", "cli-toon", "refusal-json", "refusal-toon", "sdk-no-git"].slice(0, testDepth(6, 1));
  const lanes = [["npm", "minimum"], ["npm", "current"], ["bun", "minimum"], ["bun", "current"]] as const;
  // Exhaustive installed SDK/CLI representations belong to deep; quick keeps one complete real installed graph.
  const selectedLanes = process.env.PM_TEST_DEPTH === "quick" ? lanes.filter(([runtime, bound]) => runtime === "npm" && bound === "current") : lanes;
  for (const [runtime, bound] of selectedLanes) {
    const version = bound === "minimum" ? minimumVersion : currentVersion;
    const project = installedConsumer(runtime as "npm" | "bun", bound);
    t.after(() => { for (const name of ["authoring.ts", "complete-read.ts", "emitted-consumer.ts", "consumer.mjs", "tsconfig.json", "tracker"]) rmSync(join(project, name), {recursive: true, force: true}); });
    const install = spawnSync(runtime, runtime === "npm"
      ? ["install", "--prefer-offline", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", tarball]
      : ["add", "--ignore-scripts", tarball], { cwd: project, encoding: "utf8", timeout: testTimeout(INSTALL_TIMEOUT_MS), env: installationEnv() });
    assert.equal(install.status, 0, install.stderr || install.stdout || install.error?.message || "Package installation failed.");
    const emitted = join(project, "node_modules/pm-ts-starter/dist/index.js").replaceAll("\\", "/");
    const ownMinimum = join(installedConsumer(runtime as "npm" | "bun", "minimum"), "node_modules/@unbrained/pm-cli");
    const ownCurrent = join(installedConsumer(runtime as "npm" | "bun", "current"), "node_modules/@unbrained/pm-cli");
    const options = { minimum: { root: ownMinimum, version: minimumVersion }, current: { root: ownCurrent, version: currentVersion }, consumer: project };
    for (const example of SDK_CONSUMER_EXAMPLES) writeFileSync(join(project, `${example.id}.ts`), example.source);
    writeFileSync(join(project, "emitted-consumer.ts"), `import { checkSdkContracts as compileSdkContracts, type SdkContractMatrix, type SdkContractOptions } from "pm-ts-starter";
export async function consume(options: SdkContractOptions): Promise<SdkContractMatrix> { return compileSdkContracts(options); }`);
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: false,
      module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022", types: ["node"] },
      files: ["authoring.ts", "complete-read.ts", "emitted-consumer.ts"] }));
    const entry = join(project, "consumer.mjs");
    const wrapper = join(project, 'compiler-wrapper.cjs');
    writeFileSync(wrapper, 'process.exit(47);'); chmodSync(wrapper, 0o755);
    writeFileSync(entry, `import extension, {checkSdkContracts} from 'pm-ts-starter';
import {createExtensionTestHarness} from '@unbrained/pm-cli/sdk/testing';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module'; import {readFileSync} from 'node:fs';
const harness = await createExtensionTestHarness(extension,{name:'pm-ts-starter',capabilities:['commands','renderers','hooks','schema','importers','search','parser','preflight','services']});
const help = harness.activation.registrations.flags.flatMap(entry=>entry.flags).find(entry=>entry.long==='--compiler').description;
assert.match(help,/external shell\\/JavaScript wrappers are rejected/);
await assert.rejects(checkSdkContracts({minimum:${JSON.stringify(options.minimum)},current:${JSON.stringify(options.current)},compiler:${JSON.stringify(wrapper)},examples:[{id:'inline',source:'export const value = 1;'}]}),error=>error.code==='compiler_unavailable'&&/wrappers are rejected/.test(error.remedy));
const require = createRequire(${JSON.stringify(emitted)});
const resolved = require.resolve('@unbrained/pm-cli/package.json');
const sdkVersion = JSON.parse(readFileSync(resolved, 'utf8')).version;
const sdkEntry = require.resolve('@unbrained/pm-cli/sdk');
console.log(JSON.stringify({sdkVersion, resolved, sdkEntry, matrix: await checkSdkContracts(${JSON.stringify(options)})}));`);
    const executable = runtime === "npm" ? process.execPath : bunExecutable();
    const run = spawnSync(executable, [entry], { cwd: project, encoding: "utf8", timeout: testTimeout(120000), env: { ...process.env, GIT_CEILING_DIRECTORIES: root } });
    assert.equal(run.status, 0, `${runtime} ${bound}: ${run.error?.message ?? run.stderr}`);
    const receipt = JSON.parse(run.stdout) as { sdkVersion: string; resolved: string; sdkEntry: string; matrix: { ok: boolean; checks: number; rows: { sdk: string; target: string }[] } };
    assert.equal(receipt.sdkVersion, version, `${runtime} ${bound} resolved SDK`);
    const installedSdk = join(project, "node_modules/@unbrained/pm-cli");
    assert.equal(receipt.resolved, join(installedSdk, "package.json"));
    assert.ok(receipt.sdkEntry.startsWith(`${installedSdk}/`));
    assert.equal(receipt.matrix.ok, true, JSON.stringify(receipt.matrix)); assert.equal(receipt.matrix.checks, 2);
    assert.deepEqual(receipt.matrix.rows.map(row => row.sdk), [minimumVersion, currentVersion]);
    verified.add(`${runtime}/${bound}/sdk`);
    if (testDepth(6, 1) === 1) continue;
    // Keep activated extensions outside the compiler's consumer input tree.
    const tracker = join(root, `${runtime}-${bound}-tracker`);
    const initialized = spawnSync(executable, ["--input-type=module", "-e", `import {PmClient} from '@unbrained/pm-cli/sdk';
await new PmClient({pmRoot:${JSON.stringify(tracker)},noExtensions:true,author:'fixture'}).init('packed');`], {cwd: project, encoding: "utf8", timeout: testTimeout(30000)});
    assert.equal(initialized.status, 0, initialized.stderr);
    const cli = join(project, "node_modules/@unbrained/pm-cli/dist/cli.js");
    const activated = spawnSync(executable, [cli, "--pm-path", tracker, "package", "install", join(project, "node_modules/pm-ts-starter"), "--project"], { cwd: project, encoding: "utf8", timeout: testTimeout(30000) });
    assert.equal(activated.status, 0, activated.stderr);
    const helpRun = spawnSync(executable, [cli, '--pm-path', tracker, 'ts-starter', 'sdk-contracts', '--help'], {cwd: project, encoding: 'utf8', timeout: testTimeout(30000)});
    assert.equal(helpRun.status, 0, helpRun.stderr);
    assert.match(helpRun.stdout.replace(/\s+/g, ' '), /external shell\/JavaScript wrappers are rejected/);
    for (const format of [[], ["--json"]]) {
      const cliRun = spawnSync(executable, [cli, "--pm-path", tracker, "ts-starter", "sdk-contracts", "--minimum-sdk", ownMinimum,
        "--current-sdk", ownCurrent, "--current-version", currentVersion, "--compiler", compiler, ...format], {
        cwd: project, encoding: "utf8", timeout: testTimeout(120000), env: { ...process.env, PATH: noGit, npm_node_execpath: process.execPath, GIT_CEILING_DIRECTORIES: root },
      });
      assert.equal(cliRun.status, 0, cliRun.stderr);
      if (format.length) assert.equal(JSON.parse(cliRun.stdout).checks, 4);
      else assert.match(cliRun.stdout, /checks: 4/);
      verified.add(`${runtime}/${bound}/cli-${format.length ? "json" : "toon"}`);
      const refused = spawnSync(executable, [cli, '--pm-path', tracker, 'ts-starter', 'sdk-contracts', '--minimum-sdk', ownMinimum, '--current-sdk', ownCurrent, '--current-version', currentVersion, '--compiler', wrapper, ...format], {cwd: project, encoding: 'utf8', timeout: testTimeout(30000)});
      assert.equal(refused.status, 2, refused.stderr);
      assert.match(refused.stdout + refused.stderr, /compiler_unavailable/);
      assert.match(refused.stdout + refused.stderr, /wrappers are rejected/);
      verified.add(`${runtime}/${bound}/refusal-${format.length ? "json" : "toon"}`);
    }
    const lane = `${runtime}/${bound}/`;
    assert.deepEqual([...verified].filter(key => key.startsWith(lane)).sort(), paths.filter(path => path !== "sdk-no-git").map(path => lane + path).sort(), "every installed graph must certify every SDK/CLI representation and refusal");
    // The same packed module also works with PATH containing no git (or other tools).
    const noGitRun = spawnSync(executable, [entry], {
      cwd: project, encoding: "utf8", timeout: testTimeout(120000), env: { ...process.env, PATH: noGit, npm_node_execpath: process.execPath, GIT_CEILING_DIRECTORIES: root },
    });
    assert.equal(noGitRun.status, 0, `${runtime} ${bound}: ${noGitRun.error?.message ?? noGitRun.stderr}`);
    assert.equal(JSON.parse(noGitRun.stdout).matrix.ok, true);
    verified.add(`${runtime}/${bound}/sdk-no-git`);
  }
  assert.deepEqual([...verified].sort(), selectedLanes.flatMap(([runtime, bound]) => paths.map(path => `${runtime}/${bound}/${path}`)).sort(), "every installed graph must certify every SDK/CLI representation and refusal");
});

/** Exact npm and Bun installations used as consumer-owned toolchains, without Git. */

test("differential compiler matrix covers node16 nodenext bundler, ESM import CJS require, types types@ typesVersions and both bounds", async t => {
  const root = scratch(t);
  let rows = 0, drift = 0, cases = 0, expectedDrift = 0;
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
          const lane = ["types", "types@", "typesVersions"].indexOf(layout) + ["node16", "nodenext", "bundler"].indexOf(resolution);
          if (testDepth(72, 9) < 72 && (runtime !== (lane % 2 ? "bun" : "npm") || mode !== (lane % 2 ? "cjs" : "esm") || control !== (lane % 3 ? "onlyImport" : "common"))) continue;
          cases++;
          const source = mode === "esm" ? `import {api${control === "onlyImport" ? ", onlyImport" : ""}} from "@unbrained/pm-cli/sdk"; export const use = api.${control};`
            : `import sdk = require("@unbrained/pm-cli/sdk"); ${control === "onlyImport" ? 'import {onlyImport} from "@unbrained/pm-cli/sdk";' : ""} export const use = sdk.api.${control};`;
          writeFileSync(join(project, `consumer.${mode === "esm" ? "mts" : "cts"}`), source);
          writeFileSync(receipt, "");
          const matrix = await checkSdkContracts({ minimum, current, consumer: project });
          compareOracle(matrix, receipt, project, config);
          const expected = control === "common" || (layout === "types" && mode === "esm");
          expectedDrift += expected ? 0 : 2;
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
  assert.equal(cases, testDepth(72, 9));
  assert.equal(rows, cases * 2); assert.equal(drift, expectedDrift);
  t.diagnostic(`Differential matrix: ${rows}/${rows} compiler verdicts agree; ${drift} drift, ${rows - drift} clean.`);
});

test("project inputs refuse ambiguous options and missing compiler APIs", async t => {
  const root = scratch(t);
  for (const patch of [{ consumer: 1 }, { consumer: " " }, { consumer: root, examples: SDK_CONSUMER_EXAMPLES }, { consumer: root, compiler }]) {
    await assert.rejects(checkSdkContracts({ minimum: target, current: target, ...patch } as SdkContractOptions), refuses("invalid_input"));
  }
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "sentinel"), "foreign state");
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ files: ["consumer.ts"] }));
  await assert.rejects(checkSdkContracts({ minimum: target, current: target, consumer: root }), refuses("compiler_unavailable"));
  assert.equal(readFileSync(join(root, ".git", "sentinel"), "utf8"), "foreign state");

});

/** Generated compiler hooks must keep their declared CommonJS module kind after sharing helpers. */
test("instrumented compiler oracle stays valid CommonJS", t => {
  const project = mkdtempSync(join(tmpdir(), "sdk-oracle-syntax-")), directory = join(project, "node_modules/typescript");
  mkdirSync(directory, {recursive:true});
  writeFileSync(join(directory,"package.json"),JSON.stringify({main:"lib/typescript.js"}));
  instrumentOracle(project, join(project,"receipt.jsonl"), t);
  t.after(() => rmSync(project, {recursive:true,force:true}));
  const checked=spawnSync(process.execPath,["--check",join(directory,"oracle.cjs")],{encoding:"utf8"});
  assert.equal(checked.status,0,checked.stderr);
});
