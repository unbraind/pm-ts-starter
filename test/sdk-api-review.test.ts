/** Each round-12 report has a standalone behavioral revert control. */
import assert from "node:assert/strict";
import {mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {checkSdkContracts, SdkContractRefusal} from "../sdk-contracts.ts";
import {apiConsumer, directApiDiagnostics, linkForeignSdk, assertForeignSdk, assertResolvedRefusal} from "./dependency-fixtures.ts";

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

test("unknown nested local packages are refused without guessing their identity", async t => {
  const {root, project, bound} = apiConsumer(t), directory = join(project, "local package");
  mkdirSync(directory); writeFileSync(join(directory, "package.json"), '{"name":"@unbrained/pm-cli","version":"2.0.0","type":"module"}');
  for (const [declaration, specifier] of [["index.d.ts", "index.js"], ["index.d.mts", "index.mjs"], ["index.d.cts", "index.cjs"]]) {
    writeFileSync(join(directory, declaration!), 'export declare const sdk: "foreign";');
    writeFileSync(join(project, "consumer.ts"), `export {sdk} from "./local package/${specifier}";`);
    await assertResolvedRefusal(root, project, bound, "unsupported_project_shape", "local package/" + declaration);
    rmSync(join(directory, declaration!));
  }
  writeFileSync(join(directory, "index.d.ts"), 'export declare const sdk: "foreign";');
  writeFileSync(join(project, "consumer.ts"), 'export {sdk} from "./local package/index.js";');
  rmSync(join(directory, "package.json"));
  assert.equal((await checkSdkContracts({consumer: project, minimum: bound, current: bound})).ok, true, "ordinary local declarations retain their original behavior");
  mkdirSync(join(directory, "package.json"));
  assert.equal((await checkSdkContracts({consumer: project, minimum: bound, current: bound})).ok, true, "a directory named package.json is not a package manifest");
  rmSync(join(directory, "package.json"), {recursive: true});
  symlinkSync("missing-metadata", join(directory, "package.json"));
  await assertResolvedRefusal(root, project, bound, "isolation_refused", "symlinks");
  rmSync(join(directory, "package.json"));
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  writeFileSync(join(project, "consumer.ts"), "export const unused = 1;");
  assert.equal((await checkSdkContracts({consumer: project, minimum: bound, current: bound})).ok, true, "unused nested metadata does not change the verdict");
  writeFileSync(join(project, "consumer.ts"), 'export {sdk} from "./local package/index.js";');
  writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], composite: true, module: "NodeNext"}, files: ["index.d.ts"]}));
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], module: "NodeNext"}, files: ["consumer.ts"], references: [{path: "local package"}]}));
  assert.deepEqual(directApiDiagnostics(project), []);
  assert.equal((await checkSdkContracts({consumer: project, minimum: bound, current: bound})).ok, true, "a compiler-owned referenced project boundary remains supported");
});
