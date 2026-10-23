/** Real tracker contracts for isolated migration and crash-window recovery. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, truncateSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { PmClient, acquireLock, readSettings, readLocatedItem, serializeItemDocument } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import extension from "../index.ts";
import { parseRehearsalPlan, readRehearsalPlan, rehearseSchemaMigration, RehearsalRefusal, type RehearsalPlan } from "../rehearsal.ts";

const plan: RehearsalPlan = { version: 1, steps: [
  { kind: "rename-field", from: "legacy_ref", to: "external_ref" },
  { kind: "rename-type", from: "Experiment", to: "Investigation" },
] };

/** Allocate a plain directory with real old-schema items, including a terminal row. */
async function fixture(t: TestContext): Promise<{ root: string; source: string; workDir: string }> {
  const root = mkdtempSync(join(tmpdir(), "schema-rehearsal-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "old"), workDir = join(root, "rehearsal");
  const client = new PmClient({ pmRoot: source, noExtensions: true, author: "fixture-agent" });
  await client.init("fixture", { defaults: true, mergeFence: false, agentGuidance: "skip" });
  await client.schemaAddField("legacy_ref", { type: "string" });
  await client.schemaAddField("legacy_count", { type: "number" });
  await client.schemaAddType("Experiment", { folder: "experiments" });
  await client.run("create", { options: { id: "fixture-active", title: "Evaluate indexing", description: "Old custom schema fixture", type: "Experiment", legacyRef: "RFC-17", legacyCount: 17, priority: 2 } });
  await client.run("create", { options: { id: "fixture-done", title: "Measure cold reads", description: "Terminal custom schema fixture", type: "Experiment", legacyRef: "RFC-18", legacyCount: 18, priority: 2, status: "closed", closeReason: "Measurement complete" } });
  return { root, source, workDir };
}

/** Include every physical source file so even runtime writes are detected. */
function bytes(root: string): string {
  return JSON.stringify(readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
    .map(entry => { const file = join(entry.parentPath, entry.name); return [file.slice(root.length), readFileSync(file).toString("base64")]; }).sort());
}

/** Check stable refusal codes without relying on platform-specific error text. */
function refusal(code: RehearsalRefusal["code"]): (error: unknown) => boolean {
  return error => error instanceof RehearsalRefusal && error.code === code && error.remedy.length > 10;
}

/** Exercise actual simultaneous CLI processes without serializing their startup. */
async function cliProcess(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, timeout: 30000 });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.on("error", reject);
    child.on("close", status => resolve({ status, stdout, stderr }));
  });
}

/** Assert both refusal and byte preservation for an unsafe storage attempt. */
async function assertSourcePreservedRefusal(options: { source: string; workDir: string }, code: RehearsalRefusal["code"]): Promise<void> {
  const original = bytes(options.source);
  await assert.rejects(rehearseSchemaMigration({ ...options, plan }), refusal(code));
  assert.equal(bytes(options.source), original);
}

/** Leave one committed core step behind an unadvanced wrapper checkpoint. */
async function interruptedFixture(t: TestContext): Promise<Awaited<ReturnType<typeof fixture>>> {
  const options = await fixture(t);
  await assert.rejects(rehearseSchemaMigration({ ...options, plan, afterStep() { throw new Error("interrupted"); } }), refusal("unavailable"));
  return options;
}

test("old/new custom tracker fixtures migrate once, retain terminal rows and preserve every source byte", async t => {
  const options = await fixture(t), before = bytes(options.source);
  const first = await rehearseSchemaMigration({ ...options, plan });
  assert.equal(first.items, 2); assert.equal(first.affected, 4); assert.equal(first.resumed, false);
  const client = new PmClient({ pmRoot: join(options.workDir, "tracker"), noExtensions: true });
  const items = (await client.listAllComplete()).items;
  assert.deepEqual(items.map(item => [item.id, item.type, item.external_ref]).sort(), [
    ["fixture-active", "Investigation", "RFC-17"], ["fixture-done", "Investigation", "RFC-18"],
  ]);
  assert.equal(items.find(item => item.id === "fixture-done")?.status, "closed");
  const history = bytes(join(options.workDir, "tracker", "history"));
  const second = await rehearseSchemaMigration({ ...options, plan });
  assert.equal(second.resumed, true); assert.equal(second.affected, 4);
  assert.equal(bytes(join(options.workDir, "tracker", "history")), history);
  assert.equal(bytes(options.source), before);
});

