import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import extension, { isPmCliExpectedError, pmExpectedError } from "../dist/index.js";

test("extension has required shape", () => {
  assert.ok(extension, "module should export a default value");
  assert.strictEqual(typeof extension, "object", "extension should be an object");
  assert.ok("name" in extension, "extension should have a name property");
  assert.ok("activate" in extension, "extension should have an activate method");
  assert.strictEqual(typeof extension.activate, "function", "activate should be a function");
});

test("extension registers every demonstrated capability", () => {
  const registered: string[] = [];
  const commands: Record<string, any> = {};
  const renderers: Record<string, (ctx: any) => unknown> = {};
  let importer: ((ctx: any) => unknown) | undefined;
  let exporter: ((ctx: any) => unknown) | undefined;
  // Mirror the FULL ExtensionApi surface so activation can exercise every
  // capability this reference extension demonstrates. The method names match
  // the real SDK (there is no registerHook/registerSchema — schema is
  // registerItemFields/registerItemTypes/registerMigration and hooks live under
  // api.hooks.*). A dropped capability or a renamed SDK method fails here.
  const api = {
    registerCommand: (command: any) => { registered.push("command"); commands[command.name] = command; },
    registerFlags: () => { registered.push("flags"); },
    registerParser: () => { registered.push("parser"); },
    registerPreflight: () => { registered.push("preflight"); },
    registerService: () => { registered.push("service"); },
    registerItemFields: () => { registered.push("itemFields"); },
    registerItemTypes: () => { registered.push("itemTypes"); },
    registerMigration: () => { registered.push("migration"); },
    registerRenderer: (format: string, renderer: (ctx: any) => unknown) => { registered.push("renderer"); renderers[format] = renderer; },
    registerImporter: (_name: string, handler: (ctx: any) => unknown) => { registered.push("importer"); importer = handler; },
    registerExporter: (_name: string, handler: (ctx: any) => unknown) => { registered.push("exporter"); exporter = handler; },
    registerSearchProvider: () => { registered.push("search"); },
    registerVectorStoreAdapter: () => { registered.push("vectorStore"); },
    hooks: {
      beforeCommand: () => { registered.push("hook:before"); },
      afterCommand: () => { registered.push("hook:after"); },
      onWrite: () => { registered.push("hook:onWrite"); },
      onRead: () => { registered.push("hook:onRead"); },
      onIndex: () => { registered.push("hook:onIndex"); },
    },
  };
  extension.activate(api as any);

  const expected = [
    "command", "flags", "parser", "preflight", "service", "itemFields",
    "itemTypes", "migration", "renderer", "importer", "exporter", "search",
    "vectorStore", "hook:before", "hook:after", "hook:onWrite", "hook:onRead",
    "hook:onIndex",
  ];
  for (const cap of expected) {
    assert.ok(registered.includes(cap), `extension should register "${cap}" (got: ${JSON.stringify(registered)})`);
  }

  // The version is resolved from manifest.json at module load (the Daily
  // Release workflow bumps manifest.json, never a source literal), so the
  // test asserts against the same source of truth instead of a snapshot.
  const manifestVersion = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf-8")).version;
  assert.strictEqual(extension.version, manifestVersion);

  // The reference extension now registers the original two commands plus the
  // new pm-feature integration demos (plan/context/search/history-compact) and
  // a guided setup command — all covered by the "commands" capability.
  assert.deepStrictEqual(
    Object.keys(commands).sort(),
    [
      "hello",
      "ts-starter context-demo",
      "ts-starter history-compact-demo",
      "ts-starter info",
      "ts-starter plan-demo",
      "ts-starter search-demo",
      "ts-starter setup",
    ],
  );
  assert.strictEqual(commands.hello.flags.length, 2);
  assert.ok(renderers.json({ result: { other: true } }) === null);
  assert.match(String(renderers.json({ result: { ts_starter: true, exported: 0 } })), /pm-ts-starter/);
  assert.ok(importer, "ts-starter importer should be captured");
  assert.ok(exporter, "ts-starter exporter should be captured");
});

test("every registered command carries failure_hints and typed arguments", () => {
  const commands: Record<string, any> = {};
  const api = {
    registerCommand: (command: any) => { commands[command.name] = command; },
    registerFlags: () => {},
    registerParser: () => {},
    registerPreflight: () => {},
    registerService: () => {},
    registerItemFields: () => {},
    registerItemTypes: () => {},
    registerMigration: () => {},
    registerRenderer: () => {},
    registerImporter: () => {},
    registerExporter: () => {},
    registerSearchProvider: () => {},
    registerVectorStoreAdapter: () => {},
    hooks: {
      beforeCommand: () => {},
      afterCommand: () => {},
      onWrite: () => {},
      onRead: () => {},
      onIndex: () => {},
    },
  };
  extension.activate(api as any);

  for (const name of Object.keys(commands)) {
    const cmd = commands[name];
    assert.ok(
      Array.isArray(cmd.failure_hints) && cmd.failure_hints.length > 0,
      `command "${name}" should declare non-empty failure_hints`,
    );
    assert.ok(
      Array.isArray(cmd.arguments),
      `command "${name}" should declare a (possibly empty) arguments array`,
    );
    for (const flag of cmd.flags ?? []) {
      // The 2026.7.6 SDK reads `value_type` first; prefer it over the legacy `type`.
      assert.ok(
        flag.value_type === undefined || ["string", "number", "boolean"].includes(flag.value_type),
        `flag "${flag.long}" on "${name}" has an invalid value_type`,
      );
    }
  }

  // Typed positional arguments: the search-demo and history-compact-demo
  // commands declare a named positional argument.
  const searchArgs = commands["ts-starter search-demo"].arguments;
  assert.ok(searchArgs.some((a: any) => a.name === "query"), "search-demo should declare a `query` positional");
  const hcArgs = commands["ts-starter history-compact-demo"].arguments;
  assert.ok(hcArgs.some((a: any) => a.name === "id" && a.required), "history-compact-demo should declare a required `id` positional");
});

