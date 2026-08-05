import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { before } from "node:test";

import extension, {
  pmExpectedError,
  isPmCliExpectedError,
  runPm,
  blueprint,
  derivedCapabilities,
  manifestMirror,
  synthesizedManifest,
  readRootJson,
} from "../index.ts";

import {
  createExtensionTestHarness,
  assertExtensionManifestMatchesBlueprint,
  assertExtensionBlueprint,
  assertProjectProfile,
  type ExtensionTestHarness,
} from "@unbrained/pm-cli/sdk/testing";

import {
  lintExtensionBlueprint,
  deriveExtensionCapabilities,
  collectUsedExtensionCapabilities,
  describeExtensionBlueprint,
  describeProjectProfile,
  lintProjectProfile,
} from "@unbrained/pm-cli/sdk/authoring";

import { demoProfile } from "../index.ts";

import type {
  ItemDocument,
  ItemMetadata,
  PmSettings,
  RendererOverrideContext,
} from "@unbrained/pm-cli/sdk";

/**
 * Stand-in for the host-supplied `PmSettings` carried on search-provider and
 * vector-store-adapter contexts.
 *
 * `PmSettings` is the ~23-field nested workspace-configuration record the host
 * reads from `settings.json`. The SDK exports it as a type only — there is no
 * public factory or test fixture — so a fully-formed literal would be ~60 lines
 * that break on every settings addition upstream.
 *
 * Neither the provider nor the adapter under test reads any settings field, so
 * the single cast is confined to this fixture rather than smuggled into each
 * call site with `as never`. That distinction matters: a per-call-site cast also
 * disables checking of the fields the code *does* read, which is precisely how
 * the vector-store adapter previously drifted to a fabricated `{id, text}` /
 * `{query}` contract while still compiling. Every contract field these
 * operations actually consume — `documents`, `query`, `points`, `vector`,
 * `ids`, `limit` — stays fully type-checked.
 */
const HOST_SETTINGS = {} as PmSettings;

/**
 * Build the minimal {@link ItemDocument} the prefix search provider consumes.
 *
 * The provider reads only `metadata.id`, but `ItemMetadata` is the full item
 * record (title, type, status, timestamps, and the rest). As with
 * {@link HOST_SETTINGS}, the cast is isolated here rather than applied to the
 * whole context at the call site — so `documents`, `query`, `tokens` and the
 * other {@link SearchProviderQueryContext} fields stay contract-checked.
 */
const itemDocument = (id: string): ItemDocument => ({
  metadata: { id } as ItemMetadata,
  body: "",
});

/** Manifest capabilities this reference extension declares, granted to the SDK host harness. */
const CAPABILITIES = [
  "commands", "renderers", "hooks", "schema", "importers",
  "search", "parser", "preflight", "services",
] as const;

const MANIFEST = JSON.parse(
  readFileSync(new URL("../manifest.json", import.meta.url), "utf-8"),
) as { version: string; capabilities: string[] };

// ---------------------------------------------------------------------------
// Harness fixture — activate through the SDK's real host engine, not a stub.
// A stub accepts whatever the extension registers; the real harness enforces
// the same manifest-capability governance the CLI does, so a registration
// this package is not entitled to fails here instead of at install time.
// ---------------------------------------------------------------------------

let harness: ExtensionTestHarness;

// Built in `before` rather than inside the activation test: every later test
// reads `harness`, so assigning it from within a test would make the whole
// suite depend on execution order and fail with "Cannot read properties of
// undefined" if that one test failed or the runner used concurrency.
before(async () => {
  harness = await createExtensionTestHarness(extension, {
    name: "pm-ts-starter",
    capabilities: CAPABILITIES,
  });
});

test("extension activates cleanly through the real SDK harness", () => {
  assert.deepEqual(harness.activation.failed, [], "activation must not fail");
});

// ---------------------------------------------------------------------------
// Module shape + version alignment
// ---------------------------------------------------------------------------