test("interruption after a core commit but before wrapper checkpoint resumes exactly once", async t => {
  const options = await fixture(t), before = bytes(options.source);
  await assert.rejects(rehearseSchemaMigration({ ...options, plan, afterStep() { throw new Error("interrupted"); } }), refusal("unavailable"));
  const history = bytes(join(options.workDir, "tracker", "history"));
  const result = await rehearseSchemaMigration({ ...options, plan });
  assert.equal(result.affected, 4); assert.equal(result.resumed, true);
  assert.equal(bytes(options.source), before);
  assert.notEqual(bytes(join(options.workDir, "tracker", "history")), history);
  const stable = bytes(join(options.workDir, "tracker", "history"));
  await rehearseSchemaMigration({ ...options, plan });
  assert.equal(bytes(join(options.workDir, "tracker", "history")), stable);
  for (const name of ["fixture-active", "fixture-done"]) {
    const entries = readFileSync(join(options.workDir, "tracker", "history", `${name}.jsonl`), "utf8");
    assert.equal(entries.split("\n").filter(line => line.includes('"op":"schema_rename_field"')).length, 1);
    assert.equal(entries.split("\n").filter(line => line.includes('"op":"schema_rename_type"')).length, 1);
  }
});

test("invalid old data reports the exact custom field without values or source writes", async t => {
  const options = await fixture(t);
  const file = join(options.source, "experiments", "fixture-active.toon");
  writeFileSync(file, readFileSync(file, "utf8").replace(/legacy_count:.*$/m, "legacy_count: invalid"));
  const before = bytes(options.source);
  await assert.rejects(rehearseSchemaMigration({ ...options, plan }), error => {
    assert.ok(error instanceof RehearsalRefusal); assert.equal(error.code, "invalid_data");
    assert.deepEqual(error.diagnostics, [{ file: join("experiments", "fixture-active.toon"), field: "legacy_count" }]);
    assert.equal(error.diagnostic_count, 1); return true;
  });
  assert.equal(bytes(options.source), before);
});

test("malformed plans and unsupported operations refuse before scratch creation", async t => {
  for (const value of [null, {}, { version: 2, steps: [] }, { version: 1, steps: [] }, { version: 1, steps: Array(33).fill(plan.steps[0]) },
    { version: 1, steps: [null] }, { version: 1, steps: [{ kind: "erase", from: "a", to: "b" }] },
    { version: 1, steps: [{ kind: "rename-type", from: "a", to: "A" }] },
    { version: 1, steps: [{ kind: "rename-type", from: "a", to: "b", type: "Task" }] },
    { version: 1, steps: [{ kind: "rename-field", from: "a", to: "b", type: 5 }] },
    { version: 1, steps: [{ kind: "rename-field", from: "a", to: 1 }] },
    { version: 1, steps: [{ kind: "rename-field", from: 1, to: "b" }] },
    { version: 1, steps: [{ kind: "rename-field", from: "../a", to: "b" }] },
    { version: 1, steps: [{ kind: "rename-field", from: "a", to: "../b" }] }]) assert.throws(() => parseRehearsalPlan(value), refusal("invalid_plan"));
  assert.deepEqual(parseRehearsalPlan(plan), plan);
  const options = await fixture(t);
  await assert.rejects(rehearseSchemaMigration({ ...options, plan: {} as RehearsalPlan }), refusal("invalid_plan"));
  assert.equal(existsSync(options.workDir), false);
});

test("overlap, Git workspaces, symlinks and hardlinks fail closed", async t => {
  const options = await fixture(t);
  for (const workDir of [options.source, join(options.source, "nested"), options.root, resolve(import.meta.dirname, "scratch")])
    await assert.rejects(rehearseSchemaMigration({ ...options, workDir, plan }), refusal("unsafe_storage"));
  symlinkSync(options.source, join(options.root, "alias"));
  await assert.rejects(rehearseSchemaMigration({ ...options, source: join(options.root, "alias"), plan }), refusal("unsafe_storage"));
  symlinkSync(join(options.source, "settings.json"), join(options.source, "linked.json"));
  await assert.rejects(rehearseSchemaMigration({ ...options, plan }), refusal("unsafe_storage"));
  rmSync(join(options.source, "linked.json"));
  linkSync(join(options.source, "settings.json"), join(options.source, "linked.json"));
  await assert.rejects(rehearseSchemaMigration({ ...options, plan }), refusal("unsafe_storage"));
});

