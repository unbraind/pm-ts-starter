/** A consumer API cannot emit compiler artifacts or consume build caches. */
import assert from "node:assert/strict";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import test from "node:test";
import {checkSdkContracts, SdkContractRefusal} from "../sdk-contracts.ts";
import {dependencyBound, filesystemSnapshot, testCompiler, testDirectory} from "./dependency-fixtures.ts";

test("read-only API ignores warm metadata and never emits to linked output children", async t => {
  const root = testDirectory(t, "sdk-api-writers-");
  const project = join(root, "consumer");
  mkdirSync(join(project, "node_modules"), {recursive: true});
  symlinkSync(dirname(dirname(testCompiler())), join(project, "node_modules/typescript"), "junction");
  const bound = dependencyBound(project), outside = join(root, "outside");
  mkdirSync(outside); writeFileSync(join(outside, "trace.json"), "original sentinel");
  symlinkSync(outside, join(project, "node_modules/output"), "junction");
  writeFileSync(join(project, "consumer.ts"), "export const incompatible: string = 1;");
  for (const destination of ["consumer.ts", "node_modules/output", "../outside/trace.json"]) {
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], noEmit: true, incremental: true, tsBuildInfoFile: destination, generateTrace: "node_modules/output", outDir: "node_modules/output", declarationDir: "node_modules/output", declaration: true}, files: ["consumer.ts"]}));
    const before = filesystemSnapshot(root), matrix = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
    for (const row of matrix.rows) { assert.equal(row.ok, false); assert.deepEqual(row.codes, ["TS2322"]); }
    assert.equal(filesystemSnapshot(root), before);
    assert.equal(readFileSync(join(outside, "trace.json"), "utf8"), "original sentinel");
  }
});

test("API-incompatible native consumers receive a typed compiler refusal", async t => {
  const root = mkdtempSync(join(tmpdir(), "sdk-native-api-"));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(join(root, "node_modules"));
  symlinkSync(new URL("../node_modules/typescript", import.meta.url), join(root, "node_modules/typescript"), "junction");
  writeFileSync(join(root, "consumer.ts"), "export const value = 1;");
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], noEmit: true}, files: ["consumer.ts"]}));
  const bound = dependencyBound(root);
  await assert.rejects(checkSdkContracts({consumer: root, minimum: bound, current: bound}), error => error instanceof SdkContractRefusal && error.code === "compiler_unavailable" && ["createProgram", "getPreEmitDiagnostics", "getParsedCommandLineOfConfigFile"].every(name => error.remedy.includes(name)));
});