test("extension module has required shape", () => {
  assert.ok(extension, "module should export a default value");
  assert.strictEqual(typeof extension, "object", "extension should be an object");
  assert.ok("activate" in extension, "extension should have an activate method");
  assert.strictEqual(typeof extension.activate, "function", "activate should be a function");
  // composeExtensionPackage sets manifest on the module
  assert.ok("manifest" in extension, "extension should have a manifest mirror");
  assert.strictEqual(extension.manifest?.name, "pm-ts-starter");
});

test("package, manifest, and runtime versions stay aligned", () => {
  const packageVersion = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
  ).version;
  assert.strictEqual(MANIFEST.version, packageVersion);
  assert.strictEqual(synthesizedManifest.version, packageVersion);
  assert.strictEqual(manifestMirror.version, packageVersion);
});

// ---------------------------------------------------------------------------
// Blueprint lint + capability reconciliation
// ---------------------------------------------------------------------------

test("blueprint passes lintExtensionBlueprint with no error-severity findings", () => {
  const result = lintExtensionBlueprint(blueprint, {
    declaredCapabilities: MANIFEST.capabilities,
  });
  assert.ok(result.ok, `blueprint lint must pass: ${JSON.stringify(result.findings)}`);
  const errors = result.findings.filter((f) => f.severity === "error");
  assert.deepEqual(errors, [], "no error-severity findings");
});

test("assertExtensionBlueprint does not throw for a clean blueprint", () => {
  // This is the throwing CI guard — if it doesn't throw, the blueprint is clean.
  const result = assertExtensionBlueprint(blueprint, {
    declaredCapabilities: MANIFEST.capabilities,
  });
  assert.ok(result.ok);
});

test("deriveExtensionCapabilities returns all 9 capabilities", () => {
  const caps = deriveExtensionCapabilities(blueprint);
  assert.deepStrictEqual(caps.sort(), [...CAPABILITIES].sort());
});

test("manifest capabilities match the blueprint (assertExtensionManifestMatchesBlueprint)", () => {
  // This strictly asserts no drift in either direction.
  const match = assertExtensionManifestMatchesBlueprint(
    { capabilities: MANIFEST.capabilities },
    blueprint,
  );
  assert.deepEqual(match.missing, [], "no missing capabilities");
  assert.deepEqual(match.unused, [], "no unused capabilities");
});

test("collectUsedExtensionCapabilities agrees with deriveExtensionCapabilities", () => {
  // reconcileExtensionCapabilityUsage is the runtime counterpart; we verify
  // the static derivation matches the runtime collection from the activation.
  const used = collectUsedExtensionCapabilities(harness.activation);
  assert.deepStrictEqual(
    [...used].sort(),
    derivedCapabilities.slice().sort(),
    "static derivation must match runtime collection",
  );
});

test("describeExtensionBlueprint produces a non-empty surface summary", () => {
  const summary = describeExtensionBlueprint(blueprint);
  assert.ok(summary.capabilities.length > 0, "should have capabilities");
  assert.ok(summary.commands.length > 0, "should have commands");
  assert.ok(summary.hooks.length > 0, "should have hooks");
});

// ---------------------------------------------------------------------------
// Per-capability registration assertions (assertRegistered*)
// ---------------------------------------------------------------------------

test("registers every command via assertRegisteredCommandContract", () => {
  const expectedCommands = [
    "hello",
    "ts-starter info",
    "ts-starter plan-demo",
    "ts-starter context-demo",
    "ts-starter search-demo",
    "ts-starter history-compact-demo",
    "ts-starter setup",
  ];
  for (const cmd of expectedCommands) {
    harness.assertCommandContract({ command: cmd });
  }
});

test("registers a command override for 'list' via assertRegisteredCommandOverride", () => {
  harness.assertCommandOverride({ command: "list" });
});

test("registers flags for 'list' via assertRegisteredFlags", () => {
  harness.assertFlags({ targetCommand: "list", flags: ["--ts-starter-tag"] });
});

test("registers item field 'ts_starter_ref' via assertRegisteredItemField", () => {
  harness.assertItemField({ field: "ts_starter_ref", type: "string" });
});

test("registers item type 'Spike' via assertRegisteredItemType", () => {
  harness.assertItemType({ itemType: "Spike" });
});