test("external schema paths, changed sources and incompatible checkpoints refuse", async t => {
  const options = await fixture(t);
  const settingsPath = join(options.source, "settings.json"), original = readFileSync(settingsPath, "utf8");
  const settings = JSON.parse(original) as { schema: { files: { fields: string } } };
  settings.schema.files.fields = join(options.root, "fields.json");
  writeFileSync(settingsPath, JSON.stringify(settings));
  await assert.rejects(rehearseSchemaMigration({ ...options, plan }), refusal("unsafe_storage"));
  settings.schema.files.fields = "../fields.json"; writeFileSync(settingsPath, JSON.stringify(settings));
  await assert.rejects(rehearseSchemaMigration({ ...options, plan }), refusal("unsafe_storage"));
  writeFileSync(settingsPath, original);
  await rehearseSchemaMigration({ ...options, plan });
  writeFileSync(join(options.source, "new.txt"), "drift");
  await assert.rejects(rehearseSchemaMigration({ ...options, plan }), refusal("source_changed"));
  rmSync(join(options.source, "new.txt"));
  const checkpoint = join(options.workDir, "rehearsal.json"), raw = readFileSync(checkpoint, "utf8");
  for (const patch of [{ version: 2 }, { identity: "different" }, { completed: -1 }, { completed: 99 }, { affected: -1 }, { items: -1 }]) {
    writeFileSync(checkpoint, JSON.stringify({ ...JSON.parse(raw), ...patch }));
    await assert.rejects(rehearseSchemaMigration({ ...options, plan }), refusal("source_changed"));
  }
  writeFileSync(checkpoint, raw);
  await assert.rejects(rehearseSchemaMigration({ ...options, plan: { version: 1, steps: [plan.steps[0]] } }), refusal("source_changed"));
});

test("source drift during execution is detected and source SDK writes never occur", async t => {
  const options = await fixture(t);
  await assert.rejects(rehearseSchemaMigration({ ...options, plan, afterStep() { writeFileSync(join(options.source, "concurrent.txt"), "external edit"); } }), refusal("source_changed"));
});

test("SDK status mapping and type-scoped field renames work without Git", async t => {
  const options = await fixture(t);
  const client = new PmClient({ pmRoot: options.source, noExtensions: true, author: "fixture-agent" });
  await client.schemaAddStatus("reviewing", { role: ["active"] });
  await client.update("fixture-active", { status: "reviewing" });
  const result = await rehearseSchemaMigration({ ...options, plan: { version: 1, steps: [
    { kind: "rename-field", from: "legacy_ref", to: "external_ref", type: "Experiment" },
    { kind: "remap-status", from: "reviewing", to: "verified" },
  ] } });
  assert.equal(result.items, 2); assert.equal(result.affected, 3);
});

test("storage, SDK conflicts and lock contention produce sanitized typed remedies", async t => {
  const options = await fixture(t);
  await assert.rejects(rehearseSchemaMigration({ ...options, source: join(options.root, "missing"), plan }), refusal("unavailable"));
  await assert.rejects(rehearseSchemaMigration({ ...options, plan: { version: 1, steps: [{ kind: "rename-field", from: "absent", to: "other" }] } }), refusal("unavailable"));
  rmSync(options.workDir, { recursive: true }); mkdirSync(options.workDir);
  const release = await acquireLock(options.workDir, "rehearsal", 300, "other-owner", false, false, 0);
  try { await assert.rejects(rehearseSchemaMigration({ ...options, plan }), refusal("unavailable")); }
  finally { await release(); }
  await assert.rejects(rehearseSchemaMigration({ ...options, plan }), refusal("unavailable"));
});

test("diagnostics are bounded and syntax errors identify the document", async t => {
  const options = await fixture(t);
  writeFileSync(join(options.source, "experiments", "fixture-active.toon"), "this is not an item");
  await assert.rejects(rehearseSchemaMigration({ ...options, plan }), error => {
    assert.ok(error instanceof RehearsalRefusal); assert.equal(error.diagnostics[0].field, "document"); return true;
  });
  const refusal = new RehearsalRefusal("invalid_data", "repair", Array.from({ length: 25 }, () => ({ file: "item.toon", field: "legacy_ref" })));
  assert.equal(refusal.diagnostics.length, 20); assert.equal(refusal.diagnostic_count, 25);
});