test("hello command resolves the name from --name, positional, and default", async () => {
  const commands: Record<string, any> = {};
  const api = {
    registerCommand: (command: any) => { commands[command.name] = command; },
    registerFlags: () => {},
    registerParser: () => {},
    registerPreflight: () => {},
    registerService: () => {},
    registerItemFields: () => {},
    registerItemTypes: () => {},
    registerMigration: () => {},
    registerRenderer: () => {},
    registerImporter: () => {},
    registerExporter: () => {},
    registerSearchProvider: () => {},
    registerVectorStoreAdapter: () => {},
    hooks: {
      beforeCommand: () => {},
      afterCommand: () => {},
      onWrite: () => {},
      onRead: () => {},
      onIndex: () => {},
    },
  };
  extension.activate(api as any);
  const hello = commands["hello"];

  // --name flag wins
  let result = await hello.run({ options: { name: "Flag" }, args: ["Ignored"], pm_root: "." });
  assert.match(result.greeting, /Flag/);

  // positional fallback
  result = await hello.run({ options: {}, args: ["Positional"], pm_root: "." });
  assert.match(result.greeting, /Positional/);

  // default
  result = await hello.run({ options: {}, args: [], pm_root: "." });
  assert.match(result.greeting, /pm-cli/);

  // loud
  result = await hello.run({ options: { loud: true }, args: [], pm_root: "." });
  assert.ok(result.greeting === result.greeting.toUpperCase(), "loud should uppercase");
});

test("hello throws a typed expected error for an empty name", async () => {
  const commands: Record<string, any> = {};
  const api = {
    registerCommand: (command: any) => { commands[command.name] = command; },
    registerFlags: () => {},
    registerParser: () => {},
    registerPreflight: () => {},
    registerService: () => {},
    registerItemFields: () => {},
    registerItemTypes: () => {},
    registerMigration: () => {},
    registerRenderer: () => {},
    registerImporter: () => {},
    registerExporter: () => {},
    registerSearchProvider: () => {},
    registerVectorStoreAdapter: () => {},
    hooks: {
      beforeCommand: () => {},
      afterCommand: () => {},
      onWrite: () => {},
      onRead: () => {},
      onIndex: () => {},
    },
  };
  extension.activate(api as any);
  const hello = commands["hello"];

  await assert.rejects(
    () => hello.run({ options: { name: "   " }, args: [], pm_root: "." }),
    (err: unknown) => isPmCliExpectedError(err) && /empty/.test((err as Error).message),
  );
});

test("search-demo throws a typed expected error when no query is given", async () => {
  const commands: Record<string, any> = {};
  const api = {
    registerCommand: (command: any) => { commands[command.name] = command; },
    registerFlags: () => {},
    registerParser: () => {},
    registerPreflight: () => {},
    registerService: () => {},
    registerItemFields: () => {},
    registerItemTypes: () => {},
    registerMigration: () => {},
    registerRenderer: () => {},
    registerImporter: () => {},
    registerExporter: () => {},
    registerSearchProvider: () => {},
    registerVectorStoreAdapter: () => {},
    hooks: {
      beforeCommand: () => {},
      afterCommand: () => {},
      onWrite: () => {},
      onRead: () => {},
      onIndex: () => {},
    },
  };
  extension.activate(api as any);
  const searchDemo = commands["ts-starter search-demo"];

  await assert.rejects(
    () => searchDemo.run({ options: {}, args: [], pm_root: "." }),
    (err: unknown) => isPmCliExpectedError(err) && /query/.test((err as Error).message),
  );
});

test("setup command is non-interactive without --interactive and safe without a TTY", async () => {
  const commands: Record<string, any> = {};
  const api = {
    registerCommand: (command: any) => { commands[command.name] = command; },
    registerFlags: () => {},
    registerParser: () => {},
    registerPreflight: () => {},
    registerService: () => {},
    registerItemFields: () => {},
    registerItemTypes: () => {},
    registerMigration: () => {},
    registerRenderer: () => {},
    registerImporter: () => {},
    registerExporter: () => {},
    registerSearchProvider: () => {},
    registerVectorStoreAdapter: () => {},
    hooks: {
      beforeCommand: () => {},
      afterCommand: () => {},
      onWrite: () => {},
      onRead: () => {},
      onIndex: () => {},
    },
  };
  extension.activate(api as any);
  const setup = commands["ts-starter setup"];

  const result = await setup.run({ options: {}, args: [], pm_root: "." });
  assert.strictEqual(result.interactive_requested, false);
  assert.strictEqual(result.interactive_run, false);
  assert.ok(Array.isArray(result.capabilities));

  // Even with --interactive requested, a non-TTY stdin must not block.
  const resultInteractive = await setup.run({ options: { interactive: true }, args: [], pm_root: "." });
  assert.strictEqual(resultInteractive.interactive_requested, true);
  assert.strictEqual(resultInteractive.interactive_run, false);
});

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