test("registers migration 'ts-starter-noop' via assertRegisteredMigration", () => {
  harness.assertMigration({ migration: "ts-starter-noop" });
});

test("registers project profile 'ts_starter_demo' via assertRegisteredProfile", () => {
  harness.assertProfile({ profile: demoProfile.name });
});

test("registers all five hook kinds via assertRegisteredHook", () => {
  harness.assertHook({ kind: "before_command" });
  harness.assertHook({ kind: "after_command" });
  harness.assertHook({ kind: "on_write" });
  harness.assertHook({ kind: "on_read" });
  harness.assertHook({ kind: "on_index" });
});

test("registers importer 'ts-starter-demo' via assertRegisteredImporter", () => {
  harness.assertImporter({ importer: "ts-starter-demo" });
});

test("registers exporter 'ts-starter-demo' via assertRegisteredExporter", () => {
  harness.assertExporter({ exporter: "ts-starter-demo" });
});

test("registers renderer override for 'json' via assertRegisteredRendererOverride", () => {
  harness.assertRendererOverride({ format: "json" });
});

test("registers search provider 'ts-starter-prefix' via assertRegisteredSearchProvider", () => {
  harness.assertSearchProvider({ provider: "ts-starter-prefix" });
});

test("registers vector store adapter 'ts-starter-memory' via assertRegisteredVectorStoreAdapter", () => {
  harness.assertVectorStoreAdapter({ adapter: "ts-starter-memory" });
});

test("registers parser override for 'list' via assertRegisteredParserOverride", () => {
  harness.assertParserOverride({ command: "list" });
});

test("registers preflight override via assertRegisteredPreflightOverride", () => {
  harness.assertPreflightOverride();
});

test("registers service override for 'output_format' via assertRegisteredServiceOverride", () => {
  harness.assertServiceOverride({ service: "output_format" });
});

test("assertExtensionCapabilityUsage: no declared-but-unused capabilities", () => {
  const usage = harness.assertCapabilityUsage({
    declared: CAPABILITIES,
    extensionName: "pm-ts-starter",
  });
  assert.deepEqual(usage.unused, [], "no unused capabilities");
});

// ---------------------------------------------------------------------------
// Per-capability invocation tests (runRegistered*ForTest)
// ---------------------------------------------------------------------------

/**
 * Read the `greeting` field out of a `hello` command result.
 *
 * Command handlers return a bare object, not a string — the CLI silently
 * no-ops `api.registerRenderer` for command stdout (pm-cli#560), so handlers
 * must hand back structured data. Stringifying the result yields
 * "[object Object]", which makes a `assert.match` pass or fail for the wrong
 * reason, so pull the field out explicitly instead.
 */
function greetingOf(result: unknown): string {
  assert.ok(
    result !== null && typeof result === "object" && "greeting" in result,
    "hello must return an object carrying a greeting field",
  );
  const { greeting } = result as { greeting: unknown };
  assert.equal(typeof greeting, "string", "greeting must be a string");
  return greeting as string;
}

test("hello command resolves name from --name, positional, and default", async () => {
  // --name flag wins
  let result = await harness.runCommand({ command: "hello", options: { name: "Flag" }, args: ["Ignored"] });
  assert.match(greetingOf(result.result), /Flag/);

  // positional fallback
  result = await harness.runCommand({ command: "hello", options: {}, args: ["Positional"] });
  assert.match(greetingOf(result.result), /Positional/);

  // default
  result = await harness.runCommand({ command: "hello", options: {}, args: [] });
  assert.match(greetingOf(result.result), /pm-cli/);

  // loud
  result = await harness.runCommand({ command: "hello", options: { loud: true }, args: [] });
  const greeting = greetingOf(result.result);
  assert.equal(greeting, greeting.toUpperCase(), "loud should uppercase");
});

test("hello throws a typed expected error for an empty name", async () => {
  await assert.rejects(
    () => harness.runCommand({ command: "hello", options: { name: "   " }, args: [] }),
    (err: unknown) => isPmCliExpectedError(err) && /empty/.test((err as Error).message),
  );
});