test("registered command validates input and delegates with native agent output", async t => {
  const options = await fixture(t);
  const harness = await createExtensionTestHarness(extension, { name: "pm-ts-starter", capabilities: ["commands", "renderers", "hooks", "schema", "importers", "search", "parser", "preflight", "services"] });
  const command = harness.activation.commands.handlers.find(entry => entry.command === "ts-starter rehearse-schema")!;
  const base = { command: "ts-starter rehearse-schema", args: [], options: {}, global: {}, pm_root: options.source };
  await assert.rejects(async () => command.run(base), (error: unknown) => error instanceof Error && error.name === "PmCliError");
  await assert.rejects(async () => command.run({ ...base, options: null as unknown as typeof base.options }), (error: unknown) => {
    assert.ok(error instanceof Error && "code" in error); assert.equal(error.code, "invalid_plan"); return true;
  });
  await assert.rejects(async () => command.run({ ...base, options: { plan: "missing", "work-dir": options.workDir } }), (error: unknown) => error instanceof Error && error.name === "PmCliError");
  const planFile = join(options.root, "plan.json"); writeFileSync(planFile, JSON.stringify(plan));
  assert.equal((await command.run({ ...base, options: { plan: planFile, workDir: options.workDir } }) as { items: number }).items, 2);
  assert.equal((await command.run({ ...base, pm_root: "unused", options: { source: options.source, plan: planFile, "work-dir": options.workDir } }) as { resumed: boolean }).resumed, true);
  const itemFile = join(options.source, "experiments", "fixture-active.toon");
  const originalItem = readFileSync(itemFile, "utf8");
  writeFileSync(itemFile, originalItem.replace(/legacy_count:.*$/m, "legacy_count: invalid"));
  await assert.rejects(async () => command.run({ ...base, options: { plan: planFile, workDir: join(options.root, "invalid-run") } }), (error: unknown) => {
    assert.ok(error instanceof Error && "code" in error && "context" in error);
    assert.equal(error.code, "invalid_data");
    assert.deepEqual((error.context as { verification_errors: string[] }).verification_errors, ["experiments/fixture-active.toon:legacy_count"]);
    return true;
  });
  writeFileSync(itemFile, originalItem);
  const settingsFile = join(options.source, "settings.json"), originalSettings = readFileSync(settingsFile, "utf8");
  writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(originalSettings), item_format: "invalid" }));
  await assert.rejects(async () => command.run({ ...base, options: { plan: planFile, workDir: join(options.root, "settings-run") } }), (error: unknown) => {
    assert.ok(error instanceof Error && "code" in error); assert.equal(error.code, "invalid_data"); return true;
  });
  writeFileSync(settingsFile, originalSettings);
  writeFileSync(planFile, " ".repeat(65537));
  await assert.rejects(async () => command.run({ ...base, options: { plan: planFile, workDir: join(options.root, "huge-run") } }), (error: unknown) => {
    assert.ok(error instanceof Error && "code" in error); assert.equal(error.code, "invalid_plan"); return true;
  });
});

test("a terminated process resumes with no Git executable or enclosing repository", async t => {
  const options = await fixture(t), before = bytes(options.source);
  const emptyPath = join(options.root, "empty-bin"); mkdirSync(emptyPath);
  const moduleUrl = new URL("../rehearsal.ts", import.meta.url).href;
  const script = join(options.root, "interrupt.mjs");
  writeFileSync(script, `import { rehearseSchemaMigration } from ${JSON.stringify(moduleUrl)};\nawait rehearseSchemaMigration({ ...JSON.parse(process.argv[2]), afterStep() { process.exit(73); } });`);
  const env = { ...process.env, PATH: emptyPath, GIT_CEILING_DIRECTORIES: options.root };
  const interrupted = spawnSync(process.execPath, [script, JSON.stringify({ ...options, plan })], { env, cwd: options.root, encoding: "utf8" });
  assert.equal(interrupted.status, 73, interrupted.stderr);
  writeFileSync(script, `import { rehearseSchemaMigration } from ${JSON.stringify(moduleUrl)};\nconsole.log(JSON.stringify(await rehearseSchemaMigration(JSON.parse(process.argv[2]))));`);
  const lockFile = join(options.workDir, "locks", "rehearsal.lock");
  const lease = JSON.parse(readFileSync(lockFile, "utf8"));
  writeFileSync(lockFile, JSON.stringify({ ...lease, created_at: "2000-01-01T00:00:00.000Z" }));
  const resumed = spawnSync(process.execPath, [script, JSON.stringify({ ...options, plan })], { env, cwd: options.root, encoding: "utf8" });
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(JSON.parse(resumed.stdout).affected, 4);
  assert.equal(bytes(options.source), before);
});

