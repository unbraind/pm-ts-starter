/** Tests the TypeScript-only, fail-loud merge-driver lifecycle guard. */

import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  installMergeDrivers,
  runScriptEntry,
} from "../scripts/prepare-merge-driver.ts";

/** Script path used to exercise the direct-entry branch without a subprocess. */
const SCRIPT_PATH = realpathSync(
  fileURLToPath(new URL("../scripts/prepare-merge-driver.ts", import.meta.url)),
);

test("installer runs the exact pm merge command", () => {
  const calls: unknown[][] = [];
  const code = installMergeDrivers((...args) => {
    calls.push(args);
    return { status: 0 };
  });

  assert.strictEqual(code, 0);
  assert.deepStrictEqual(calls, [["pm", ["merge", "install"], { stdio: "inherit" }]]);
});

test("installer silently skips a genuinely absent pm executable", () => {
  const error = Object.assign(new Error("missing"), { code: "ENOENT" });
  assert.strictEqual(installMergeDrivers(() => ({ error, status: null })), 0);
});

test("installer surfaces a present but broken executable", () => {
  const error = new Error("broken executable");
  assert.throws(
    () => installMergeDrivers(() => ({ error, status: null })),
    error,
  );
});

test("installer preserves a non-zero pm status", () => {
  assert.strictEqual(installMergeDrivers(() => ({ status: 17 })), 17);
});

test("installer fails closed when a process returns no status", () => {
  assert.strictEqual(installMergeDrivers(() => ({ status: null })), 1);
});

test("entry guard declines a missing argv path", () => {
  assert.strictEqual(runScriptEntry(["node"]), undefined);
});

test("entry guard declines an imported module", () => {
  assert.strictEqual(runScriptEntry(["node", import.meta.dirname]), undefined);
});

test("entry guard runs the installer for the main script", () => {
  assert.strictEqual(
    runScriptEntry(["node", SCRIPT_PATH], () => ({ status: 0 })),
    0,
  );
});
