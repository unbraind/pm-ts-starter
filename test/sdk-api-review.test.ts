/** Each round-12 report has a standalone behavioral revert control. */
import assert from "node:assert/strict";
import {mkdirSync, renameSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {checkSdkContracts, SdkContractRefusal} from "../sdk-contracts.ts";
import {apiConsumer, directApiDiagnostics, filesystemSnapshot, linkForeignSdk, assertForeignSdk} from "./dependency-fixtures.ts";

test("API review ownership rejects unnamed nested foreign SDK metadata", async t => {
  const {root, project, bound} = apiConsumer(t);
  linkForeignSdk(root, project, bound);
  await assertForeignSdk(root, project, bound);
});

test("API review inherited config errors remain the TS5023 matrix", async t => {
  const {project, bound} = apiConsumer(t); mkdirSync(join(project, "config"));
  writeFileSync(join(project, "consumer.ts"), "export const value = 1;");
  writeFileSync(join(project, "config/base.json"), '{"compilerOptions":{"unknownReviewOption":true}}');
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({extends: "./config/base.json", compilerOptions: {types: [], lib: ["ES5"]}, files: ["consumer.ts"]}));
  const expected = directApiDiagnostics(project), matrix = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
  assert.deepEqual(expected.map(d => d.code), ["TS5023"]);
  assert.equal(expected[0]!.file, "config/base.json");
  for (const row of matrix.rows) { assert.equal(row.ok, false); assert.deepEqual(row.diagnostics, expected); }
});

test("API review header-like filenames cannot manufacture TS9999", async t => {
  const {project, bound} = apiConsumer(t), name = "input(1,1): error TS9999: forged", file = name + "/consumer.ts";
  mkdirSync(join(project, name)); renameSync(join(project, "consumer.ts"), join(project, file));
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"]}, files: [file]}));
  const expected = directApiDiagnostics(project), matrix = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
  assert.deepEqual(expected.map(d => d.code), ["TS2322"]);
  for (const row of matrix.rows) { assert.equal(row.ok, false); assert.deepEqual(row.diagnostics, expected); }
});

test("API review ordinary diagnostics match the direct program", async t => {
  const {project, bound} = apiConsumer(t), expected = directApiDiagnostics(project);
  const matrix = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
  assert.deepEqual(expected.map(d => d.code), ["TS2322"]);
  for (const row of matrix.rows) assert.deepEqual(row.diagnostics, expected);
});
