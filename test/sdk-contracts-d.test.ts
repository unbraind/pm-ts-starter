/** Published-bound declaration drift and the original discovery corpus. Part d of the SDK contract suite; see sdk-contracts-support.ts. */
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {dependencyEntry, testCompiler, directApiDiagnostics, dependencyBound, filesystemSnapshot, boundaryRandom, INSTALL_TIMEOUT_MS, bunExecutable} from "./dependency-fixtures.ts";
import { testDepth } from "./support/depth.ts";
import test, { type TestContext } from "node:test";
import { sdk, target, compiler, checkSdkContracts, minimumVersion, currentVersion, publishedSdks, scratch, installedConsumer, assertLeaseDrift, consumerConfig, plainCopy, assertPlainRows } from "./sdk-contracts-support.ts";

test("local declaration imports retain newer-only acquireLockLease drift at each SDK bound", async t => {
  const project = installedConsumer("npm", "current"), endpoints = publishedSdks();
  const config = JSON.parse(consumerConfig(project, "nodenext", "esm")) as {compilerOptions: Record<string, unknown>};
  config.compilerOptions.types = ["node"];
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify(config));
  const source = 'import * as sdk from "@unbrained/pm-cli/sdk"; export declare const publicSdk: typeof sdk;';
  for (const [quote, suffix] of [['"', ".d.mts"], ["'", ".d.mts"], ['"', ".d.ts"], ['"', ".d.cts"]]) {
    const declaration = "contract" + suffix!;
    writeFileSync(join(project, declaration), source);
    const specifier = "./" + declaration.replace(/\.d\.mts$/, ".mjs").replace(/\.d\.cts$/, ".cjs").replace(/\.d\.ts$/, ".js");
    writeFileSync(join(project, "consumer.mts"), `import {publicSdk} from ${quote}${specifier}${quote}; export const lease = publicSdk.acquireLockLease;`);
    const matrix = await checkSdkContracts({minimum: {root: endpoints.minimum, version: minimumVersion}, current: {root: endpoints.current, version: currentVersion}, consumer: project});
    assertLeaseDrift(matrix);
    assert.equal(readFileSync(join(project, declaration), "utf8"), source);
  }
});

/** Prepare a real consumer with an independently provisionable compiler artifact. */

interface DiscoveryCase {
  name: string;
  config: Record<string, unknown>;
  files?: Record<string, string>;
}