test("search-demo throws a typed expected error when no query is given", async () => {
  await assert.rejects(
    () => harness.runCommand({ command: "ts-starter search-demo", options: {}, args: [] }),
    (err: unknown) => isPmCliExpectedError(err) && /query/.test((err as Error).message),
  );
});

test("setup command is non-interactive without --interactive and safe without a TTY", async () => {
  const result = await harness.runCommand({ command: "ts-starter setup", options: {}, args: [] });
  const payload = result.result as { interactive_requested: boolean; interactive_run: boolean; capabilities: unknown[] };
  assert.strictEqual(payload.interactive_requested, false);
  assert.strictEqual(payload.interactive_run, false);
  assert.ok(Array.isArray(payload.capabilities));

  const resultInteractive = await harness.runCommand({
    command: "ts-starter setup",
    options: { interactive: true },
    args: [],
  });
  const payloadInteractive = resultInteractive.result as { interactive_requested: boolean; interactive_run: boolean };
  assert.strictEqual(payloadInteractive.interactive_requested, true);
  assert.strictEqual(payloadInteractive.interactive_run, false);
});

test("search provider filters ctx.documents and returns SearchProviderHit shape", async () => {
  const result = await harness.runSearchProvider({
    provider: "ts-starter-prefix",
    operation: "query",
    context: {
      query: "keep-",
      mode: "keyword",
      tokens: ["keep-"],
      options: {},
      settings: HOST_SETTINGS,
      documents: [itemDocument("keep-1"), itemDocument("drop-1"), itemDocument("keep-2")],
    },
  });

  const hits: Array<{ id: string; score: number }> = Array.isArray(result)
    ? result
    : ((result as { hits?: Array<{ id: string; score: number }> })?.hits ?? []);
  assert.deepEqual(hits.map((hit) => hit.id), ["keep-1", "keep-2"]);
  assert.ok(hits.every((hit) => typeof hit.score === "number"), "every hit needs a numeric score");
});

test("vector store adapter upsert + query + delete round-trip", async () => {
  // The host embeds: `upsert` receives points that already carry `vector`, and
  // `query` receives a pre-embedded `vector` — never raw text. These contexts
  // are therefore passed uncast, so any drift between the adapter and the real
  // VectorStore*Context contracts fails the build instead of silently passing.
  const upserted = await harness.runVectorStoreAdapter({
    adapter: "ts-starter-memory",
    operation: "upsert",
    context: {
      points: [
        { id: "vec-1", vector: [1, 0, 0], payload: { title: "hello world" } },
        { id: "vec-2", vector: [0, 1, 0] },
      ],
      settings: HOST_SETTINGS,
    },
  });
  assert.deepStrictEqual(upserted, { upserted: 2 });

  const hits = await harness.runVectorStoreAdapter({
    adapter: "ts-starter-memory",
    operation: "query",
    context: { vector: [1, 0, 0], limit: 5, settings: HOST_SETTINGS },
  });
  assert.strictEqual(hits[0]?.id, "vec-1", "nearest neighbour of [1,0,0] is vec-1");
  assert.strictEqual(hits[0]?.score, 1);
  assert.deepStrictEqual(hits[0]?.payload, { title: "hello world" });
  assert.strictEqual(hits.length, 2, "limit of 5 returns both stored points");

  // `limit` must be honoured, not ignored.
  const limited = await harness.runVectorStoreAdapter({
    adapter: "ts-starter-memory",
    operation: "query",
    context: { vector: [1, 0, 0], limit: 1, settings: HOST_SETTINGS },
  });
  assert.strictEqual(limited.length, 1);

  const deleted = await harness.runVectorStoreAdapter({
    adapter: "ts-starter-memory",
    operation: "delete",
    context: { ids: ["vec-1", "missing-id"], settings: HOST_SETTINGS },
  });
  assert.deepStrictEqual(deleted, { deleted: 1 }, "only ids actually present count as deleted");

  const afterDelete = await harness.runVectorStoreAdapter({
    adapter: "ts-starter-memory",
    operation: "query",
    context: { vector: [1, 0, 0], limit: 5, settings: HOST_SETTINGS },
  });
  assert.deepStrictEqual(afterDelete.map((hit) => hit.id), ["vec-2"]);
});

