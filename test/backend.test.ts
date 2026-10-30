/** Behavioral contracts use real trackers and untrusted transport envelopes. */
import assert from "node:assert/strict";
import { accessSync, constants, mkdtempSync, rmSync, mkdirSync, readFileSync, statSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, sep } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import test, { type TestContext } from "node:test";
import { PmClient } from "@unbrained/pm-cli/sdk";
import { createDirectoryAdapter, createRemoteAdapter, parseCliInvocation } from "../backend.ts";
import { buildBackendProjectFiles, generateBackendProject, readBackendSource } from "../backend-project.ts";
import extension from "../index.ts";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";

/** Allocate a plain tracker with no enclosing Git discovery. */
function scratch(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "typed-backend-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Initialize real all-status data with isolated extension loading. */
async function tracker(root: string): Promise<PmClient> {
  const client = new PmClient({ pmRoot: join(root, "tracker"), noExtensions: true, author: "contract-agent" });
  await client.init("contract", { defaults: true, mergeFence: false, agentGuidance: "skip" });
  await client.create({ title: "Active fixture", description: "real fixture", type: "Task", priority: 2 });
  await client.create({ title: "Terminal fixture", description: "real fixture", type: "Task", priority: 2,
    status: "closed", closeReason: "Contract fixture completed" });
  return client;
}

/** Ceiling for one generated-project install, build, or contract command. */
const GENERATED_COMMAND_TIMEOUT_MS = 300_000;

/** Fields the Bun lookup needs; a full spawn result is assignable to this shape. */
interface ToolLookup {
  /** Exit status, or null when the lookup timed out before exiting. */
  readonly status: number | null;
  /** Standard output, null when the spawn produced none. */
  readonly stdout: string | null;
  /** Spawn error, present for a missing binary or a timeout. */
  readonly error?: Error;
}

/**
 * Run one generated-project command and stop it if it exceeds the ceiling.
 *
 * A stalled registry must fail the test instead of blocking the runner. A
 * non-zero exit is returned unchanged so an install failure cannot become a skip.
 *
 * @param command - Executable path, already resolved by the caller.
 * @param args - Arguments forwarded without a shell.
 * @param options - Working directory, environment, and optional shorter ceiling.
 * @returns The spawn result, including a timeout error when the ceiling is hit.
 */
function runBoundedCommand(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): SpawnSyncReturns<string> {
  return spawnSync(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: options.timeoutMs ?? GENERATED_COMMAND_TIMEOUT_MS,
  });
}

/**
 * Render a bounded-command failure without assuming the streams exist.
 *
 * @param run - Spawn result that may have timed out before producing output.
 * @returns Error message plus whatever the child wrote.
 */
function commandText(run: SpawnSyncReturns<string>): string {
  return `${run.error?.message ?? ""}\n${run.stdout ?? ""}${run.stderr ?? ""}`;
}

/**
 * Locate Bun for the generated consumer checks.
 *
 * Bun is a prerequisite of this contract, including outside CI. A timed-out or
 * empty lookup fails closed; it is not treated as an absent optional tool.
 *
 * @param env - Environment that may override the lookup with `BUN_EXE`.
 * @param lookup - Injected search, defaulting to the first `bun` entry on PATH (JSON-encoded).
 * @returns The Bun executable path.
 */
function requireBunExecutable(
  env: NodeJS.ProcessEnv,
  lookup: (env: NodeJS.ProcessEnv) => ToolLookup = lookupBun,
): string {
  const override = env.BUN_EXE;
  if (override) return override;
  const found = lookup(env);
  if ((found.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
    throw new Error("Timed out while locating Bun. Refusing to skip consumer checks.");
  }
  let path: unknown;
  try { path = JSON.parse(found.stdout ?? "null"); } catch { path = undefined; }
  if (found.status !== 0 || found.error || typeof path !== "string" || !path) throw new Error("Bun is required for generated consumer checks. Install Bun or set BUN_EXE.");
  return path;
}

/**
 * Find the first `bun` entry on PATH, like `which bun`, without starting Bun: no preload or wrapper output can corrupt
 * the result, and a wrapper script on PATH (which may export settings before exec) stays the selected executable.
 *
 * @param env - Environment whose PATH (and PATHEXT on Windows) is searched.
 * @returns The JSON-encoded path with status 0, or status 1 and a null stdout when no executable entry exists.
 */
function lookupBun(env: NodeJS.ProcessEnv): ToolLookup {
  const names = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean).map((extension) => `bun${extension.toLowerCase()}`) : ["bun"];
  for (const directory of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const name of names) {
      // Append without normalizing: `link/../bin` must keep resolving through the link, as the shell would.
      const candidate = /[\\/]$/.test(directory) ? directory + name : directory + sep + name;
      try {
        accessSync(candidate, constants.X_OK);
        if (statSync(candidate).isFile()) return { status: 0, stdout: JSON.stringify(candidate) };
      } catch { /* not here; keep searching PATH */ }
    }
  }
  return { status: 1, stdout: null };
}