test("oversized snapshots and unreadable physical item directories refuse safely", async t => {
  const options = await fixture(t), large = join(options.source, "large.dat");
  writeFileSync(large, ""); truncateSync(large, 257 * 1024 * 1024);
  await assert.rejects(rehearseSchemaMigration({ ...options, plan }), refusal("unsafe_storage"));
  rmSync(large);
  mkdirSync(join(options.source, "experiments", "directory.toon"));
  await assert.rejects(rehearseSchemaMigration({ ...options, plan }), refusal("unsafe_storage"));
});

test("default schema settings, absent folders and non-item files remain compatible", async t => {
  const options = await fixture(t), file = join(options.source, "settings.json");
  const settings = JSON.parse(readFileSync(file, "utf8")); delete settings.schema;
  writeFileSync(file, JSON.stringify(settings));
  rmSync(join(options.source, "chores"), { recursive: true });
  writeFileSync(join(options.source, "experiments", "notes.txt"), "not an item");
  assert.equal((await rehearseSchemaMigration({ ...options, plan })).items, 2);
});

test("corpus deletion in scratch is detected before reporting success", async t => {
  const options = await fixture(t);
  await assert.rejects(rehearseSchemaMigration({ ...options, plan, afterStep(index) {
    if (index === 1) rmSync(join(options.workDir, "tracker", "experiments", "fixture-done.toon"));
  } }), refusal("invalid_data"));
});

test("JSON Markdown physical trackers receive the same field/type rehearsal", async t => {
  const options = await fixture(t);
  const settings = await readSettings(options.source);
  for (const id of ["fixture-active", "fixture-done"]) {
    const itemPath = join(options.source, "experiments", `${id}.toon`);
    const item = await readLocatedItem({ id, type: "Experiment", itemPath, item_format: "toon" }, { schema: settings.schema });
    writeFileSync(itemPath.replace(/\.toon$/, ".md"), serializeItemDocument(item.document, { format: "json_markdown", schema: settings.schema }));
    rmSync(itemPath);
  }
  const file = join(options.source, "settings.json"), raw = JSON.parse(readFileSync(file, "utf8")); raw.item_format = "json_markdown";
  writeFileSync(file, JSON.stringify(raw));
  assert.equal((await rehearseSchemaMigration({ ...options, plan })).items, 2);
});

test("checked-in old/new trackers demonstrate lossless fixture evolution", async t => {
  const options = await fixture(t);
  rmSync(options.source, { recursive: true });
  cpSync(new URL("./fixtures/rehearsal-old", import.meta.url), options.source, { recursive: true });
  const result = await rehearseSchemaMigration({ ...options, plan });
  assert.equal(result.affected, 4);
  const actualRoot = join(options.workDir, "tracker"), expectedRoot = new URL("./fixtures/rehearsal-new", import.meta.url).pathname;
  const actual = await readSettings(actualRoot), expected = await readSettings(expectedRoot);
  for (const id of ["fixture-active", "fixture-done"]) {
    const documents = await Promise.all([[actualRoot, actual], [expectedRoot, expected]].map(async ([root, settings]) => {
      const item = await readLocatedItem({ id, type: "Investigation", itemPath: join(root as string, "experiments", `${id}.toon`), item_format: "toon" }, { schema: (settings as typeof actual).schema });
      const { updated_at: _updatedAt, ...metadata } = item.document.metadata;
      return { metadata, body: item.document.body };
    }));
    assert.deepEqual(documents[0], documents[1]);
  }
});

test("resuming refuses a scratch schema redirected outside its private tracker", async t => {
  const options = await fixture(t);
  await rehearseSchemaMigration({ ...options, plan });
  const file = join(options.workDir, "tracker", "settings.json"), raw = JSON.parse(readFileSync(file, "utf8"));
  raw.schema.files.fields = join(options.source, "schema", "fields.json");
  writeFileSync(file, JSON.stringify(raw));
  await assertSourcePreservedRefusal(options, "unsafe_storage");
});

