/** Generated filesystem names exercise lossless compiler path transport and canonical isolation. */
import assert from "node:assert/strict";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, dirname, join, resolve, sep} from "node:path";
import test from "node:test";
import {checkSdkContracts, SdkContractRefusal} from "../sdk-contracts.ts";
import {apiConsumer, boundaryRandom, dependencyBound, dependencyEntry, filesystemSnapshot, installTestCompiler, testCompiler, directApiDiagnostics} from "./dependency-fixtures.ts";

const unusual = ["\n", "\r", "\t", " ", "--leading", "'", '"', "é漢字"];

test("native containment property preserves literal backslash names while refusing real escapes", async t => {
  const {root, project, bound} = apiConsumer(t), random = boundaryRandom(154489), sources: string[] = [];
  for (let index = 0; index < 8; index++) {
    const name = (sep === "/" ? "..\\" : "..literal-") + random().toString(36), target = join(project, name);
    mkdirSync(target); writeFileSync(join(target, "index.d.ts"), "export declare const value: 1;");
    symlinkSync(target, join(project, "alias-" + index), "junction");
    sources.push(`export {value as v${index}} from "./alias-${index}/index.js";`);
  }
  writeFileSync(join(project, "consumer.ts"), sources.join("\n"));
  assert.deepEqual(directApiDiagnostics(project), []);
  const before = filesystemSnapshot(root), matrix = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
  assert.equal(matrix.ok, true); assert.equal(matrix.checks, 2); assert.equal(filesystemSnapshot(root), before);
  const outside = join(root, "outside"); mkdirSync(outside);
  writeFileSync(join(outside, "index.d.ts"), "export declare const value: 1;");
  symlinkSync(outside, join(project, "escape"), "junction");
  const refused = filesystemSnapshot(root);
  await assert.rejects(checkSdkContracts({consumer: project, minimum: bound, current: bound}), error => error instanceof SdkContractRefusal && error.code === "isolation_refused");
  assert.equal(filesystemSnapshot(root), refused);
});

/** Create a consumer using the installed compiler link without reconstructing its package identity. */
function consumerDirectory(root: string, tool = dirname(dirname(testCompiler()))): string {
  const modules = join(root, "consumer/node_modules");
  mkdirSync(modules, {recursive: true});
  symlinkSync(tool, join(modules, "typescript"), "junction");
  return dirname(modules);
}

/** Require a typed isolation refusal while returning its portable path guidance for case assertions. */
async function isolationFailure(options: Parameters<typeof checkSdkContracts>[0]): Promise<SdkContractRefusal> {
  try { await checkSdkContracts(options); }
  catch (error) {
    assert.ok(error instanceof SdkContractRefusal);
    assert.equal(error.code, "unsupported_project_shape");
    assert.equal(error.reason, "multiple_sdk_copies");
    return error;
  }
  return assert.fail("Expected a multiple_sdk_copies refusal");
}

/** An independent direct API program supplies verdicts without parsing compiler output. */
function plain(project: string): {ok: boolean; codes: string[]} {
  const diagnostics = directApiDiagnostics(project);
  return {ok: diagnostics.length === 0, codes: diagnostics.map(d => d.code)};
}

