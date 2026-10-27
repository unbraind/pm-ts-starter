/** Generated filesystem names exercise lossless compiler path transport and canonical isolation. */
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, parse, resolve} from "node:path";
import test from "node:test";
import {checkSdkContracts, SdkContractRefusal} from "../sdk-contracts.ts";
import {boundaryRandom, dependencyBound, dependencyEntry, filesystemSnapshot, installTestCompiler} from "./dependency-fixtures.ts";

const unusual = ["\n", "\r", "\t", " ", "--leading", "'", '"', "é漢字"];

/** Create a consumer using the installed compiler link without reconstructing its package identity. */
function consumerDirectory(root: string, tool = resolve(import.meta.dirname, "../node_modules/typescript")): string {
  const modules = join(root, "consumer/node_modules");
  mkdirSync(modules, {recursive: true});
  symlinkSync(tool, join(modules, "typescript"), "junction");
  return dirname(modules);
}

/** A clean real compiler invocation independent of the checker's trace and diagnostic decoding. */
function plain(project: string, compiler: string) {
  const run = spawnSync(process.execPath, [compiler, "-p", "tsconfig.json", "--noEmit", "--pretty", "false"], {cwd: project, encoding: "utf8", timeout: 30000});
  assert.equal(run.error, undefined);
  assert.equal(run.signal, null);
  return {ok: run.status === 0, codes: [...run.stdout.matchAll(/error (TS\d+):/g)].map(match => match[1])};
}

for (const version of ["pinned", "5.9.3", "6.0.3"]) {
  test(`path transport property on stock TypeScript ${version}`, async t => {
    const root = mkdtempSync(join(tmpdir(), "sdk-path-transport-"));
    t.after(() => rmSync(root, {recursive: true, force: true}));
    const tool = version === "pinned" ? resolve(import.meta.dirname, "../node_modules/typescript") : join(root, "tool/node_modules/typescript");
    if (version !== "pinned") installTestCompiler(join(root, "tool"), version);
    const compiler = join(tool, "bin/tsc"), project = consumerDirectory(root, tool);
    writeFileSync(join(project, "package.json"), '{"type":"module"}');
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], module: "NodeNext", strict: true}, files: ["consumer.ts"]}));
    const minimum = dependencyBound(join(root, "minimum")), current = dependencyBound(join(root, "current"));
    writeFileSync(join(current.root, "package.json"), JSON.stringify({name: "@unbrained/pm-cli", version: "2.0.0", types: "index.d.ts"})); current.version = "2.0.0";
    writeFileSync(join(current.root, "index.d.ts"), "export declare const onlyCurrent: 1;");
    mkdirSync(join(project, "node_modules/@unbrained"));
    symlinkSync(minimum.root, join(project, "node_modules/@unbrained/pm-cli"), "junction");
    writeFileSync(join(project, "consumer.ts"), 'import {onlyCurrent} from "@unbrained/pm-cli"; export {onlyCurrent};');
    assert.deepEqual(plain(project, compiler), {ok: false, codes: ["TS2305"]}, "selected minimum independently rejects the current-only API");
    const random = boundaryRandom(0x154275), count = version === "pinned" ? 32 : 8;
    const names = ["plain", ...Array.from({length: count}, (_, index) => `${index % 8 === 4 ? "--" : ""}shape-${index}-${unusual[index % unusual.length]}-${random().toString(36)}`)];
    for (const name of names) {
      const foreign = join(root, name);
      dependencyEntry(root, name, "fixture", "export declare const onlyCurrent: 1;");
      symlinkSync(foreign, join(project, "node_modules/foreign-sdk"), "junction");
      writeFileSync(join(project, "consumer.ts"), 'import {onlyCurrent} from "foreign-sdk"; export {onlyCurrent};');
      assert.deepEqual(plain(project, compiler), {ok: true, codes: []}, JSON.stringify(name));
      const before = filesystemSnapshot(root);
      const matrix = await checkSdkContracts({consumer: project, minimum, current});
      assert.equal(matrix.ok, true, `ordinary installed dependency ${JSON.stringify(name)}`);
      assert.equal(filesystemSnapshot(root), before);
      const metadata = join(foreign, "package.json"), original = readFileSync(metadata, "utf8");
      writeFileSync(metadata, JSON.stringify({...JSON.parse(original), name: "@unbrained/pm-cli"}));
      const foreignBefore = filesystemSnapshot(root);
      await assert.rejects(checkSdkContracts({consumer: project, minimum, current}), error => {
        assert.ok(error instanceof SdkContractRefusal);
        assert.equal(error.code, "isolation_refused", JSON.stringify(name));
        assert.ok(error.remedy.includes(JSON.stringify(name)), "typed refusal names the complete escaped directory component");
        return true;
      });
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
  await assert.rejects(checkSdkContracts({consumer: project, minimum: bound, current: bound}), error => error instanceof SdkContractRefusal && error.code === "isolation_refused");
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
    const direct = spawnSync(process.execPath, [resolve(import.meta.dirname, "../node_modules/typescript/bin/tsc"), "-p", "tsconfig.json", "--noEmit", "--pretty", "false"], {cwd: project, encoding: "utf8"});
    assert.notEqual(direct.status, 0);
    assert.equal(direct.stdout.trimEnd(), `${file}(1,14): error TS2322: Type 'number' is not assignable to type 'string'.`);
    const matrix = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
    for (const row of matrix.rows) assert.deepEqual(row.diagnostics, [{code: "TS2322", file, line: 1, column: 14, message: "Type 'number' is not assignable to type 'string'."}]);
  }
});