test("a leading option is a flag, not the generated CLI tracker path", () => {
  assert.deepEqual(parseCliInvocation(["inspect", "--json"]), {
    operation: "inspect", tracker: ".agents/pm", flags: ["--json"],
  });
  assert.deepEqual(parseCliInvocation(["delete", "custom-tracker", "--json"]), {
    operation: "delete", tracker: "custom-tracker", flags: ["--json"],
  });
  assert.deepEqual(parseCliInvocation([]), {
    operation: "inspect", tracker: ".agents/pm", flags: [],
  });
  assert.deepEqual(parseCliInvocation(["create"]), {
    operation: "create", tracker: ".agents/pm", flags: [],
  });
  const cli = buildBackendProjectFiles("pm-contract")["src/cli.ts"];
  assert.match(cli, /parseCliInvocation\(process\.argv\.slice\(2\)\)/);
  assert.doesNotMatch(cli, /tracker = "\.agents\/pm"/);
});

test("generated project commands stop at their ceiling and keep failed exits", () => {
  assert.equal(GENERATED_COMMAND_TIMEOUT_MS, 300_000);
  const timedOut = runBoundedCommand(process.execPath, ["-e", "setTimeout(() => {}, 2000)"], { timeoutMs: 200 });
  assert.equal((timedOut.error as NodeJS.ErrnoException | undefined)?.code, "ETIMEDOUT");
  assert.notEqual(timedOut.status, 0);
  const failed = runBoundedCommand(process.execPath, ["-e", "process.exit(9)"], { timeoutMs: 5_000 });
  assert.equal(failed.status, 9);
  assert.equal(failed.error, undefined);
  const ok = runBoundedCommand(process.execPath, ["-e", "process.stdout.write('ok')"], { timeoutMs: 5_000 });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, "ok");
});

test("Bun lookup failures stay prerequisites instead of skipped coverage", () => {
  assert.equal(requireBunExecutable({ BUN_EXE: "  /opt/bun  " }, () => {
    throw new Error("override must not search");
  }), "  /opt/bun  ");
  assert.throws(() => requireBunExecutable({}, () => ({ status: 1, stdout: null })), /Bun is required for generated consumer checks/);
  assert.throws(() => requireBunExecutable({}, () => ({ status: 1, stdout: "  " })), /Bun is required for generated consumer checks/);
  assert.throws(() => requireBunExecutable({}, () => ({ status: 1, stdout: "/invalid/bun" })), /Bun is required for generated consumer checks/);
  assert.throws(() => requireBunExecutable({}, () => ({ status: 0, stdout: "/invalid/bun", error: new Error("lookup failed") })), /Bun is required for generated consumer checks/);
  assert.equal(requireBunExecutable({}, () => ({ status: 0, stdout: JSON.stringify("/usr/bin/bun\n") })), "/usr/bin/bun\n");
  const timedOut = Object.assign(new Error("spawnSync bun ETIMEDOUT"), { code: "ETIMEDOUT" });
  assert.throws(() => requireBunExecutable({}, () => ({ status: null, stdout: "", error: timedOut })), /Timed out while locating Bun/);
});

test("directory and remote inspect real terminal-inclusive receipts and never invoke writes", async (t) => {
  const root = scratch(t);
  const client = await tracker(root);
  const envelope = await client.listAllComplete();
  let reads = 0;
  const remote = createRemoteAdapter({ async listAllComplete() { reads++; return envelope; } });
  for (const adapter of [createDirectoryAdapter(join(root, "tracker")), remote]) {
    const result = await adapter.execute("inspect");
    assert.equal(result.ok, true);
    if (!result.ok) assert.fail("inspection refused");
    assert.equal(result.item_count, 2);
    assert.equal(result.complete_list.terminal_items_included, true);
    assert.equal(result.complete_list.unique_item_id_count, 2);
    for (const operation of ["create", "update", "delete"] as const) {
      const refused = await adapter.execute(operation);
      assert.equal(refused.ok, false);
      if (refused.ok) assert.fail("mutation must refuse");
      assert.equal(refused.code, "unsupported_operation");
      assert.equal(refused.operation, operation);
      assert.ok(refused.remedy);
    }
    assert.ok(JSON.stringify(result).length < 500, "agent output must stay compact");
  }
  assert.equal(reads, 1, "unsupported operations must not invoke the provider");
  assert.equal((await client.listAllComplete()).items.length, 2);
});