test("exporter returns ts_starter marker", async () => {
  const result = await harness.runExporter({ exporter: "ts-starter-demo" });
  const payload = result.result as { ts_starter?: boolean };
  assert.ok(payload.ts_starter, "exporter should return ts_starter marker");
});

test("importer returns imported: 0", async () => {
  const result = await harness.runImporter({ importer: "ts-starter-demo" });
  const payload = result.result as { imported?: number };
  assert.strictEqual(payload.imported, 0);
});

test("renderer override reshapes ts_starter payload and passes through others", async () => {
  // Our payload on a command we own → reshaped
  const ours = await harness.runRendererOverride({
    format: "json",
    command: "ts-starter-demo export",
    result: { ts_starter: true, exported: 0 },
  });
  assert.ok(ours.overridden, "renderer should handle our payload");
  assert.match(String(ours.rendered), /pm-ts-starter/);

  // Non-our payload → not handled (falls through to native)
  const other = await harness.runRendererOverride({
    format: "json",
    command: "list",
    result: { other: true },
  });
  assert.ok(!other.overridden, "renderer should NOT handle unrelated payloads");
});

test("renderer override declares non-empty ownership so it cannot claim every command", () => {
  const registered = harness.assertRendererOverride({ format: "json" });

  // An override registered without ownership is treated by the host as owning
  // every command, which is what makes an unscoped renderer able to replace all
  // --json output. Assert the declaration exists rather than trusting the
  // callback's internal guard.
  assert.ok(
    Array.isArray(registered.commands) && registered.commands.length > 0,
    "renderer must declare the command paths it owns",
  );
  assert.strictEqual(typeof registered.resultDiscriminator, "function");
  assert.ok(
    !registered.commands.includes("list"),
    "list is a pass-through command override and must not be owned by the renderer",
  );
  for (const command of registered.commands) {
    assert.ok(
      command === "hello" || command.startsWith("ts-starter"),
      `owned command ${command} must be namespaced to this extension`,
    );
  }
});

test("renderer resultDiscriminator accepts only this extension's payload shape", () => {
  const { resultDiscriminator } = harness.assertRendererOverride({ format: "json" });
  assert.ok(resultDiscriminator, "renderer must declare a result discriminator");

  assert.strictEqual(resultDiscriminator({ ts_starter: true }), true);
  assert.strictEqual(resultDiscriminator({ other: true }), false, "foreign object");
  assert.strictEqual(resultDiscriminator(null), false, "null is typeof object");
  assert.strictEqual(resultDiscriminator("ts_starter"), false, "non-object");
});

test("renderer callback still declines a foreign payload when invoked directly", () => {
  // The host filters on resultDiscriminator before calling run, so this arm is
  // unreachable through runRendererOverride. Exercise it directly: the callback
  // must stay correct on its own, because returning a rendered string for a
  // payload that is not ours is exactly how a renderer override corrupts
  // unrelated command output.
  const { run } = harness.assertRendererOverride({ format: "json" });

  assert.strictEqual(run({ result: { other: true } } as RendererOverrideContext), null);
  assert.match(
    String(run({ result: { ts_starter: true, exported: 0 } } as RendererOverrideContext)),
    /pm-ts-starter/,
  );
});

test("renderer override declines a command it does not own even for our own payload", async () => {
  // Ownership is enforced by the host ahead of the callback, so a payload this
  // extension would otherwise reshape must still fall through on a foreign
  // command. This is the property that keeps sibling extensions from
  // colliding on the shared json renderer surface.
  const foreign = await harness.runRendererOverride({
    format: "json",
    command: "context-pack",
    result: { ts_starter: true, exported: 0 },
  });
  assert.ok(!foreign.overridden, "renderer must not run on an unowned command");
});

test("parser override for 'list' returns empty delta (pass-through)", async () => {
  const result = await harness.runParserOverride({
    command: "list",
    args: ["--json"],
    options: {},
    global: { json: true, quiet: true, noPager: true },
    pm_root: "",
  });
  assert.ok(result.overridden, "parser override should fire");
});