test("installed CLI emits TOON/JSON and typed field refusals with Git absent", async t => {
  const options = await fixture(t), host = join(options.root, "caller"), localPackage = join(options.root, "package");
  await new PmClient({ pmRoot: host, noExtensions: true, author: "fixture-agent" }).init("caller", { defaults: true, mergeFence: false, agentGuidance: "skip" });
  mkdirSync(localPackage);
  for (const file of ["dist", "manifest.json", "package.json"]) cpSync(resolve(import.meta.dirname, "..", file), join(localPackage, file), { recursive: true });
  const cli = resolve(import.meta.dirname, "../node_modules/@unbrained/pm-cli/dist/cli.js");
  const install = spawnSync(process.execPath, [cli, "--pm-path", host, "package", "install", localPackage, "--project"], { cwd: options.root, encoding: "utf8", timeout: 30000 });
  assert.equal(install.status, 0, install.stderr);
  const noGit = join(options.root, "no-git"); mkdirSync(noGit);
  const env = { ...process.env, PATH: noGit, GIT_CEILING_DIRECTORIES: options.root };
  const file = join(options.root, "migration.json"); writeFileSync(file, JSON.stringify(plan));
  const args = [cli, "--pm-path", host, "ts-starter", "rehearse-schema", "--source", options.source, "--plan", file, "--work-dir", options.workDir];
  const before = bytes(options.source);
  const first = spawnSync(process.execPath, [...args, "--json"], { cwd: options.root, env, encoding: "utf8", timeout: 30000 });
  assert.equal(first.status, 0, first.stderr); assert.equal(JSON.parse(first.stdout).affected, 4);
  const replay = spawnSync(process.execPath, args, { cwd: options.root, env, encoding: "utf8", timeout: 30000 });
  assert.equal(replay.status, 0, replay.stderr); assert.match(replay.stdout, /resumed: true/);
  assert.equal(bytes(options.source), before);
  const item = join(options.source, "experiments", "fixture-active.toon");
  const originalItem = readFileSync(item, "utf8");
  writeFileSync(item, originalItem.replace(/legacy_count:.*$/m, "legacy_count: invalid"));
  const invalidArgs = args.map(value => value === options.workDir ? join(options.root, "invalid") : value);
  const invalid = spawnSync(process.execPath, [...invalidArgs, "--json"], { cwd: options.root, env, encoding: "utf8", timeout: 30000 });
  assert.equal(invalid.status, 2); const error = JSON.parse(invalid.stderr);
  assert.equal(error.code, "invalid_data");
  assert.deepEqual(error.verification_errors, ["experiments/fixture-active.toon:legacy_count"]);
  writeFileSync(item, originalItem);
  for (const [file, replacement] of [
    ["settings.json", JSON.stringify({ ...JSON.parse(readFileSync(join(options.source, "settings.json"), "utf8")), item_format: "invalid" })],
    ["schema/types.json", '{"definitions":[]}'],
    ["schema/fields.json", '{"fields":[{}]}'],
  ]) {
    const target = join(options.source, file), original = readFileSync(target, "utf8");
    writeFileSync(target, replacement);
    const snapshot = bytes(options.source);
    const result = spawnSync(process.execPath, [...invalidArgs.map(value => value === join(options.root, "invalid") ? join(options.root, `invalid-${file.replaceAll("/", "-")}`) : value), "--json"], { cwd: options.root, env, encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 2, result.stderr); assert.equal(JSON.parse(result.stderr).code, "invalid_data");
    assert.equal(bytes(options.source), snapshot);
    writeFileSync(target, original);
  }
  writeFileSync(file, " ".repeat(65537));
  const huge = spawnSync(process.execPath, [...args, "--json"], { cwd: options.root, env, encoding: "utf8", timeout: 30000 });
  assert.equal(huge.status, 2); assert.equal(JSON.parse(huge.stderr).code, "invalid_plan");
  writeFileSync(file, JSON.stringify(plan));
  const alias = join(options.root, "plan-alias"); symlinkSync(file, alias);
  const linked = spawnSync(process.execPath, [...args.map(value => value === file ? alias : value), "--json"], { cwd: options.root, env, encoding: "utf8", timeout: 30000 });
  assert.equal(linked.status, 2); assert.equal(JSON.parse(linked.stderr).code, "invalid_plan");
  const parallel = args.map(value => value === options.workDir ? join(options.root, "parallel") : value);
  const concurrent = await Promise.all(Array.from({ length: 2 }, () => cliProcess([...parallel, "--json"], options.root, env)));
  assert.ok(concurrent.some(result => result.status === 0));
  for (const result of concurrent) {
    if (result.status === 0) assert.equal(JSON.parse(result.stdout).affected, 4);
    else { assert.equal(result.status, 2, result.stderr); assert.equal(JSON.parse(result.stderr).code, "unavailable"); }
  }
  assert.equal(bytes(options.source), before);
});

test("scratch lock-directory aliases refuse before acquiring any source lock", async t => {
  const options = await fixture(t);
  mkdirSync(options.workDir);
  symlinkSync(join(options.source, "locks"), join(options.workDir, "locks"));
  await assertSourcePreservedRefusal(options, "unsafe_storage");
});

test("invalid settings cannot report zero-item success with unmigrated custom items", async t => {
  const options = await fixture(t), file = join(options.source, "settings.json");
  const settings = JSON.parse(readFileSync(file, "utf8")); settings.item_format = "invalid";
  writeFileSync(file, JSON.stringify(settings));
  await assertSourcePreservedRefusal(options, "invalid_data");
  assert.equal(existsSync(join(options.workDir, "rehearsal.json")), false);
  for (const id of ["fixture-active", "fixture-done"]) {
    assert.match(readFileSync(join(options.workDir, "tracker", "experiments", `${id}.toon`), "utf8"), /legacy_ref:/);
  }
});

test("malformed and partial schemas never silently narrow corpus validation", async t => {
  const cases = [
    ["settings.json", "{}"],
    ["schema/types.json", "{"],
    ["schema/types.json", '{"definitions":[]}'],
    ["schema/statuses.json", "null"],
    ["schema/workflows.json", "[]"],
    ["schema/fields.json", '{"fields":{}}'],
    ["schema/fields.json", '{"fields":[{"key":"legacy_ref","type":"string"},{}]}'],
    ["schema/fields.json", '{"fields":[{"key":"legacy_ref"}]}'],
    ["schema/fields.json", '{"fields":[{"key":"legacy_ref","type":"string"},{"key":"legacy_count","type":"typo"}]}'],
  ];
  for (const [file, raw] of cases) await t.test(`${file}: ${raw}`, async t => {
    const options = await fixture(t);
    writeFileSync(join(options.source, file), raw);
    await assertSourcePreservedRefusal(options, "invalid_data");
    assert.equal(existsSync(join(options.workDir, "rehearsal.json")), false);
  });
});

test("all SDK field schema representations validate item values before migration", async t => {
  for (const format of ["array", "definitions", "inline"]) await t.test(format, async t => {
    const options = await fixture(t), file = join(options.source, "schema", "fields.json");
    const fields = JSON.parse(readFileSync(file, "utf8")).fields as { key: string; type?: string }[];
    writeFileSync(file, JSON.stringify(format === "array" ? fields : format === "definitions" ? { definitions: fields } : { fields: [] }));
    if (format === "inline") {
      const file = join(options.source, "settings.json"), settings = JSON.parse(readFileSync(file, "utf8"));
      settings.schema.fields = fields; writeFileSync(file, JSON.stringify(settings));
    }
    const item = join(options.source, "experiments", "fixture-active.toon");
    writeFileSync(item, readFileSync(item, "utf8").replace(/legacy_count:.*$/m, "legacy_count: invalid"));
    await assertSourcePreservedRefusal(options, "invalid_data");
  });
});

test("resuming validates scratch settings before another core operation", async t => {
  const options = await interruptedFixture(t);
  const tracker = join(options.workDir, "tracker"), file = join(tracker, "settings.json");
  const settings = JSON.parse(readFileSync(file, "utf8")); settings.item_format = "invalid";
  writeFileSync(file, JSON.stringify(settings));
  const before = bytes(tracker);
  await assertSourcePreservedRefusal(options, "invalid_data");
  assert.equal(bytes(tracker), before);
});

test("unregistered and nested physical items cannot disappear from a certified count", async t => {
  for (const folder of ["unregistered", "experiments/nested"]) await t.test(folder, async t => {
    const options = await fixture(t);
    mkdirSync(join(options.source, folder), { recursive: true });
    cpSync(join(options.source, "experiments", "fixture-active.toon"), join(options.source, folder, "hidden.toon"));
    await assertSourcePreservedRefusal(options, "invalid_data");
  });
});

test("hidden physical item files cannot bypass the SDK corpus count", async t => {
  const options = await fixture(t);
  cpSync(join(options.source, "experiments", "fixture-active.toon"), join(options.source, "experiments", ".hidden.toon"));
  await assertSourcePreservedRefusal(options, "invalid_data");
  assert.equal(existsSync(join(options.workDir, "rehearsal.json")), false);
});

test("resuming a smaller scratch corpus refuses before replaying core journals", async t => {
  const options = await interruptedFixture(t);
  const tracker = join(options.workDir, "tracker");
  rmSync(join(tracker, "experiments", "fixture-done.toon"));
  const before = bytes(join(tracker, "history"));
  await assertSourcePreservedRefusal(options, "invalid_data");
  assert.ok(bytes(join(tracker, "history")) === before, "Refusal must precede core history writes");
});

test("parallel callers share one scratch lease and migrate each item exactly once", async t => {
  const options = await fixture(t), before = bytes(options.source);
  const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => rehearseSchemaMigration({ ...options, plan })));
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  for (const outcome of outcomes) if (outcome.status === "rejected") assert.ok(refusal("unavailable")(outcome.reason));
  assert.equal((await rehearseSchemaMigration({ ...options, plan })).affected, 4);
  assert.equal(bytes(options.source), before);
  for (const id of ["fixture-active", "fixture-done"]) {
    const history = readFileSync(join(options.workDir, "tracker", "history", `${id}.jsonl`), "utf8");
    assert.equal(history.split("\n").filter(line => line.includes('"op":"schema_rename_field"')).length, 1);
    assert.equal(history.split("\n").filter(line => line.includes('"op":"schema_rename_type"')).length, 1);
  }
});

