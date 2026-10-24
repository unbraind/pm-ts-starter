/** Real compiler, isolated tracker and emitted-package compatibility contracts. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, lstatSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import test, { after, type TestContext } from "node:test";
import { PmClient } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import extension from "../index.ts";
import { checkSdkContracts, parseSdkConsumerExamples, resolveSdkContractCompiler, SDK_CONSUMER_EXAMPLES, SdkContractRefusal, type SdkContractOptions } from "../sdk-contracts.ts";

const repo = resolve(import.meta.dirname, "..");
const sdk = join(repo, "node_modules/@unbrained/pm-cli");
const pinned = JSON.parse(readFileSync(join(sdk, "package.json"), "utf8")).version as string;
const target = { root: sdk, version: pinned };
const compiler = join(repo, "node_modules/typescript/bin/tsc");
const minimumVersion = (JSON.parse(readFileSync(join(repo, "manifest.json"), "utf8")) as { pm_min_version: string }).pm_min_version;
const currentVersion = "2026.10.24";

/** Reuse independently installed registry endpoints across the integration cases. */
let published: { root: string; minimum: string; current: string } | undefined;
after(() => { if (published) rmSync(published.root, { recursive: true, force: true }); });
/** Provision exact published endpoints without changing the repository dependency pins. */
function publishedSdks(): { root: string; minimum: string; current: string } {
  if (published) return published;
  const root = mkdtempSync(join(tmpdir(), "sdk-published-test-"));
  published = { root, minimum: join(root, "minimum/node_modules/@unbrained/pm-cli"), current: join(root, "current/node_modules/@unbrained/pm-cli") };
  for (const [name, version] of [["minimum", minimumVersion], ["current", currentVersion]]) {
    const install = spawnSync("npm", ["install", "--prefix", join(root, name!), "--ignore-scripts", "--no-package-lock", "--no-audit", "--no-fund", `@unbrained/pm-cli@${version}`], { encoding: "utf8", timeout: 120000 });
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
  for (const body of ["process.exit(3)", "process.kill(process.pid, 'SIGTERM')", "process.stdout.write('x'.repeat(300000))"]) {
    const bad = join(root, "compiler.cjs"); writeFileSync(bad, body);
    await assert.rejects(checkSdkContracts({ minimum: target, current: target, compiler: bad }), refuses("compiler_unavailable"));
  }
  await assert.rejects(checkSdkContracts({ minimum: target, current: target, compiler: join(root, "missing") }), refuses("compiler_unavailable"));
  assert.throws(() => resolveSdkContractCompiler(join(root, "consumer.cjs")), refuses("compiler_unavailable"));
  assert.equal(resolveSdkContractCompiler(), compiler);
});