test("preflight override returns pass-through decision", async () => {
  // PreflightOverrideContext extends CommandHandlerContext, so `command`,
  // `args`, `options`, `global` and `pm_root` are all required — omitting
  // `command` fails deep inside the runner with an opaque "Cannot read
  // properties of undefined (reading 'trim')" rather than a named-field error.
  // Pass a fully-formed context rather than casting.
  const result = await harness.runPreflightOverride({
    command: "list",
    args: [],
    options: {},
    global: {},
    pm_root: ".",
    decision: {
      enforce_item_format_gate: true,
      run_preflight_item_format_sync: false,
      run_extension_migrations: true,
      enforce_mandatory_migration_gate: false,
    },
  });
  assert.ok(result.overridden, "preflight override should fire");
});

test("service override for 'output_format' declines and leaves the host envelope untouched", async () => {
  // The host decides an override "claimed" the payload by reference identity:
  // returning `ctx.payload` itself reads as declining and yields `handled: false`
  // (unbraind/pm-cli#741), so the host falls through to its native formatter and
  // the printed output is the real command payload — not the internal
  // `{global, format, options, result}` envelope.
  //
  // The override under test is a reference demonstration that contributes
  // nothing to output formatting, so it MUST decline. Asserting against the
  // real registered override (runRegisteredServiceOverrideForTest via the SDK
  // harness) — not a hand-rolled `api` double — is what guards this: a double
  // would assert against itself and silently re-ship the bug, which is how the
  // prior "claims the payload" test passed while every `pm` command broke.
  const envelope = { global: { json: true }, format: "json", options: {}, result: { items: [] } };
  const result = await harness.runServiceOverride({
    service: "output_format",
    payload: envelope,
  });
  assert.strictEqual(result.handled, false, "override must decline, not claim, the output_format payload");
  assert.deepStrictEqual(result.result, envelope, "decline must leave the host envelope untouched");
});

test("command override for 'list' returns result unchanged", async () => {
  const result = await harness.runCommandOverride({
    command: "list",
    args: [],
    options: {},
    pm_root: ".",
    result: { items: [] },
  });
  assert.ok(result.overridden, "command override should fire");
  assert.deepStrictEqual(result.result, { items: [] });
});

test("migration 'ts-starter-noop' runs without error", async () => {
  // The no-op migration returns undefined (no explicit return), so there is no
  // return value worth asserting; what matters is that the runner resolves
  // rather than rejects.
  await assert.doesNotReject(() => harness.runMigration({ migration: "ts-starter-noop" }));
});

// ---------------------------------------------------------------------------
// Project profile validation
// ---------------------------------------------------------------------------

test("demo profile passes assertProjectProfile with no error-severity findings", () => {
  const report = assertProjectProfile(demoProfile);
  assert.ok(report.ok, `profile lint must pass: ${JSON.stringify(report.findings)}`);
  const errors = report.findings.filter((f) => f.severity === "error");
  assert.deepEqual(errors, [], "no error-severity profile findings");
});

test("describeProjectProfile produces a non-empty description", () => {
  const desc = describeProjectProfile(demoProfile);
  assert.ok(desc.name, "should have a name");
  assert.ok(desc.title, "should have a title");
});

test("lintProjectProfile on the demo profile produces no errors", () => {
  const report = lintProjectProfile(demoProfile);
  assert.ok(report.ok, `profile lint must pass: ${JSON.stringify(report.findings)}`);
});

// ---------------------------------------------------------------------------
// pmExpectedError helper tests
// ---------------------------------------------------------------------------

test("pmExpectedError builds a PmCliExpectedError-shaped error", () => {
  const err = pmExpectedError("demo failure", {
    exitCode: 3,
    context: { feature: "plan", why: "no plan found", hint: "run `pm plan create` first" },
  });
  assert.strictEqual(err.name, "PmCliError");
  assert.strictEqual(err.exitCode, 3);
  assert.strictEqual(err.message, "demo failure");
  assert.strictEqual(err.context.code, "plan");
  assert.strictEqual(err.context.why, "no plan found");
  assert.deepStrictEqual(err.context.nextSteps, ["run `pm plan create` first"]);
  assert.ok(err.context.recovery);
  assert.strictEqual(err.context.recovery?.attempted_command, "plan");
  assert.ok(isPmCliExpectedError(err), "isPmCliExpectedError should recognise the built error");
  assert.ok(!isPmCliExpectedError(new Error("plain")), "plain errors should not match");
});