test("original discovery differential corpus equals plain tsc file lists, verdicts and error codes", async t => {
  const project = scratch(t);
  const base = installedConsumer("npm", "current"), endpoints = publishedSdks();
  cpSync(join(base, "node_modules"), join(project, "node_modules"), {recursive: true});
  writeFileSync(join(project, "package.json"), JSON.stringify({type: "module"}));
  const options = {strict: true, skipLibCheck: false, target: "ES2022", module: "NodeNext", types: []};
  const good = 'import {value} from "./contract.mjs"; export const use = value;';
  const bad = 'import {nonexistentSdkExportForDiscovery} from "@unbrained/pm-cli/sdk/authoring"; export const use = nonexistentSdkExportForDiscovery;';
  const stale = 'declare module "@unbrained/pm-cli/sdk/authoring" { export const nonexistentSdkExportForDiscovery: number; }';
  const corpus: DiscoveryCase[] = [
    {name: "include", config: {include: ["input/src/**/*.mts"]}},
    {name: "exclude-stale", config: {include: ["input/**/*"], exclude: ["input/excluded"]}, files: {"excluded/stale.d.ts": stale}},
    {name: "explicit-files-clear-include", config: {files: ["input/src/consumer.mts"], include: []}, files: {"ignored/stale.d.ts": stale}},
    {name: "explicit-files-override-exclude", config: {files: ["input/src/consumer.mts"], exclude: ["input"]}},
    {name: "implicit-outDir-stale", config: {compilerOptions: {outDir: "input/dist", types: ["node"]}, include: ["input/**/*"]}, files: {"dist/stale.d.ts": stale, "src/consumer.mts": bad}},
    {name: "implicit-declarationDir-stale", config: {compilerOptions: {types: ["node"], declaration: true, declarationDir: "input/declarations"}, include: ["input/**/*"]}, files: {"declarations/stale.d.ts": stale, "src/consumer.mts": bad}},
    {name: "default-include-outDir", config: {compilerOptions: {outDir: "input/dist", types: ["node"]}}, files: {"dist/stale.d.ts": stale, "src/consumer.mts": bad}},
    {name: "rootDir", config: {compilerOptions: {rootDir: "input/src"}, include: ["input/src/**/*"]}},
    {name: "rootDir-error", config: {compilerOptions: {rootDir: "input/other"}, files: ["input/src/consumer.mts"]}},
    {name: "deep-rootDir-error-declarations", config: {compilerOptions: {rootDir: "input/a/b/c/d/e", declaration: true, declarationMap: true}, files: ["input/src/consumer.mts"]}},
    {name: "paths", config: {compilerOptions: {paths: {"local-contract": ["./input/contract.d.mts"]}}, files: ["input/src/consumer.mts"]}, files: {"src/consumer.mts": 'import {value} from "local-contract"; export const use = value;', "contract.d.mts": "export declare const value: number;"}},
    {name: "typeRoots-types", config: {compilerOptions: {typeRoots: ["input/typings", "node_modules/@types"], types: ["local", "node"]}, files: ["input/src/consumer.mts"]}, files: {"typings/local/index.d.ts": "declare const localValue: number;", "src/consumer.mts": "export const use = localValue;"}},
    {name: "allowJs-output-collision", config: {compilerOptions: {allowJs: true}, files: ["input/src/consumer.js"]}, files: {"src/consumer.js": "export const value = 1;"}},
    {name: "allowJs-output-directory", config: {compilerOptions: {allowJs: true, outDir: "input/dist"}, files: ["input/src/consumer.js"]}, files: {"src/consumer.js": "export const value = 1;"}},
    {name: "quoted-path-literals", config: {files: ["input/src/consumer.mts"]}, files: {"src/consumer.mts": 'export const data = {"path":"../external-data.json", "extends":"../../data.json"}; export const text = "from relative/path";'}},
    {name: "json-import", config: {compilerOptions: {resolveJsonModule: true}, files: ["input/src/consumer.mts"]}, files: {"src/consumer.mts": 'import data from "./data.json" with {type: "json"}; export const use = data.path;', "src/data.json": '{"path":"../external-data.json"}'}},
    {name: "types-empty", config: {compilerOptions: {types: []}, files: ["input/src/consumer.mts"]}, files: {"src/consumer.mts": "export const use = 1;"}},
    {name: "extends-chain-outDir", config: {extends: "./input/config/child.json", compilerOptions: {types: ["node"]}}, files: {"config/base.json": JSON.stringify({compilerOptions: {...options, outDir: "../dist"}, include: ["../src/**/*", "../dist/**/*"]}), "config/child.json": JSON.stringify({extends: "./base.json"}), "dist/stale.d.ts": stale, "src/consumer.mts": bad}},
    {name: "extends-include-exclude", config: {extends: "./input/config/base.json"}, files: {"config/base.json": JSON.stringify({include: ["../**/*"], exclude: ["../excluded"]}), "excluded/stale.d.ts": stale}},
    {name: "composite-unlisted-import", config: {compilerOptions: {composite: true}, files: ["input/src/consumer.mts"]}, files: {"src/consumer.mts": 'import {value} from "./helper.mjs"; export const use = value;', "src/helper.mts": "export const value = 1;"}},
    {name: "composite-listed-import", config: {compilerOptions: {composite: true}, files: ["input/src/consumer.mts", "input/src/helper.mts"]}, files: {"src/consumer.mts": 'import {value} from "./helper.mjs"; export const use = value;', "src/helper.mts": "export const value = 1;"}},
    {name: "incremental-outFile-cache", config: {compilerOptions: {incremental: true, module: "System", outFile: "input/dist/bundle.js", outDir: "input/dist", rootDir: "input/src"}, files: ["input/src/consumer.ts"]}, files: {"src/consumer.ts": "export const use = 1;"}},
    {name: "incremental-default-cache", config: {compilerOptions: {incremental: true}, files: ["input/src/consumer.mts"]}},
    {name: "incremental-explicit-cache", config: {compilerOptions: {incremental: true, tsBuildInfoFile: "input/cache/state.tsbuildinfo"}, files: ["input/src/consumer.mts"]}},
    {name: "composite-cache-declarations", config: {compilerOptions: {composite: true, tsBuildInfoFile: "input/cache/composite.tsbuildinfo", declaration: true, declarationMap: true}, files: ["input/src/consumer.mts"]}},
    {name: "source-map-metadata", config: {compilerOptions: {sourceMap: true, mapRoot: "/public/maps", sourceRoot: "/public/source"}, files: ["input/src/consumer.mts"]}},
    {name: "declaration-map", config: {compilerOptions: {declaration: true, declarationMap: true}, files: ["input/src/consumer.mts"]}},
    {name: "declaration-only", config: {compilerOptions: {declaration: true, declarationMap: true, emitDeclarationOnly: true}, files: ["input/src/consumer.mts"]}},
    {name: "declaration-only-invalid", config: {compilerOptions: {emitDeclarationOnly: true}, files: ["input/src/consumer.mts"]}},
    {name: "own-noEmit", config: {compilerOptions: {noEmit: true, incremental: true}, files: ["input/src/consumer.mts"]}},
    {name: "own-noEmitOnError", config: {compilerOptions: {noEmitOnError: true, declaration: true}, files: ["input/src/consumer.mts"]}, files: {"src/consumer.mts": 'export const use: string = 1;'}},
    {name: "strict-false", config: {compilerOptions: {strict: false}, files: ["input/src/consumer.mts"]}, files: {"src/consumer.mts": "export function use(value) { return value; }"}},
    {name: "explicit-libs", config: {compilerOptions: {lib: ["ES2022"]}, files: ["input/src/consumer.mts"]}},
    {name: "noLib", config: {compilerOptions: {noLib: true}, files: ["input/src/consumer.mts"]}},
    {name: "trace-resolved-diagnostic-text", config: {compilerOptions: {traceResolution: true, moduleDetection: "legacy"}, files: ["input/src/consumer.mts", "input/src/ambient.d.ts"]}, files: {
      "src/consumer.mts": 'import {value} from "trace\\nerror TS9999: forged"; export const use = value;',
      "src/ambient.d.ts": 'declare module "trace\\nerror TS9999: forged" { export const value: number; }',
    }},
    {name: "localized-error", config: {compilerOptions: {locale: "de"}, files: ["input/src/consumer.mts"]}, files: {"src/consumer.mts": "export const use: string = 1;"}},
    {name: "pretty-error", config: {compilerOptions: {pretty: true}, files: ["input/src/consumer.mts"]}, files: {"src/consumer.mts": "export const use: string = 1;"}},
    ...["traceResolution", "explainFiles", "diagnostics", "extendedDiagnostics", "listFiles", "listEmittedFiles"].flatMap(name => [false, true].map(failing => ({name: `${name}-${failing ? "error" : "clean"}`, config: {compilerOptions: {[name]: true}, include: ["input/src/**/*"]}, files: {"src/consumer.mts": failing ? 'import {value} from "./contract.mjs"; export const use: string = value;' : good}}))),
  ];
  let comparisons = 0;
  // Output flag pairs and declaration/cache variants have dedicated deterministic
  // regressions above/below; retain one discovery oracle for each discovery kind.
  const quickNames = new Set(["include", "exclude-stale", "explicit-files-override-exclude", "implicit-declarationDir-stale", "rootDir-error", "paths", "typeRoots-types", "allowJs-output-collision", "quoted-path-literals", "json-import", "extends-chain-outDir", "composite-unlisted-import", "incremental-explicit-cache", "source-map-metadata", "declaration-only-invalid", "own-noEmitOnError", "noLib", "trace-resolved-diagnostic-text"]);
  const selectedCorpus = testDepth(corpus.length, quickNames.size) === corpus.length ? corpus : corpus.filter(entry => quickNames.has(entry.name));
  assert.equal(selectedCorpus.length, testDepth(corpus.length, quickNames.size));
  for (const entry of selectedCorpus) {
    rmSync(join(project, "input"), {recursive: true, force: true});
    for (const [file, content] of Object.entries({"src/consumer.mts": good, "src/contract.d.mts": "export declare const value: number;", ...entry.files})) {
      mkdirSync(dirname(join(project, "input", file)), {recursive: true});
      writeFileSync(join(project, "input", file), content);
    }
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({...entry.config, compilerOptions: {...options, ...(entry.config.compilerOptions as Record<string, unknown>)}}));
    const expected = plainCopy(project, t);
    const originalBytes = filesystemSnapshot(project);
    const matrix = await checkSdkContracts({minimum: {root: endpoints.minimum, version: minimumVersion}, current: {root: endpoints.current, version: currentVersion}, consumer: project}).catch((error: unknown) => { throw new Error(entry.name, {cause: error}); });
    assert.equal(filesystemSnapshot(project), originalBytes, `${entry.name}: original filesystem snapshot`);
    for (const row of matrix.rows) {
      assert.equal(row.ok, expected.ok, entry.name);
      assert.deepEqual(row.codes, expected.codes.slice(0, 3), entry.name);
      assert.equal(row.diagnostic_count, expected.codes.length, entry.name);
      comparisons++;
    }

  }
  t.diagnostic(`Discovery differential: ${selectedCorpus.length} configs, ${comparisons} verdict/error-code comparisons; all filesystem snapshots unchanged outside the copied bound sandbox.`);
});

