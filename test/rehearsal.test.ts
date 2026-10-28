/** Real tracker contracts for isolated migration and crash-window recovery. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, truncateSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { PmClient, acquireLock, readSettings, readLocatedItem, resolveItemTypeRegistry, serializeItemDocument } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import extension from "../index.ts";
import { assertIndependentRehearsalSource, parseRehearsalPlan, readRehearsalPlan, rehearseSchemaMigration, RehearsalRefusal, type RehearsalPlan } from "../rehearsal.ts";

const plan: RehearsalPlan = { version: 1, steps: [
  { kind: "rename-field", from: "legacy_ref", to: "external_ref" },
  { kind: "rename-type", from: "Experiment", to: "Investigation" },
] };

/** Allocate a plain directory with real old-schema items, including a terminal row. */
async function fixture(t: TestContext): Promise<{ root: string; source: string; workDir: string }> {
  const root = mkdtempSync(join(tmpdir(), "schema-rehearsal-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "old"), workDir = join(root, "rehearsal");
  // Copy the SDK-generated tracker, including real schema and history, instead
  // of repeating seven setup mutations for every refusal matrix row.
  cpSync(new URL("./fixtures/rehearsal-old", import.meta.url), source, { recursive: true });
  for (const folder of resolveItemTypeRegistry(await readSettings(source)).folders) mkdirSync(join(source, folder), { recursive: true });
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
async function assertSourcePreservedRefusal(options: { source: string; workDir: string }, code?: RehearsalRefusal["code"]): Promise<void> {
  const original = bytes(options.source);
  await assert.rejects(rehearseSchemaMigration({ ...options, plan }), code ? refusal(code) : error => error instanceof RehearsalRefusal);
  assert.equal(bytes(options.source), original);
}

/** Leave one committed core step behind an unadvanced wrapper checkpoint. */
async function interruptedFixture(t: TestContext): Promise<Awaited<ReturnType<typeof fixture>>> {
  const options = await fixture(t);
  await assert.rejects(rehearseSchemaMigration({ ...options, plan, afterStep() { throw new Error("interrupted"); } }), refusal("unavailable"));
  return options;
}

/** Activate the real registered command for SDK boundary assertions. */
async function rehearsalCommand() {
  const activation = await createExtensionTestHarness(extension, { name: "pm-ts-starter", capabilities: ["commands", "renderers", "hooks", "schema", "importers", "search", "parser", "preflight", "services"] });
  return activation.activation.commands.handlers.find(entry => entry.command === "ts-starter rehearse-schema")!;
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
  for (const patch of [{ version: 2 }, { identity: "different" }, { completed: -1 }, { completed: 99 }, { completed: 0.5 }, { affected: -1 }, { affected: "two" }, { items: -1 }, { items: "two" }, { observed_step: -1 }]) {
    writeFileSync(checkpoint, JSON.stringify({ ...JSON.parse(raw), ...patch }));
    await assert.rejects(rehearseSchemaMigration({ ...options, plan }), refusal("source_changed"));
  }
  for (const tracker_fingerprint of [undefined, "edited"]) {
    writeFileSync(checkpoint, JSON.stringify({ ...JSON.parse(raw), tracker_fingerprint }));
    await assert.rejects(rehearseSchemaMigration({ ...options, plan }), refusal("invalid_data"));
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
  const command = await rehearsalCommand();
  const base = { command: "ts-starter rehearse-schema", args: [], options: {}, global: {}, pm_root: options.root };
  await assert.rejects(async () => command.run(base), (error: unknown) => error instanceof Error && error.name === "PmCliError");
  await assert.rejects(async () => command.run({ ...base, options: null as unknown as typeof base.options }), (error: unknown) => {
    assert.ok(error instanceof Error && "code" in error); assert.equal(error.code, "invalid_plan"); return true;
  });
  await assert.rejects(async () => command.run({ ...base, options: { plan: "missing", "work-dir": options.workDir } }), (error: unknown) => error instanceof Error && error.name === "PmCliError");
  const planFile = join(options.root, "plan.json"); writeFileSync(planFile, JSON.stringify(plan));
  assert.equal((await command.run({ ...base, options: { source: options.source, plan: planFile, workDir: options.workDir } }) as { items: number }).items, 2);
  assert.equal((await command.run({ ...base, options: { source: options.source, plan: planFile, "work-dir": options.workDir } }) as { resumed: boolean }).resumed, true);
  const itemFile = join(options.source, "experiments", "fixture-active.toon");
  const originalItem = readFileSync(itemFile, "utf8");
  writeFileSync(itemFile, originalItem.replace(/legacy_count:.*$/m, "legacy_count: invalid"));
  await assert.rejects(async () => command.run({ ...base, options: { source: options.source, plan: planFile, workDir: join(options.root, "invalid-run") } }), (error: unknown) => {
    assert.ok(error instanceof Error && "code" in error && "context" in error);
    assert.equal(error.code, "invalid_data");
    assert.deepEqual((error.context as { verification_errors: string[] }).verification_errors, ["experiments/fixture-active.toon:legacy_count"]);
    return true;
  });
  writeFileSync(itemFile, originalItem);
  const settingsFile = join(options.source, "settings.json"), originalSettings = readFileSync(settingsFile, "utf8");
  writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(originalSettings), item_format: "invalid" }));
  await assert.rejects(async () => command.run({ ...base, options: { source: options.source, plan: planFile, workDir: join(options.root, "settings-run") } }), (error: unknown) => {
    assert.ok(error instanceof Error && "code" in error); assert.equal(error.code, "invalid_data"); return true;
  });
  writeFileSync(settingsFile, originalSettings);
  writeFileSync(planFile, " ".repeat(65537));
  await assert.rejects(async () => command.run({ ...base, options: { source: options.source, plan: planFile, workDir: join(options.root, "huge-run") } }), (error: unknown) => {
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

/** Compare complete semantic state while allowing SDK mutation timestamps to differ. */
async function finalState(workDir: string): Promise<unknown> {
  const tracker = join(workDir, "tracker");
  const items = (await new PmClient({ pmRoot: tracker, noExtensions: true }).listAllComplete()).items;
  const history = readdirSync(join(tracker, "history")).sort().map(file => [file,
    readFileSync(join(tracker, "history", file), "utf8").trim().split("\n").map(line => String(JSON.parse(line).op).replace(/:rehearsal-.*/, "")),
  ]);
  return { settings: await readSettings(tracker), items: items.map(({ updated_at: _updatedAt, ...item }) => item).sort((a, b) => a.id.localeCompare(b.id)), history };
}

/** Simulate time passing after a terminated writer, touching only scratch leases. */
function expireScratchLeases(workDir: string): void {
  for (const entry of readdirSync(workDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".lock")) continue;
    const file = join(entry.parentPath, entry.name), lease = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...lease, created_at: "2000-01-01T00:00:00.000Z" }));
  }
}