test("missing source receipts and inconsistent counts fail closed with evidence", async (t) => {
  const envelope = await (await tracker(scratch(t))).listAllComplete();
  for (const field of ["read_output", "omission_receipt"]) {
    const broken = { ...envelope };
    Reflect.deleteProperty(broken, field);
    const result = await createRemoteAdapter({ async listAllComplete() { return broken; } }).execute("inspect");
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("receipt removal must refuse");
    assert.equal(result.code, "invalid_receipt");
    assert.ok(result.evidence?.findings.length);
  }
  const result = await createRemoteAdapter({ async listAllComplete() { return { ...envelope, count: 999 }; } }).execute("inspect");
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("wrong count must refuse");
  assert.equal(result.code, "invalid_receipt");
});

test("backend failures produce secret-free recovery receipts", async () => {
  const adapter = createRemoteAdapter({ async listAllComplete() { throw new Error("credential-secret"); } });
  const result = await adapter.execute("inspect");
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("transport failure must refuse");
  assert.equal(result.code, "backend_unavailable");
  assert.doesNotMatch(JSON.stringify(result), /credential-secret/);
});

test("generator validates names and refuses existing or unwritable targets without overwrite", (t) => {
  const root = scratch(t);
  for (const name of ["bad", "pm-X", "pm-../escape", "pm-" + "a".repeat(100)]) {
    assert.deepEqual(generateBackendProject(join(root, "new"), name), {
      ok: false, code: "invalid_name", remedy: "Choose a lowercase npm name such as pm-my-backend (at most 100 characters).",
    });
  }
  const existing = join(root, "existing");
  mkdirSync(existing);
  writeFileSync(join(existing, "sentinel"), "retain");
  for (const target of [existing, join(root, "absent", "child")]) {
    const result = generateBackendProject(target, "pm-contract");
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("unavailable target must refuse");
    assert.equal(result.code, "target_unavailable");
  }
  assert.equal(readFileSync(join(existing, "sentinel"), "utf8"), "retain");
  assert.equal(readBackendSource(new URL("../dist/backend-project.js", import.meta.url).href),
    readBackendSource(new URL("../backend-project.ts", import.meta.url).href));
  assert.ok(buildBackendProjectFiles("pm-contract")["src/backend.ts"].includes("certifyCompleteListResult"));
});

test("registered CLI generates projects and returns actionable expected refusals", async (t) => {
  const harness = await createExtensionTestHarness(extension, { name: "pm-ts-starter", capabilities: ["commands", "renderers", "hooks", "schema", "importers", "search", "parser", "preflight", "services"] });
  const root = scratch(t);
  for (const options of [{}, { target: join(root, "a") }, { name: "pm-contract" }, { target: root, name: "pm-contract" }]) {
    await assert.rejects(harness.runCommand({ command: "ts-starter backend-project", options }), { name: "PmCliError", exitCode: 2 });
  }
  const result = await harness.runCommand({ command: "ts-starter backend-project", options: { target: join(root, "generated"), name: "pm-contract" } });
  assert.equal((result.result as { ok: boolean }).ok, true);
});