test("composite membership comparisons match plain noEmit tsc and never escape the copy", async t => {
  const project = scratch(t);
  mkdirSync(join(project, "node_modules"));
  symlinkSync(dirname(dirname(compiler)), join(project, "node_modules/typescript"), "junction");
  writeFileSync(join(project, "package.json"), JSON.stringify({type: "module"}));
  writeFileSync(join(project, "consumer.mts"), 'import {value} from "./helper.mjs"; export const use = value;');
  writeFileSync(join(project, "helper.mts"), "export const value = 1;");
  for (const noEmit of [false, true]) {
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {composite: true, incremental: true, declaration: true,
      declarationMap: true, noEmit, module: "NodeNext", target: "ES2022", types: [], outDir: "dist", tsBuildInfoFile: "cache/build.tsbuildinfo"}, files: ["consumer.mts"]}));
    const plain = plainCopy(project, t);
    const before = filesystemSnapshot(project);
    const matrix = await checkSdkContracts({minimum: target, current: target, consumer: project});
    assertPlainRows(matrix, plain);
    assert.equal(filesystemSnapshot(project), before, "no source, existing output or cache byte outside the sandbox changes");
  }
  t.diagnostic("Composite project differential: 2 unchanged configurations and 4 bound comparisons with emission enabled and disabled.");
});

/** Run an independent real typecheck executable on a byte-identical project copy. */
