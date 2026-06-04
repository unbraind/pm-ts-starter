import assert from "node:assert/strict";
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
  // Mirror the FULL ExtensionApi surface so activation can exercise every
  // capability this reference extension demonstrates. The method names match
  // the real SDK (there is no registerHook/registerSchema — schema is
  // registerItemFields/registerItemTypes/registerMigration and hooks live under
  // api.hooks.*). A dropped capability or a renamed SDK method fails here.
  const api = {
    registerCommand: () => { registered.push("command"); },
    registerFlags: () => { registered.push("flags"); },
    registerParser: () => { registered.push("parser"); },
    registerPreflight: () => { registered.push("preflight"); },
    registerService: () => { registered.push("service"); },
    registerItemFields: () => { registered.push("itemFields"); },
    registerItemTypes: () => { registered.push("itemTypes"); },
    registerMigration: () => { registered.push("migration"); },
    registerRenderer: () => { registered.push("renderer"); },
    registerImporter: () => { registered.push("importer"); },
    registerExporter: () => { registered.push("exporter"); },
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
});