test("initializing scratch directories refuse before competing for the creator lease", async t => {
  const options = await fixture(t);
  mkdirSync(options.workDir);
  await assertSourcePreservedRefusal(options, "unavailable");
  assert.deepEqual(readdirSync(options.workDir), [], "A competing caller must not create lock storage before the first checkpoint");
});

test("plan entry points bound names, optional scope, payload and file storage", async t => {
  const options = await fixture(t), file = join(options.root, "plan.json");
  for (const step of [
    { ...plan.steps[0], type: "../Experiment" }, { ...plan.steps[0], type: "x".repeat(65) },
    { ...plan.steps[0], extra: "unexpected" }, { ...plan.steps[0], from: "x".repeat(65) },
  ]) assert.throws(() => parseRehearsalPlan({ version: 1, steps: [step] }), refusal("invalid_plan"));
  assert.deepEqual(parseRehearsalPlan({ ...plan, extra: "x".repeat(1000000) }), plan);
  writeFileSync(file, JSON.stringify(plan));
  assert.deepEqual(readRehearsalPlan(file), plan);
  for (const value of ["{", "{}", " ".repeat(65537) + JSON.stringify(plan)]) {
    writeFileSync(file, value); assert.throws(() => readRehearsalPlan(file), refusal("invalid_plan"));
  }
  assert.throws(() => readRehearsalPlan(options.root), refusal("invalid_plan"));
  assert.throws(() => readRehearsalPlan(join(options.root, "missing")), refusal("invalid_plan"));
  writeFileSync(file, JSON.stringify(plan));
  const alias = join(options.root, "alias"); symlinkSync(file, alias);
  assert.throws(() => readRehearsalPlan(alias), refusal("invalid_plan"));
  rmSync(alias); symlinkSync(options.root, alias);
  assert.throws(() => readRehearsalPlan(join(alias, "plan.json")), refusal("unsafe_storage"));
  rmSync(alias); linkSync(file, alias);
  assert.throws(() => readRehearsalPlan(file), refusal("invalid_plan"));
  assert.equal(existsSync(options.workDir), false);
});

