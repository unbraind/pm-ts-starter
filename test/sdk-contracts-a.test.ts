/** Compiler-isolation, project-copy and supplementary-output contracts. Part a of the SDK contract suite; see sdk-contracts-support.ts. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {dependencyEntry, testCompiler, directApiDiagnostics, dependencyBound, filesystemSnapshot, boundaryRandom, INSTALL_TIMEOUT_MS, bunExecutable} from "./dependency-fixtures.ts";
import { SdkContractRefusal } from "../sdk-contracts.ts";
import { testDepth } from "./support/depth.ts";
import test, { type TestContext } from "node:test";
import { sdk, pinned, target, compiler, checkSdkContracts, scratch, refuses, installedConsumer, declarationLayout, consumerConfig, linkedCompilerConsumer, noEmitConsumer, plainProject, plainCopy, assertPlainRows } from "./sdk-contracts-support.ts";

test("all supplementary output options preserve plain compiler verdicts and unchanged caller metadata", async t => {
  const project = linkedCompilerConsumer(t);
  for (const name of ["traceResolution", "explainFiles", "diagnostics", "extendedDiagnostics", "listFiles", "listEmittedFiles"]) {
    for (const failing of [false, true].slice(0, testDepth(2, 1))) {
      writeFileSync(join(project, "consumer.mts"), failing ? "export const use: string = 1;" : "export const use = 1;");
      writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {target: "ES2022", module: "NodeNext", types: [], [name]: true, outDir: "dist"}, files: ["consumer.mts"]}));
      const plain = plainProject(project);
      const before = filesystemSnapshot(project);
      const matrix = await checkSdkContracts({minimum: target, current: target, consumer: project});
      const codes = directApiDiagnostics(project).map(d => d.code);
      for (const row of matrix.rows) {
        assert.equal(row.ok, plain.status === 0, name);
        assert.deepEqual(row.codes, codes, name);
      }
      assert.equal(filesystemSnapshot(project), before, name);
    }
  }
  t.diagnostic(`${6 * testDepth(2, 1)} supplementary configurations and ${12 * testDepth(2, 1)} bound comparisons agree with plain tsc; caller metadata remains unchanged.`);
});

test("post-compile isolation refuses resolved external inputs and preserves native missing-input diagnostics", async t => {
  const root = scratch(t), project = installedConsumer("npm", "current");
  const config = consumerConfig(project, "nodenext", "esm");
  const external = join(root, "external.d.mts"); writeFileSync(external, "export declare const value: number;");
  const outside = external.replace(/\.d\.mts$/, ".mjs");
  writeFileSync(join(project, "bridge.d.mts"), `export {value} from ${JSON.stringify(outside)};`);
  for (const source of [`import {value} from ${JSON.stringify(outside)}; export const use = value;`,
    `/// <reference path=${JSON.stringify(external)} />\nexport const use = 1;`,
    'import {value} from "./bridge.mjs"; export const use = value;']) {
    writeFileSync(join(project, "consumer.mts"), source);
    await assert.rejects(checkSdkContracts({minimum: target, current: target, consumer: project}), error => {
      if (!(error instanceof SdkContractRefusal)) return false;
      assert.match(error.remedy, /Resolved file .*external\.d\.mts/);
      assert.doesNotMatch(error.remedy, /sdk-consumer-test/);
      return error.code === "isolation_refused";
    });
  }
  for (const source of [`export * from ${JSON.stringify(join(root, "missing.mjs"))};`,
    `/// <reference path=${JSON.stringify(join(root, "missing.d.ts"))} />\nexport const use = 1;`]) {
    writeFileSync(join(project, "consumer.mts"), source);
    const plain = plainProject(project);
    const matrix = await checkSdkContracts({minimum: target, current: target, consumer: project});
    assert.ok(matrix.rows.every(row => !row.ok));
    for (const row of matrix.rows) assert.deepEqual(row.codes, directApiDiagnostics(project).map(d => d.code));
  }
  writeFileSync(join(project, "consumer.mts"), "export const use = 1;");
  for (const patch of [{paths: {unused: [external]}}, {typeRoots: [root]}, {baseUrl: root}, {rootDirs: [root]}, {rootDir: root}]) {
    const changed = JSON.parse(config) as {compilerOptions: Record<string, unknown>}; Object.assign(changed.compilerOptions, patch);
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify(changed));
    const matrix = await checkSdkContracts({minimum: target, current: target, consumer: project});
    assertPlainRows(matrix, plainCopy(project, t));
  }
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({...JSON.parse(config), files: [external]}));
  await assert.rejects(checkSdkContracts({minimum: target, current: target, consumer: project}), refuses("isolation_refused"));
  const alternate = join(project, "vendor/alternate-sdk");
  declarationLayout(alternate, pinned, "types");
  writeFileSync(join(project, "tsconfig.json"), config);
  writeFileSync(join(project, "consumer.mts"), 'export {api} from "./vendor/alternate-sdk/import.js";');
  await assert.rejects(checkSdkContracts({minimum: target, current: target, consumer: project}), error => {
    assert.ok(error instanceof SdkContractRefusal);
    assert.match(error.remedy, /vendor\/alternate-sdk/);
    return error.code === "unsupported_project_shape";
  });
});

test("project copies preserve declaration module kind, nested imports and reference directives", async t => {
  const project = linkedCompilerConsumer(t);
  writeFileSync(join(project, "package.json"), JSON.stringify({type: "module"}));
  const selected = {root: declarationLayout(join(scratch(t), "sdk"), pinned, "types"), version: pinned};
  cpSync(selected.root, join(project, "node_modules/@unbrained/pm-cli"), {recursive: true});
  writeFileSync(join(project, "leaf.d.ts"), 'import {api} from "@unbrained/pm-cli/sdk"; export declare const use: typeof api.onlyImport;');
  writeFileSync(join(project, "parent.d.mts"), 'export {use} from "./leaf.js";');
  writeFileSync(join(project, "globals.d.mts"), "export {}; declare global { type ReferenceValue = number; }");
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], module: "NodeNext", noEmit: true}, files: ["consumer.mts"]}));
  for (const source of [
    'import {use} from "./leaf.js"; import {use as again} from "./leaf.js"; export const value = [use, again, "/"];',
    'import {use} from "./parent.mjs"; export const value = use;',
    '/// <reference path="./globals.d.mts" />\nexport const value: ReferenceValue = 1;',
  ]) {
    writeFileSync(join(project, "consumer.mts"), source);
    const expected = plainCopy(project, t);
    const matrix = await checkSdkContracts({minimum: selected, current: selected, consumer: project});
    assert.equal(matrix.ok, true); assert.equal(matrix.checks, 2);
    assertPlainRows(matrix, expected);
    assert.equal(readFileSync(join(project, "consumer.mts"), "utf8"), source);
  }
});

test("inline sources are unchanged; actual external declarations refuse after compiler resolution", async t => {
  const root = scratch(t), declaration = join(root, "external.d.mts");
  writeFileSync(declaration, 'export declare const value: number;');
  const source = `import {value} from ${JSON.stringify(declaration.replace(".d.mts", ".mjs"))}; export const use = value;`;
  await assert.rejects(checkSdkContracts({minimum: target, current: target, examples: [{id: "external", source}]}), error => {
    assert.ok(error instanceof SdkContractRefusal);
    assert.match(error.remedy, /Resolved file .*external\.d\.mts/);
    return error.code === "isolation_refused";
  });
  const missing = await checkSdkContracts({minimum: target, current: target, examples: [{id: "missing", source: `export * from ${JSON.stringify(join(root, "missing.mjs"))};`}]});
  assert.ok(missing.rows.every(row => !row.ok && row.codes.includes("TS2307")));
  const literals = await checkSdkContracts({minimum: target, current: target, examples: [{id: "literal", source: 'export const data = `from "/ordinary/data.js"`;'}]});
  assert.equal(literals.ok, true, "path-like string content must reach the compiler unchanged");
});

test("hermetic unused internal aliases and existing declarations agree with plain tsc", async t => {
  const root = scratch(t), reference = join(root, "reference");
  mkdirSync(join(root, "node_modules")); mkdirSync(reference);
  symlinkSync(dirname(dirname(compiler)), join(root, "node_modules/typescript"), "junction");
  writeFileSync(join(root, "package.json"), JSON.stringify({type: "module"}));
  writeFileSync(join(reference, "tsconfig.json"), JSON.stringify({compilerOptions: {composite: true, target: "ES2022", module: "NodeNext", types: [], outDir: "dist"}, files: ["index.ts"]}));
  writeFileSync(join(reference, "index.ts"), "export const value = 1;");
  const build = spawnSync(process.execPath, [compiler, "--build", "reference"], {cwd: root, encoding: "utf8"}); assert.equal(build.status, 0, build.stdout);
  const config = JSON.parse(consumerConfig(root, "nodenext", "esm")) as {compilerOptions: Record<string, unknown>};
  Object.assign(config.compilerOptions, {paths: {unused: ["./reference/index.ts"]}, typeRoots: ["./node_modules/@types"], rootDirs: ["."]});
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify(config));
  writeFileSync(join(root, "consumer.mts"), 'import {value} from "./reference/dist/index.js"; import {version} from "typescript"; export const use = {value, version};');
  const plain = plainCopy(root, t); assert.equal(plain.ok, true);
  const matrix = await checkSdkContracts({minimum: target, current: target, consumer: root});
  assert.equal(matrix.ok, plain.ok); assert.equal(matrix.checks, 2);

});

test("hermetic inherited config preserves alias origins and explicit libraries against plain tsc", async t => {
  const root = scratch(t), configRoot = join(root, "config");
  mkdirSync(configRoot); mkdirSync(join(root, "node_modules"));
  symlinkSync(dirname(dirname(compiler)), join(root, "node_modules/typescript"), "junction");
  writeFileSync(join(root, "package.json"), JSON.stringify({type: "module"}));
  writeFileSync(join(configRoot, "base.json"), JSON.stringify({compilerOptions: {target: "ES2022", module: "NodeNext", strict: true, types: [], lib: ["ES2022"], paths: {inherited: ["./contract.d.mts"]}}}));
  writeFileSync(join(configRoot, "contract.d.mts"), "export declare const value: number;");
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({extends: "./config/base.json", files: ["consumer.mts"]}));
  writeFileSync(join(root, "consumer.mts"), 'import {value} from "inherited"; export const use = value;');
  const plain = plainCopy(root, t);
  assert.equal(plain.ok, true);
  const before = filesystemSnapshot(root);
  const matrix = await checkSdkContracts({minimum: target, current: target, consumer: root});
  assert.equal(matrix.ok, plain.ok); assert.equal(matrix.checks, 2);
  assert.equal(filesystemSnapshot(root), before);
});

test("new compiler options do not require checker classification", async t => {
  const project = noEmitConsumer(t);
  for (const extra of [{erasableSyntaxOnly: true}, {futureCheckingOption: true}]) {
    const config = JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], ...extra}, files: ["consumer.mts"]});
    writeFileSync(join(project, "tsconfig.json"), config);
    const expected = directApiDiagnostics(project), before = filesystemSnapshot(project);
    const matrix = await checkSdkContracts({consumer: project, minimum: target, current: target});
    for (const row of matrix.rows) assert.deepEqual(row.diagnostics, expected);
    assert.equal(filesystemSnapshot(project), before);
  }
});



/** Each corpus member changes original discovery or diagnostic presentation independently. */
interface DiscoveryCase {
  name: string;
  config: Record<string, unknown>;
  files?: Record<string, string>;
}