test("diagnostic output is bounded and never echoes source text or machine paths", async () => {
  const result = await checkSdkContracts({ minimum: target, current: target, examples: [{ id: "removed", source: Array.from({ length: 8 }, (_, index) => `const privateSecret${index}: string = ${index};`).join("\n") }] });
  assert.equal(result.failed, 2);
  assert.ok(result.rows.every(row => row.diagnostic_count === 8 && row.codes.length === 3));
  assert.doesNotMatch(JSON.stringify(result), /privateSecret|consumer\.ts|sdk-consumer-test/);
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
  assert.equal((await handler.run({ ...base, options: { "minimum-sdk": minimum, "current-sdk": sdk, "current-version": pinned, compiler } }) as { checks: number }).checks, 4);
  for (const patch of [{}, { ...options, minimumSdk: true }, { ...options, currentSdk: true }, { ...options, currentVersion: true }, { ...options, compiler: true }, { ...options, examples: true }, { ...options, examples: "missing" }, { ...options, examples, unknown: true }]) {
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

test("absolute declaration imports report newer-only SDK APIs as minimum drift", async t => {
  const root = scratch(t), endpoints = publishedSdks();
  // Model an emitted package installed beside the current SDK. Its absolute
  // import must not make the minimum check inherit that newer dependency.
  const project = join(root, "consumer");
  mkdirSync(join(project, "node_modules/@unbrained"), { recursive: true });
  writeFileSync(join(project, "package.json"), JSON.stringify({ private: true, type: "module" }));
  symlinkSync(endpoints.current, join(project, "node_modules/@unbrained/pm-cli"), "junction");
  const declaration = join(project, "contract.d.ts");
  writeFileSync(declaration, 'import * as sdk from "@unbrained/pm-cli/sdk"; export declare const publicSdk: typeof sdk;\n');
  const resolved = createRequire(declaration).resolve("@unbrained/pm-cli/package.json");
  assert.equal(JSON.parse(readFileSync(resolved, "utf8")).version, currentVersion);
  const result = await checkSdkContracts({
    minimum: { root: endpoints.minimum, version: minimumVersion },
    current: { root: endpoints.current, version: currentVersion }, compiler,
    examples: [{ id: "newer-only", source: `import { publicSdk } from ${JSON.stringify(join(project, "contract.js").replaceAll("\\", "/"))};
export const lease = publicSdk.acquireLockLease;` }],
  });
  assert.equal(result.ok, false); assert.equal(result.failed, 1);
  assert.deepEqual(result.rows.map(row => [row.target, row.sdk, row.ok, row.codes]), [
    ["minimum", minimumVersion, false, ["TS2551"]], ["current", currentVersion, true, []],
  ]);
});

test("packed npm and Bun consumers resolve each exact SDK bound and compile emitted contracts without git", async t => {
  const root = scratch(t), endpoints = publishedSdks();
  const pack = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], { cwd: repo, encoding: "utf8", timeout: 30000 });
  assert.equal(pack.status, 0, pack.stderr);
  const tarball = join(root, (JSON.parse(pack.stdout) as { filename: string }[])[0]!.filename);
  const noGit = join(root, "no-git"); mkdirSync(noGit);
  for (const runtime of ["npm", "bun"]) for (const bound of ["minimum", "current"] as const) {
    const version = bound === "minimum" ? minimumVersion : currentVersion;
    const project = join(root, `${runtime}-${bound}`); mkdirSync(project);
    writeFileSync(join(project, "package.json"), JSON.stringify({ private: true, type: "module" }));
    const install = spawnSync(runtime, runtime === "npm"
      ? ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", tarball, `@unbrained/pm-cli@${version}`]
      : ["add", "--ignore-scripts", tarball, `@unbrained/pm-cli@${version}`], { cwd: project, encoding: "utf8", timeout: 120000 });
    assert.equal(install.status, 0, install.stderr);
    const emitted = join(project, "node_modules/pm-ts-starter/dist/index.js").replaceAll("\\", "/");
    const options = { minimum: { root: endpoints.minimum, version: minimumVersion }, current: { root: endpoints.current, version: currentVersion }, compiler,
      examples: [...SDK_CONSUMER_EXAMPLES, { id: "emitted-contract", source: `import { checkSdkContracts, type SdkContractMatrix, type SdkContractOptions } from ${JSON.stringify(emitted)};
export async function consume(options: SdkContractOptions): Promise<SdkContractMatrix> { return checkSdkContracts(options); }` }] };
    const entry = join(project, "consumer.mjs");
    writeFileSync(entry, `import {checkSdkContracts} from 'pm-ts-starter';
import {createRequire} from 'node:module'; import {readFileSync} from 'node:fs';
const require = createRequire(${JSON.stringify(emitted)});
const resolved = require.resolve('@unbrained/pm-cli/package.json');
const sdkVersion = JSON.parse(readFileSync(resolved, 'utf8')).version;
const sdkEntry = require.resolve('@unbrained/pm-cli/sdk');
console.log(JSON.stringify({sdkVersion, resolved, sdkEntry, matrix: await checkSdkContracts(${JSON.stringify(options)})}));`);
    const executable = runtime === "npm" ? process.execPath : spawnSync("bun", ["-e", "console.log(process.execPath)"], { encoding: "utf8" }).stdout.trim();
    const run = spawnSync(executable, [entry], { cwd: project, encoding: "utf8", timeout: 30000, env: { ...process.env, GIT_CEILING_DIRECTORIES: root } });
    assert.equal(run.status, 0, run.stderr);
    const receipt = JSON.parse(run.stdout) as { sdkVersion: string; resolved: string; sdkEntry: string; matrix: { ok: boolean; checks: number; rows: { sdk: string; target: string }[] } };
    assert.equal(receipt.sdkVersion, version, `${runtime} ${bound} resolved SDK`);
    const installedSdk = join(project, "node_modules/@unbrained/pm-cli");
    assert.equal(receipt.resolved, join(installedSdk, "package.json"));
    assert.ok(receipt.sdkEntry.startsWith(`${installedSdk}/`));
    assert.equal(receipt.matrix.ok, true); assert.equal(receipt.matrix.checks, 6);
    assert.deepEqual(receipt.matrix.rows.map(row => row.sdk), [minimumVersion, minimumVersion, minimumVersion, currentVersion, currentVersion, currentVersion]);
    if (runtime === "npm" && bound === "current") {
      const tracker = join(project, "tracker");
      await new PmClient({ pmRoot: tracker, noExtensions: true, author: "fixture" }).init("packed");
      const cli = join(project, "node_modules/@unbrained/pm-cli/dist/cli.js");
      const activated = spawnSync(process.execPath, [cli, "--pm-path", tracker, "package", "install", join(project, "node_modules/pm-ts-starter"), "--project"], { cwd: project, encoding: "utf8", timeout: 30000 });
      assert.equal(activated.status, 0, activated.stderr);
      for (const format of [[], ["--json"]]) {
        const cliRun = spawnSync(process.execPath, [cli, "--pm-path", tracker, "ts-starter", "sdk-contracts", "--minimum-sdk", endpoints.minimum,
          "--current-sdk", endpoints.current, "--current-version", currentVersion, "--compiler", compiler, ...format], {
          cwd: project, encoding: "utf8", timeout: 30000, env: { ...process.env, PATH: noGit, GIT_CEILING_DIRECTORIES: root },
        });
        assert.equal(cliRun.status, 0, cliRun.stderr);
        if (format.length) assert.equal(JSON.parse(cliRun.stdout).checks, 4);
        else assert.match(cliRun.stdout, /checks: 4/);
      }
    }
    // The same packed module also works with PATH containing no git (or other tools).
    const noGitRun = spawnSync(executable, [entry], {
      cwd: project, encoding: "utf8", timeout: 30000, env: { ...process.env, PATH: noGit, GIT_CEILING_DIRECTORIES: root },
    });
    assert.equal(noGitRun.status, 0, noGitRun.stderr);
    assert.equal(JSON.parse(noGitRun.stdout).matrix.ok, true);
  }
});