test("crash matrix resumes every SDK commit and wrapper checkpoint boundary or proves its initialization remedy", async t => {
  const baseline = await fixture(t);
  const client = new PmClient({ pmRoot: baseline.source, noExtensions: true, author: "fixture-agent" });
  await client.schemaAddStatus("reviewing", { role: ["active"] });
  await client.update("fixture-active", { status: "reviewing" });
  const crashPlan: RehearsalPlan = { version: 1, steps: [...plan.steps, { kind: "remap-status", from: "reviewing", to: "verified" }] };
  const expectedReceipt = await rehearseSchemaMigration({ ...baseline, plan: crashPlan });
  const expected = await finalState(baseline.workDir);
  const boundaries = ["copy:middle",
    ...Array.from({ length: 1 + 2 * crashPlan.steps.length }, (_, index) => [`checkpoint:${index}:before`, `checkpoint:${index}:after`]).flat(),
    ...["sdk", "commit"].flatMap(kind => crashPlan.steps.flatMap((_, index) => [`${kind}:${index}:before`, `${kind}:${index}:after`])),
  ];
  for (const boundary of boundaries) await t.test(boundary, async t => {
    const options = await fixture(t);
    cpSync(baseline.source, options.source, { recursive: true });
    const original = bytes(options.source);
    const env = { ...process.env, PATH: "", GIT_CEILING_DIRECTORIES: options.root };
    const crashed = spawnSync(process.execPath, [resolve(import.meta.dirname, "helpers/rehearsal-crash-runner.ts"), JSON.stringify({ ...options, plan: crashPlan }), boundary], { cwd: options.root, env, encoding: "utf8", timeout: 30000 });
    assert.equal(crashed.status, 73, crashed.stderr);
    expireScratchLeases(options.workDir);
    let workDir = options.workDir;
    if (["copy:middle", "checkpoint:0:before"].includes(boundary) || boundary.startsWith("commit:")) {
      await assert.rejects(rehearseSchemaMigration({ ...options, plan: crashPlan }), error => {
        assert.ok(error instanceof RehearsalRefusal);
        assert.equal(error.code, "unavailable"); assert.match(error.remedy, /new scratch directory/);
        if (boundary.startsWith("commit:")) assert.match(error.remedy, /SDK replay.*workspace audit/);
        return true;
      });
      workDir = join(options.root, "remedy");
    }
    const receipt = await rehearseSchemaMigration({ ...options, workDir, plan: crashPlan });
    assert.deepEqual([receipt.items, receipt.steps, receipt.affected], [expectedReceipt.items, expectedReceipt.steps, expectedReceipt.affected]);
    assert.deepEqual(await finalState(workDir), expected);
    assert.equal(bytes(options.source), original);
    const stableHistory = bytes(join(workDir, "tracker", "history"));
    await rehearseSchemaMigration({ ...options, workDir, plan: crashPlan });
    assert.equal(bytes(join(workDir, "tracker", "history")), stableHistory);
  });
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

/** Install the built package into a separate real caller tracker without Git. */
async function installedRehearsalFixture(t: TestContext) {
  const options = await fixture(t), host = join(options.root, "caller"), localPackage = join(options.root, "package");
  cpSync(options.source, host, { recursive: true });
  mkdirSync(localPackage);
  for (const file of ["dist", "manifest.json", "package.json"]) cpSync(resolve(import.meta.dirname, "..", file), join(localPackage, file), { recursive: true });
  const cli = resolve(import.meta.dirname, "../node_modules/@unbrained/pm-cli/dist/cli.js");
  const install = spawnSync(process.execPath, [cli, "--pm-path", host, "package", "install", localPackage, "--project"], { cwd: options.root, encoding: "utf8", timeout: 30000 });
  assert.equal(install.status, 0, install.stderr);
  const noGit = join(options.root, "no-git"); mkdirSync(noGit);
  const env = { ...process.env, PATH: noGit, GIT_CEILING_DIRECTORIES: options.root };
  const file = join(options.root, "migration.json"); writeFileSync(file, JSON.stringify(plan));
  const args = [cli, "--pm-path", host, "ts-starter", "rehearse-schema", "--source", options.source, "--plan", file, "--work-dir", options.workDir];
  return { options, host, cli, env, file, args };
}

test("installed CLI emits TOON/JSON and typed field refusals with Git absent", async t => {
  const { options, env, file, args } = await installedRehearsalFixture(t);
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
  assert.ok(concurrent.some(result => result.status === 0), JSON.stringify(concurrent));
  for (const result of concurrent) {
    if (result.status === 0) assert.equal(JSON.parse(result.stdout).affected, 4);
    else { assert.equal(result.status, 2, result.stderr); assert.equal(JSON.parse(result.stderr).code, "unavailable"); }
  }
  assert.equal(bytes(options.source), before);
});

/** Observe host startup scaffolding while requiring refusal before extension writes. */
async function assertStartupSourceRefusal(t: TestContext, mode: "omitted" | "active"): Promise<void> {
  const { options, host, env, args } = await installedRehearsalFixture(t);
  rmSync(join(host, "schema", "workflows.json"));
  const callerSchemaBefore = bytes(join(host, "schema"));
  const before = bytes(options.source), sourceIndex = args.indexOf("--source");
  const invocation = mode === "omitted" ? args.filter((_, index) => index !== sourceIndex && index !== sourceIndex + 1) :
    args.map(value => value === options.source ? host : value);
  const result = spawnSync(process.execPath, [...invocation, "--json"], { cwd: options.root, env, encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 2, result.stderr);
  const error = JSON.parse(result.stderr);
  assert.equal(error.code, mode === "omitted" ? "invalid_plan" : "unsafe_storage");
  assert.match(error.required, /--source/);
  assert.match(error.required, /pm-cli#1568/);
  assert.equal(existsSync(options.workDir), false);
  assert.doesNotMatch(result.stdout + result.stderr, /source_unchanged/);
  // Refused startup preserves caller schema, including deliberately absent files.
  assert.equal(bytes(join(host, "schema")), callerSchemaBefore);
  assert.equal(bytes(options.source), before);
}

test("CLI source isolation refuses omitted source after host startup", async t => {
  await assertStartupSourceRefusal(t, "omitted");
});

test("CLI source isolation refuses the active tracker after host startup", async t => {
  await assertStartupSourceRefusal(t, "active");
});

test("CLI source isolation resolves aliases and refuses containing sources before reading a plan", async t => {
  const options = await fixture(t), command = await rehearsalCommand();
  const sourceAlias = join(options.root, "source-alias"), parentAlias = join(options.root, "parent-alias");
  symlinkSync(options.source, sourceAlias); symlinkSync(options.root, parentAlias);
  for (const [source, active] of [[options.source, options.source], [sourceAlias, options.source], [options.source, sourceAlias], [options.root, options.source], [parentAlias, sourceAlias]]) {
    await assert.rejects(async () => command.run({ command: "ts-starter rehearse-schema", args: [], options: { source, plan: "missing", workDir: options.workDir }, global: {}, pm_root: active }), (error: unknown) => {
      assert.ok(error instanceof Error && "code" in error);
      assert.equal(error.code, "unsafe_storage"); assert.match(error.message, /pm-cli#1568/); return true;
    });
  }
  assert.equal(existsSync(options.workDir), false);
  assert.doesNotThrow(() => assertIndependentRehearsalSource(options.source, options.root));
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
  assert.throws(() => parseRehearsalPlan({ ...plan, extra: "unsupported" }), refusal("invalid_plan"));
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

test("trimmed schema escapes refuse before SDK reads on new and resumed runs", async t => {
  for (const resumed of [false, true]) for (const section of ["fields", "types", "statuses", "workflows"]) await t.test(`${section}, resumed=${resumed}`, async t => {
    const options = await fixture(t);
    if (resumed) await rehearseSchemaMigration({ ...options, plan });
    const tracker = resumed ? join(options.workDir, "tracker") : options.source;
    const file = join(tracker, "settings.json"), settings = JSON.parse(readFileSync(file, "utf8"));
    settings.schema.files[section] = ` \t../../old/schema/${section}.json\n`;
    writeFileSync(file, JSON.stringify(settings));
    const before = bytes(tracker);
    await assertSourcePreservedRefusal(options, "unsafe_storage");
    assert.equal(bytes(tracker), before);
    if (!resumed) assert.equal(existsSync(options.workDir), false);
  });
});

test("canonical local schema paths with surrounding whitespace remain isolated", async t => {
  const options = await fixture(t), file = join(options.source, "settings.json");
  const settings = JSON.parse(readFileSync(file, "utf8"));
  for (const section of Object.keys(settings.schema.files)) settings.schema.files[section] = ` ${settings.schema.files[section]} `;
  writeFileSync(file, JSON.stringify(settings));
  const before = bytes(options.source);
  assert.equal((await rehearseSchemaMigration({ ...options, plan })).ok, true);
  assert.equal((await rehearseSchemaMigration({ ...options, plan })).resumed, true);
  assert.equal(bytes(options.source), before);
});

test("declared workflow overlays and type transitions survive a real rehearsal", async t => {
  for (const representation of ["workflows", "direct"]) await t.test(representation, async t => {
    const options = await fixture(t), settingsFile = join(options.source, "settings.json");
    const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
    settings.schema.type_workflows = [{ type: "Task", allowed_transitions: [["open", "closed"]] }];
    writeFileSync(settingsFile, JSON.stringify(settings));
    const workflow = { open_status: "in_progress" };
    writeFileSync(join(options.source, "schema", "workflows.json"), JSON.stringify(representation === "direct" ? workflow : { workflows: workflow, type_workflows: [{ type: "Experiment", allowed_transitions: [["open", "closed"]] }] }));
    assert.equal((await rehearseSchemaMigration({ ...options, plan })).ok, true);
  });
});

test("input audit refuses partial and silently normalized schema contracts", async t => {
  const cases: [string, unknown][] = [
    ["fields", { fields: [{ key: "legacy_ref", type: "string", required: "yes" }] }],
    ["fields", { fields: [{ key: "legacy_ref", type: "string", commands: ["erase"] }] }],
    ["fields", { fields: [{ key: "legacy_ref", type: "string", unsupported: true }] }],
    ["fields", { fields: [null] }],
    ["fields", { fields: [3] }],
    ["fields", { fields: [{ key: "legacy_ref", type: "string", value_schema: { type: "typo" } }] }],
    ["statuses", { statuses: [{}] }],
    ["statuses", { statuses: [{ id: "open", roles: ["unknown"] }] }],
    ["statuses", { statuses: [{ id: "open", aliases: [4] }] }],
    ["types", { definitions: [{ name: "" }] }],
    ["types", { item_types: { definitions: [{ name: "Experiment", folder: "experiments", extra: true }] } }],
    ["workflows", { workflow: { open_status: "invalid status" } }],
    ["workflows", { workflow: { open_status: "missing" } }],
    ["workflows", { workflow: { unsupported: "open" } }],
    ["workflows", { workflow: { constructor: "open" } }],
    ["workflows", { workflow: {}, type_workflows: [{ type: "Experiment", allowed_transitions: [["open"]] }] }],
    ["workflows", { workflow: {}, type_workflows: [{ type: "Missing", allowed_transitions: [] }] }],
    ["workflows", { workflow: {}, type_workflows: [{ type: "__proto__", allowed_transitions: [] }] }],
    ["workflows", { workflow: {}, type_workflows: [{ type: "Experiment", allowed_transitions: [["open", "missing"]] }] }],
    ["workflows", { workflow: {}, type_workflows: {} }],
    ["workflows", { workflow: {}, type_workflows: [null] }],
    ["workflows", { workflow: {}, type_workflows: [{}] }],
    ["types", { definitions: [{ name: "Experiment", folder: "experiments", default_status: "missing" }] }],
  ];
  for (const [section, data] of cases) await t.test(`${section}: ${JSON.stringify(data)}`, async t => {
    const options = await fixture(t);
    writeFileSync(join(options.source, "schema", `${section}.json`), JSON.stringify(data));
    // SDK may throw while interpreting malformed definitions; both boundaries
    // must produce typed refusals, never a successful partial corpus.
    await assertSourcePreservedRefusal(options);
  });
  for (const section of ["fields", "types", "statuses", "workflows"]) await t.test(`missing ${section}`, async t => {
    const options = await fixture(t);
    rmSync(join(options.source, "schema", `${section}.json`));
    await assertSourcePreservedRefusal(options, "invalid_data");
  });
  for (const patch of [{ version: 2 }, { files: { unsupported: "schema/fields.json" } }, { unsupported: true }]) await t.test(JSON.stringify(patch), async t => {
    const options = await fixture(t), file = join(options.source, "settings.json");
    const settings = JSON.parse(readFileSync(file, "utf8")); Object.assign(settings.schema, patch);
    writeFileSync(file, JSON.stringify(settings));
    await assertSourcePreservedRefusal(options, "invalid_data");
  });
  for (const patch of [{ version: 2 }, { unsupported: true }, { constructor: "unsupported" }]) await t.test(`settings: ${JSON.stringify(patch)}`, async t => {
    const options = await fixture(t), file = join(options.source, "settings.json");
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...patch }));
    await assertSourcePreservedRefusal(options, "invalid_data");
  });
});

test("input audit rejects primitive plans, empty locations and malformed CLI values", async t => {
  for (const value of [1, "x", true, [], { version: 1, steps: [4] }, { version: 1, steps: ["step"] }, { version: 1, steps: [false] }, { ...plan, unsupported: true }])
    assert.throws(() => parseRehearsalPlan(value), refusal("invalid_plan"));
  const options = await fixture(t);
  for (const patch of [{ source: "" }, { source: 4 }, { workDir: " " }, { afterStep: 4 }]) await assert.rejects(rehearseSchemaMigration({ ...options, plan, ...patch } as Parameters<typeof rehearseSchemaMigration>[0]), refusal("invalid_plan"));
  const planFile = join(options.root, "valid-plan.json"); writeFileSync(planFile, JSON.stringify(plan));
  const validOptions = { source: options.source, plan: planFile, workDir: options.workDir };
  for (const value of ["", " ", 4, null]) {
    const command = await rehearsalCommand();
    await assert.rejects(async () => command.run({ command: "ts-starter rehearse-schema", args: [], options: { ...validOptions, source: value }, global: {}, pm_root: options.source }), (error: unknown) => error instanceof Error && "code" in error && error.code === "invalid_plan");
  }
  const command = await rehearsalCommand();
  for (const patch of [{ args: ["extra"] }, { options: { ...validOptions, dryRun: true } }, { options: { ...validOptions, plan: " " } }, { options: { ...validOptions, workDir: "" } }, { options: { ...validOptions, workDir: 4 } }]) {
    await assert.rejects(async () => command.run({ command: "ts-starter rehearse-schema", args: [], options: validOptions, global: {}, pm_root: options.source, ...patch }), (error: unknown) => error instanceof Error && "code" in error && error.code === "invalid_plan");
  }
  assert.equal(existsSync(options.workDir), false);
});

test("input audit refuses edited scratch bytes and fabricated completed checkpoints", async t => {
  for (const mutation of ["item", "settings", "schema", "completed", "affected", "journal"]) await t.test(mutation, async t => {
    const options = await interruptedFixture(t), tracker = join(options.workDir, "tracker");
    if (mutation === "completed" || mutation === "affected") {
      const file = join(options.workDir, "rehearsal.json"), state = JSON.parse(readFileSync(file, "utf8"));
      state[mutation] = mutation === "completed" ? plan.steps.length : 99;
      writeFileSync(file, JSON.stringify(state));
    } else if (mutation === "journal") {
      const folder = join(tracker, "transactions", "sdk"), file = join(folder, readdirSync(folder)[0]);
      const journal = JSON.parse(readFileSync(file, "utf8")); journal.status = "prepared"; writeFileSync(file, JSON.stringify(journal));
      const checkpoint = join(options.workDir, "rehearsal.json"), state = JSON.parse(readFileSync(checkpoint, "utf8"));
      state.completed = 1; state.affected = 2; writeFileSync(checkpoint, JSON.stringify(state));
    } else {
      const file = join(tracker, mutation === "item" ? "experiments/fixture-active.toon" : mutation === "schema" ? "schema/fields.json" : "settings.json");
      writeFileSync(file, readFileSync(file, "utf8") + "\n");
    }
    await assertSourcePreservedRefusal(options);
  });
});

test("input audit validates history consumed by migrations and isolates ambient configuration", async t => {
  for (const file of ["fixture-active.jsonl", "_workspace.jsonl"]) for (const corruption of ["syntax", "chain"]) await t.test(`${file}: ${corruption}`, async t => {
    const options = await fixture(t), target = join(options.source, "history", file);
    const entries = readFileSync(target, "utf8").trim().split("\n").map(line => JSON.parse(line));
    if (corruption === "chain") entries[0].after_hash = "0".repeat(64);
    writeFileSync(target, corruption === "syntax" ? "{\n" : entries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
    await assertSourcePreservedRefusal(options);
  });
  const options = await fixture(t);
  writeFileSync(join(options.source, "settings.json"), "{}");
  const script = `import { rehearseSchemaMigration } from ${JSON.stringify(new URL("../rehearsal.ts", import.meta.url).href)}; try { console.log(JSON.stringify(await rehearseSchemaMigration(JSON.parse(process.argv[1])))); } catch (error) { console.log(JSON.stringify({ code: error.code, name: error.constructor.name })); process.exitCode = 2; }`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, JSON.stringify({ ...options, plan })], {
    cwd: options.root, encoding: "utf8", env: { ...process.env, PM_PATH: "missing", PM_GLOBAL_PATH: "missing", PM_AUTHOR: "ambient-agent", HOME: options.root, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
  assert.equal(result.status, 2, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { code: "invalid_data", name: "RehearsalRefusal" });
});

test("input audit bounds schema mappings and malformed resume artifacts", async t => {
  for (const value of ["", " ", 4, null]) await t.test(`schema path: ${JSON.stringify(value)}`, async t => {
    const options = await fixture(t), file = join(options.source, "settings.json");
    const settings = JSON.parse(readFileSync(file, "utf8")); settings.schema.files.fields = value;
    writeFileSync(file, JSON.stringify(settings));
    await assertSourcePreservedRefusal(options, "unsafe_storage");
  });
  for (const raw of ["{", "null", "[]", '{"completed":9007199254740992}']) await t.test(`checkpoint: ${raw}`, async t => {
    const options = await interruptedFixture(t);
    writeFileSync(join(options.workDir, "rehearsal.json"), raw);
    await assertSourcePreservedRefusal(options);
  });
  for (const count of [-1, "two"]) await t.test(`core count: ${count}`, async t => {
    const options = await fixture(t); await rehearseSchemaMigration({ ...options, plan });
    const dir = join(options.workDir, "tracker", "transactions", "schema");
    const file = join(dir, readdirSync(dir)[0]), stored = JSON.parse(readFileSync(file, "utf8"));
    stored.plan.affected_item_count = count; writeFileSync(file, JSON.stringify(stored));
    await assertSourcePreservedRefusal(options, "invalid_data");
  });
  for (const patch of ["schema_version", "migration_id", "request", "transactionId", "status", "stepIds", "retire-source", "completedStepIds"]) await t.test(`core evidence: ${patch}`, async t => {
    const options = await fixture(t); await rehearseSchemaMigration({ ...options, plan });
    const tracker = join(options.workDir, "tracker"), schema = ["schema_version", "migration_id", "request"].includes(patch);
    const dir = join(tracker, "transactions", schema ? "schema" : "sdk"), file = join(dir, readdirSync(dir)[0]);
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (patch === "migration_id") data.plan.migration_id = "wrong";
    else if (patch === "request") data.plan.request.to = "Different";
    else if (patch === "retire-source") data.stepIds = [];
    else if (patch === "status") data.status = "prepared";
    else delete data[patch];
    writeFileSync(file, JSON.stringify(data));
    await assertSourcePreservedRefusal(options, "invalid_data");
  });
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
