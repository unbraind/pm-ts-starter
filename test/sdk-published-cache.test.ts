/** Failed registry installs must never publish or retain an incomplete SDK cache. */
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { publishedSdks } from "./sdk-contracts-support.ts";

test("published SDK cache cleans a partial install and retries both endpoints", t => {
  const prefixes: string[] = [];
  const probe = t.mock.method(childProcess, "spawnSync", (_command: string, args: string[]) => {
    const prefix = args[args.indexOf("--prefix") + 1]!;
    prefixes.push(prefix);
    mkdirSync(prefix, { recursive: true });
    writeFileSync(join(prefix, "partial"), "install started");
    return { status: prefixes.length === 2 ? 1 : 0, stderr: "synthetic install failure", stdout: "" };
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => publishedSdks(), /synthetic install failure/);
    assert.equal(prefixes.length, 2);
    const failedRoot = dirname(prefixes[0]!);
    assert.equal(existsSync(failedRoot), false, "failed root and first endpoint must be removed");
    const complete = publishedSdks();
    assert.equal(prefixes.length, 4, "retry must install both endpoints");
    assert.notEqual(complete.root, failedRoot);
    assert.ok(existsSync(join(complete.root, "minimum", "partial")));
    assert.ok(existsSync(join(complete.root, "current", "partial")));
    assert.equal(publishedSdks(), complete);
    assert.equal(prefixes.length, 4, "only a completed cache may be reused");
  } finally { probe.mock.restore(); syncBuiltinESMExports(); }
});