test("snapshot traversal bounds include directories as well as file bytes", async t => {
  const options = await fixture(t);
  mkdirSync(join(options.source, ...Array(65).fill("nested")), { recursive: true });
  await assertSourcePreservedRefusal(options, "unsafe_storage");
  rmSync(join(options.source, "nested"), { recursive: true });
  for (let index = 0; index < 20001; index++) mkdirSync(join(options.source, `empty-${index}`));
  await assertSourcePreservedRefusal(options, "unsafe_storage");
});

test("plan reads use the same normalized path checked for aliases", async t => {
  const options = await fixture(t), nested = join(options.root, "other", "child");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(options.root, "other", "plan.json"), JSON.stringify(plan));
  writeFileSync(join(options.root, "plan.json"), "{}");
  const alias = join(options.root, "alias"); symlinkSync(nested, alias);
  await assert.rejects(async () => readRehearsalPlan(`${alias}/../plan.json`), refusal("invalid_plan"));
});

test("custom item folders cannot redirect SDK reads or migrations outside item storage", async t => {
  for (const folder of ["../../old/experiments", "experiments/nested", "schema", "history", "extensions"]) await t.test(folder, async t => {
    const options = await fixture(t), file = join(options.source, "schema", "types.json");
    const types = JSON.parse(readFileSync(file, "utf8"));
    types.definitions.push({ name: "Redirected", folder });
    writeFileSync(file, JSON.stringify(types));
    await assertSourcePreservedRefusal(options, folder.startsWith("..") ? "unavailable" : "unsafe_storage");
    assert.equal(existsSync(join(options.workDir, "rehearsal.json")), false);
  });
});