test("JSON compiler inventories refuse unrepresentable entries with named typed errors", async t => {
  const root = mkdtempSync(join(tmpdir(), "sdk-path-invalid-")), project = join(root, "consumer");
  t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(join(project, "node_modules/.bin"), {recursive: true});
  symlinkSync(resolve(import.meta.dirname, "../node_modules/typescript"), join(project, "node_modules/typescript"), "junction");
  symlinkSync(join(root, "missing"), join(project, "node_modules/broken"));
  writeFileSync(join(project, "node_modules/.bin/package.json"), '{"type":"commonjs"}');
  writeFileSync(join(project, "consumer.ts"), "export const value = 1;");
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"]}, files: ["consumer.ts"]}));
  const bound = dependencyBound(project);
  for (const shape of ["object", "null event", "no args", "missing", "number", "relative", "directory", "root missing", "absent inside", "dangling", "unknown diagnostic", "unknown suffix diagnostic"] as const) {
    const expression = shape === "missing" ? "undefined" : shape === "number" ? "42" : shape === "relative" ? "'ambiguous\\nfile.ts'" : shape === "directory" ? "process.cwd()" : shape === "root missing" ? JSON.stringify(join(parse(root).root, "missing-compiler-input-fixture.d.ts")) : shape === "absent inside" ? "path.join(process.cwd(),'missing-source.ts')" : "path.join(process.cwd(),'node_modules/broken/file.ts')";
    const compiler = resolve(import.meta.dirname, "../node_modules/typescript/bin/tsc");
    writeFileSync(join(project, "node_modules/.bin/tsc"), `const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const args=process.argv.slice(2), index=args.indexOf('--generateTrace');
if(index>=0 && !${JSON.stringify(shape)}.startsWith('unknown')){fs.writeFileSync(path.join(args[index+1],'trace.json'),JSON.stringify(${JSON.stringify(shape)}==='object'?{}:${JSON.stringify(shape)}==='null event'?[null]:${JSON.stringify(shape)}==='no args'?[{name:'createSourceFile'}]:[{name:'createSourceFile',args:{path:${expression}}}]));process.exit(0);}
if(${JSON.stringify(shape)}.startsWith('unknown') && !args.includes('--help') && !args.includes('--showConfig')){process.stdout.write(${JSON.stringify(shape === 'unknown suffix diagnostic' ? 'untrackedconsumer.ts(1,1): error TS2322: invalid location\n' : 'unknown\nfile.ts(1,1): error TS2322: invalid location\n')});process.exit(1);}
const run=cp.spawnSync(process.execPath,[${JSON.stringify(compiler)},...args],{stdio:'inherit'});process.exit(run.status??1);`);
    await assert.rejects(checkSdkContracts({consumer: project, minimum: bound, current: bound}), error => {
      assert.ok(error instanceof SdkContractRefusal);
      assert.equal(error.code, "isolation_refused");
      assert.match(error.remedy, /path|destination|Resolved file/);
      if (shape === "root missing") assert.ok(error.remedy.includes(JSON.stringify("missing-compiler-input-fixture.d.ts")));
      assert.equal(error.remedy.includes(join(tmpdir(), "pm-sdk-contract-")), false);
      if (shape === "absent inside") assert.match(error.remedy, /missing-source\.ts/);
      if (shape === "relative") assert.ok(error.remedy.includes(JSON.stringify("ambiguous\nfile.ts")));
      return true;
    });
  }
});

test("JSON inventory retains native missing-external-declaration diagnostics", async t => {
  const root = mkdtempSync(join(tmpdir(), "sdk-path-missing-")), project = consumerDirectory(root);
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const bound = dependencyBound(project), missing = join(root, "missing.d.ts");
  writeFileSync(join(project, "consumer.ts"), `/// <reference path=${JSON.stringify(missing)} />\nexport const value = 1;`);
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"]}, files: ["consumer.ts"]}));
  const expected = plain(project, resolve(import.meta.dirname, "../node_modules/typescript/bin/tsc"));
  assert.deepEqual(expected, {ok: false, codes: ["TS6053"]});
  const matrix = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
  for (const row of matrix.rows) { assert.equal(row.ok, expected.ok); assert.deepEqual(row.codes, expected.codes); }
});