for (const version of ["shared 5.9.3", "5.9.3", "6.0.3"]) {
  test(`path transport property on stock TypeScript ${version}`, async t => {
    const root = mkdtempSync(join(tmpdir(), "sdk-path-transport-"));
    t.after(() => rmSync(root, {recursive: true, force: true}));
    const tool = version === "shared 5.9.3" ? dirname(dirname(testCompiler())) : join(root, "tool/node_modules/typescript");
    if (version !== "shared 5.9.3") installTestCompiler(join(root, "tool"), version);
    const project = consumerDirectory(root, tool);
    writeFileSync(join(project, "package.json"), '{"type":"module"}');
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], module: "NodeNext", strict: true}, files: ["consumer.ts"]}));
    const minimum = dependencyBound(join(root, "minimum")), current = dependencyBound(join(root, "current"));
    writeFileSync(join(current.root, "package.json"), JSON.stringify({name: "@unbrained/pm-cli", version: "2.0.0", types: "index.d.ts"})); current.version = "2.0.0";
    writeFileSync(join(current.root, "index.d.ts"), "export declare const onlyCurrent: 1;");
    mkdirSync(join(project, "node_modules/@unbrained"));
    symlinkSync(minimum.root, join(project, "node_modules/@unbrained/pm-cli"), "junction");
    writeFileSync(join(project, "consumer.ts"), 'import {onlyCurrent} from "@unbrained/pm-cli"; export {onlyCurrent};');
    assert.deepEqual(plain(project), {ok: false, codes: ["TS2305"]}, "selected minimum independently rejects the current-only API");
    const random = boundaryRandom(0x154275), count = version === "shared 5.9.3" ? 32 : 8;
    const names = ["plain", ...Array.from({length: count}, (_, index) => `${index % 8 === 4 ? "--" : ""}shape-${index}-${unusual[index % unusual.length]}-${random().toString(36)}`)];
    for (const name of names) {
      const foreign = join(root, name);
      dependencyEntry(root, name, "fixture", "export declare const onlyCurrent: 1;");
      symlinkSync(foreign, join(project, "node_modules/foreign-sdk"), "junction");
      writeFileSync(join(project, "consumer.ts"), 'import {onlyCurrent} from "foreign-sdk"; export {onlyCurrent};');
      assert.deepEqual(plain(project), {ok: true, codes: []}, JSON.stringify(name));
      const before = filesystemSnapshot(root);
      const matrix = await checkSdkContracts({consumer: project, minimum, current});
      assert.equal(matrix.ok, true, `ordinary installed dependency ${JSON.stringify(name)}`);
      assert.equal(filesystemSnapshot(root), before);
      const metadata = join(foreign, "package.json"), original = readFileSync(metadata, "utf8");
      writeFileSync(metadata, JSON.stringify({...JSON.parse(original), name: "@unbrained/pm-cli"}));
      const foreignBefore = filesystemSnapshot(root);
      const refusal = await isolationFailure({consumer: project, minimum, current});
      assert.ok(refusal.roots?.some(root => root.split("/").includes(name)), "structured refusal roots retain the complete directory component");
      assert.ok(refusal.roots?.every(root => !root.split("/").includes("..")), `external roots never become parent paths: ${JSON.stringify(refusal.roots)}`);
      assert.ok(!refusal.message.includes(basename(root)), "the remedy names no caller directory outside the SDK root");
      assert.equal(filesystemSnapshot(root), foreignBefore);
      rmSync(join(project, "node_modules/foreign-sdk"));
    }
    t.diagnostic(`Path transport: ${names.length} generated/plain names, ${names.length * 2} clean dependency rows and ${names.length} foreign-SDK refusals; all original snapshots unchanged.`);
  });
}

test("newline SDK directory review reproduction", async t => {
  const root = mkdtempSync(join(tmpdir(), "sdk-newline-review-")), project = consumerDirectory(root);
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const bound = dependencyBound(join(root, "outside\nSDK"));
  writeFileSync(join(project, "consumer.ts"), `export {sdk} from ${JSON.stringify(join(bound.root, "index.js"))};`);
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {module: "NodeNext", types: [], lib: ["ES5"]}, files: ["consumer.ts"]}));
  await assert.rejects(checkSdkContracts({consumer: project, minimum: bound, current: bound}), error => error instanceof SdkContractRefusal && error.code === "unsupported_project_shape");
});

test("JSON diagnostic locations retain every unusual path component", async t => {
  const root = mkdtempSync(join(tmpdir(), "sdk-path-diagnostic-"));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const project = consumerDirectory(root);
  const bound = dependencyBound(project);
  for (const component of [...unusual, "\nerror TS9999: forged\n"]) {
    const name = "input-" + component, file = name + "/consumer.ts";
    mkdirSync(join(project, name));
    writeFileSync(join(project, file), "export const value: string = 1;");
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"]}, files: [file]}));
    assert.deepEqual(directApiDiagnostics(project), [{code: "TS2322", file, line: 1, column: 14, message: "Type 'number' is not assignable to type 'string'."}]);
    const matrix = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
    for (const row of matrix.rows) assert.deepEqual(row.diagnostics, [{code: "TS2322", file, line: 1, column: 14, message: "Type 'number' is not assignable to type 'string'."}]);
  }
});

test("JSON inventory retains native missing-external-declaration diagnostics", async t => {
  const root = mkdtempSync(join(tmpdir(), "sdk-path-missing-")), project = consumerDirectory(root);
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const bound = dependencyBound(project), missing = join(root, "missing.d.ts");
  writeFileSync(join(project, "consumer.ts"), `/// <reference path=${JSON.stringify(missing)} />\nexport const value = 1;`);
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"]}, files: ["consumer.ts"]}));
  const expected = plain(project);
  assert.deepEqual(expected, {ok: false, codes: ["TS6053"]});
  const matrix = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
  for (const row of matrix.rows) { assert.equal(row.ok, expected.ok); assert.deepEqual(row.codes, expected.codes); }
});
