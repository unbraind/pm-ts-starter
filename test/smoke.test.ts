import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import extension from "../dist/index.js";

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
  assert.deepStrictEqual(Object.keys(commands).sort(), ["hello", "ts-starter info"]);
  assert.strictEqual(commands.hello.flags.length, 2);
  assert.strictEqual(renderers.json({ result: { other: true } }), null);
  assert.match(String(renderers.json({ result: { ts_starter: true, exported: 0 } })), /pm-ts-starter/);
  assert.ok(importer, "ts-starter importer should be captured");
  assert.ok(exporter, "ts-starter exporter should be captured");
});