// ---------------------------------------------------------------------------
// pm read buffer overrun test
// ---------------------------------------------------------------------------

test("runPm names a read-buffer overrun instead of failing silently", async (t) => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");

  const dir = mkdtempSync(join(tmpdir(), "pm-ts-starter-buffer-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pmRoot = join(dir, ".agents", "pm");
  try {
    execFileSync("pm", ["init", "--workspace", dir, "--defaults", "--author", "test"], { cwd: dir, stdio: "ignore" });
    execFileSync("pm", ["create", "--pm-path", pmRoot, "--type", "Issue", "--title", "Buffer probe item", "--author", "test"], { cwd: dir, stdio: "ignore" });
  } catch {
    t.skip("pm CLI unavailable");
    return;
  }

  const originalCap = process.env.PM_JSON_MAX_BUFFER;
  process.env.PM_JSON_MAX_BUFFER = "64";
  try {
    const run = runPm(pmRoot, ["list-all", "--json"]);
    assert.strictEqual(run.ok, false, "an overrun must not report success");
    assert.match(
      run.stderr,
      /read buffer/,
      `overrun must be named, not silent; saw: ${run.stderr || "(empty stderr)"}`,
    );
  } finally {
    if (originalCap === undefined) delete process.env.PM_JSON_MAX_BUFFER;
    else process.env.PM_JSON_MAX_BUFFER = originalCap;
  }
});
// ---------------------------------------------------------------------------
// Root-file resolution must work from both module layouts: as source at the
// package root, and compiled into dist/ one level below it. Getting the order
// wrong is silent — the wrong package.json parses fine and only the values are
// wrong — so both layouts are asserted against a synthetic tree rather than
// against this repository, whose own parent happens to have no package.json.
// ---------------------------------------------------------------------------

test("readRootJson prefers the package's own directory over an enclosing package", () => {
  const enclosing = mkdtempSync(join(tmpdir(), "pm-ts-starter-root-"));
  const pkgRoot = join(enclosing, "pkg");
  mkdirSync(join(pkgRoot, "dist"), { recursive: true });
  writeFileSync(join(enclosing, "package.json"), JSON.stringify({ name: "enclosing" }));
  writeFileSync(join(pkgRoot, "package.json"), JSON.stringify({ name: "the-package" }));

  const fromSource = readRootJson("package.json", pkgRoot) as { name?: string } | undefined;
  assert.strictEqual(
    fromSource?.name,
    "the-package",
    "running as source, the module must read its own package.json, not the one enclosing the checkout",
  );

  const fromDist = readRootJson("package.json", join(pkgRoot, "dist")) as { name?: string } | undefined;
  assert.strictEqual(
    fromDist?.name,
    "the-package",
    "published in dist/, the module must still find the package root one level up",
  );
});

test("readRootJson does not fall through to the parent when its own file is malformed", () => {
  // A corrupt file at the package root must not be answered with the enclosing
  // package's data: that is the same silent-wrong-package failure the candidate
  // order prevents, reached by a different route.
  const enclosing = mkdtempSync(join(tmpdir(), "pm-ts-starter-corrupt-"));
  const pkgRoot = join(enclosing, "pkg");
  mkdirSync(pkgRoot, { recursive: true });
  writeFileSync(join(enclosing, "package.json"), JSON.stringify({ name: "enclosing" }));
  writeFileSync(join(pkgRoot, "package.json"), "{ this is not json");

  assert.strictEqual(readRootJson("package.json", pkgRoot), undefined);
});

test("readRootJson returns undefined when neither candidate is readable", () => {
  const empty = mkdtempSync(join(tmpdir(), "pm-ts-starter-noroot-"));
  assert.strictEqual(readRootJson("package.json", join(empty, "nested", "deeper")), undefined);
});