test("generated npm and Bun projects build and execute contracts with Git absent", async (t) => {
  const root = scratch(t);
  const project = join(root, "project");
  assert.equal(generateBackendProject(project, "pm-contract").ok, true);
  const bunPath = requireBunExecutable(process.env);
  const bin = join(root, "bin");
  mkdirSync(bin);
  for (const [name, path] of [["node", process.execPath], ["npm", join(dirname(process.execPath), "npm")], ["bun", bunPath]] as const) {
    assert.ok(path, name + " must be available");
    symlinkSync(path, join(bin, name));
  }
  symlinkSync("/bin/sh", join(bin, "sh"));
  const { NODE_TEST_CONTEXT: _context, NODE_TEST_WORKER_ID: _worker, ...cleanEnv } = process.env;
  const env = { ...cleanEnv, PATH: bin, GIT_CEILING_DIRECTORIES: dirname(root) };
  for (const [command, args] of [["npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"]], ["bun", ["install", "--ignore-scripts", "--no-save"]], ["npm", ["run", "build"]], ["npm", ["test"]], ["bun", ["run", "build"]], ["bun", ["run", "test:bun"]]] as const) {
    const run = runBoundedCommand(join(bin, command), args, { cwd: project, env });
    assert.equal(run.status, 0, commandText(run));
    if ((args as readonly string[]).includes("test")) assert.match(commandText(run), /tests 1/);
    if ((args as readonly string[]).includes("test:bun")) assert.match(commandText(run), /1 pass/);
  }
  const client = await tracker(root);
  const cli = runBoundedCommand(process.execPath, ["dist/cli.js", "inspect", join(root, "tracker"), "--json"], { cwd: project, env });
  assert.equal(cli.status, 0, commandText(cli));
  assert.equal(JSON.parse(cli.stdout).item_count, 2);
  mkdirSync(join(project, ".agents"));
  symlinkSync(join(root, "tracker"), join(project, ".agents", "pm"));
  const defaultJson = runBoundedCommand(process.execPath, ["dist/cli.js", "inspect", "--json"], { cwd: project, env });
  assert.equal(defaultJson.status, 0, commandText(defaultJson));
  assert.equal(JSON.parse(defaultJson.stdout).ok, true);
  assert.equal(JSON.parse(defaultJson.stdout).item_count, 2);
  for (const args of [["delete", join(root, "tracker"), "--json"], ["unknown"], ["inspect", "tracker", "--bad"], ["inspect", "--bad"]]) {
    const refusal = runBoundedCommand(process.execPath, ["dist/cli.js", ...args], { cwd: project, env });
    assert.equal(refusal.status, 2, commandText(refusal));
    assert.equal(JSON.parse(refusal.stdout).ok, false);
  }
  const toon = runBoundedCommand(process.execPath, ["dist/cli.js", "inspect", join(root, "tracker")], { cwd: project, env });
  assert.equal(toon.status, 0, commandText(toon));
  assert.match(toon.stdout, /item_count: 2/);
  assert.equal((await client.listAllComplete()).items.length, 2);
  const hostCheck = runBoundedCommand(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import extension from "./dist/index.js";
    import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
    import { decode } from "@toon-format/toon";
    const harness = await createExtensionTestHarness(extension, { name: "pm-contract", capabilities: ["commands"] });
    assert.deepEqual(harness.activation.failed, []);
    const result = await harness.runCommand({ command: "pm-contract inspect", pmRoot: process.env.CONTRACT_TRACKER });
    assert.equal(result.result.item_count, 2);
    assert.equal(decode(process.env.CONTRACT_TOON).item_count, 2);
    await assert.rejects(harness.runCommand({ command: "pm-contract inspect", pmRoot: "missing-tracker" }), { name: "PmCliError", exitCode: 2 });
  `], { cwd: project, env: { ...env, CONTRACT_TRACKER: join(root, "tracker"), CONTRACT_TOON: toon.stdout } });
  assert.equal(hostCheck.status, 0, commandText(hostCheck));
  // Behavioral revert: removing only adapter certification must break the emitted contract suite.
  const source = join(project, "src/backend.ts");
  writeFileSync(source, readFileSync(source, "utf8").replace("certifyCompleteListResult(await reader.listAllComplete())", "(await reader.listAllComplete() as Awaited<ReturnType<PmClient['listAllComplete']>>)") );
  const reverted = runBoundedCommand(process.execPath, ["--test", "test/backend.test.ts"], { cwd: project, env });
  assert.notEqual(reverted.status, 0, "contract must fail when receipt certification is removed");
  assert.match(commandText(reverted), /must be load-bearing/);
});

test("the Bun lookup returns the PATH entry itself, so a wrapper on PATH stays selected", (t) => {
  const root = mkdtempSync(join(tmpdir(), "bun-wrapper-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const empty = join(root, "empty"), wrapped = join(root, "wrapped");
  mkdirSync(empty); mkdirSync(wrapped);
  const wrapper = join(wrapped, process.platform === "win32" ? "bun.cmd" : "bun");
  writeFileSync(wrapper, "#!/bin/sh\nexport HTTPS_PROXY=http://proxy.example.invalid\nexec /nonexistent/real-bun \"$@\"\n", { mode: 0o755 });
  assert.equal(requireBunExecutable({ PATH: [empty, wrapped].join(delimiter), PATHEXT: ".CMD" }), wrapper);
  assert.throws(() => requireBunExecutable({ PATH: empty }), /Bun is required for generated consumer checks/);
});

test("the Bun lookup keeps a PATH entry that walks through a symlink unnormalized", (t) => {
  const root = mkdtempSync(join(tmpdir(), "bun-path-link-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "real", "sub"), { recursive: true }); mkdirSync(join(root, "real", "bin"));
  const name = process.platform === "win32" ? "bun.cmd" : "bun";
  writeFileSync(join(root, "real", "bin", name), "#!/bin/sh\n", { mode: 0o755 });
  symlinkSync(join(root, "real", "sub"), join(root, "link"), "junction");
  // `link/../bin` is real/bin through the link; lexical normalization would turn it into root/bin, which does not exist.
  const entry = `${root}/link/../bin`;
  assert.equal(requireBunExecutable({ PATH: entry, PATHEXT: ".CMD" }), `${entry}${process.platform === "win32" ? "\\" : "/"}${name}`);
});
