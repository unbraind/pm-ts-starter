/** Real executable oracles for the four round-11 review reproductions. */
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, relative, resolve} from "node:path";
import test from "node:test";
import {checkSdkContracts, SdkContractRefusal, type SdkContractDiagnostic} from "../sdk-contracts.ts";
import {dependencyBound, dependencyEntry, filesystemSnapshot} from "./dependency-fixtures.ts";

const compiler = resolve(import.meta.dirname, "../node_modules/typescript/bin/tsc");

/** Independently decode tsc headers; compare complete locations and messages, not only codes. */
function oracle(project: string, build = false): {ok: boolean; exit_code: number; diagnostics: SdkContractDiagnostic[]} {
  const display = ["pretty", "diagnostics", "extendedDiagnostics", "traceResolution", "explainFiles", "listFiles", "listEmittedFiles"].flatMap(flag => [`--${flag}`, String(false)]);
  const args = [build ? "--build" : "--project", "tsconfig.json", "--noEmit", ...display, ...build ? [] : ["--locale", "en"]];
  const run = spawnSync(process.execPath, [compiler, ...args], {cwd: project, encoding: "utf8"});
  assert.equal(run.error, undefined);
  assert.equal(run.signal, null);
  assert.ok(run.status !== null);
  const diagnostics: SdkContractDiagnostic[] = [];
  for (const block of run.stdout.trimEnd().split(/(?=^(?:[^\n]*\(\d+,\d+\): )?error TS\d+:)/m)) {
    const [line = "", ...continuations] = block.trimEnd().split(/\r?\n/);
    const split = line.indexOf(": error TS");
    const global = line.startsWith("error TS");
    if (!global && split < 0) continue;
    const header = global ? "" : line.slice(0, split);
    const position = /^(.*)\((\d+),(\d+)\)$/.exec(header);
    const text = global ? line : line.slice(split + 2), separator = text.indexOf(": ");
    const code = text.slice(6, separator), message = text.slice(separator + 2);
    diagnostics.push({code, file: position ? relative(project, resolve(project, position[1]!)).replaceAll("\\", "/") : "<config>",
      line: Number(position?.[2] ?? 0), column: Number(position?.[3] ?? 0), message: [message, ...continuations].join("\n").replaceAll(project, ".")});
  }
  return {ok: run.status === 0, exit_code: run.status, diagnostics};
}

for (const shape of ["mutual external symlinks", "unbuilt composite reference", "fatal emitDeclarationOnly", "noLib globals", "multiline type error", "reference-only solution", "reference-only cycle", "missing input", "malformed config", "unicode diagnostic", "missing reference", "uninstalled compiler companion"]) {
  test(`round 11 real compiler differential: ${shape}`, async t => {
    const root = mkdtempSync(join(tmpdir(), "sdk-delegation-")), project = join(root, "consumer");
    t.after(() => rmSync(root, {recursive: true, force: true}));
    mkdirSync(join(project, "node_modules"), {recursive: true});
    symlinkSync(resolve(import.meta.dirname, "../node_modules/typescript"), join(project, "node_modules/typescript"), "junction");
    const bound = dependencyBound(project);
    const options: Record<string, unknown> = {types: [], module: "NodeNext", noEmit: true};
    let source = "export const value = 1;";
    if (shape === "mutual external symlinks") {
      for (const name of ["a", "b"]) {
        dependencyEntry(root, name, `fixture-${name}`, name === "a" ? 'export declare const a: 1; export {b} from "fixture-b";' : 'import type {a} from "fixture-a"; export declare const b: typeof a;');
        mkdirSync(join(root, name, "node_modules"));
        symlinkSync(join(root, name), join(project, "node_modules", `fixture-${name}`), "junction");
      }
      symlinkSync(join(root, "b"), join(root, "a/node_modules/fixture-b"), "junction");
      symlinkSync(join(root, "a"), join(root, "b/node_modules/fixture-a"), "junction");
      symlinkSync(join(root, "missing"), join(project, "node_modules/unreferenced-broken-link"));
      source = 'import {a,b} from "fixture-a"; export const value: typeof a = b;';
    } else if (shape === "unbuilt composite reference" || shape === "reference-only solution" || shape === "reference-only cycle") {
      mkdirSync(join(project, "reference"));
      writeFileSync(join(project, "reference/index.ts"), shape === "reference-only solution" ? "export const value: string = 1;" : "export const value = 1;");
      writeFileSync(join(project, "reference/tsconfig.json"), JSON.stringify({compilerOptions: {composite: true, types: [], outDir: "dist"}, files: ["index.ts"]}));
      source = 'import {value} from "./reference/index.js"; export {value};';
      if (shape === "reference-only cycle") {
        mkdirSync(join(project, "other"));
        writeFileSync(join(project, "other/index.ts"), "export const other = 1;");
        writeFileSync(join(project, "other/tsconfig.json"), JSON.stringify({compilerOptions: {composite: true, types: []}, files: ["index.ts"], references: [{path: "../reference"}]}));
        writeFileSync(join(project, "reference/tsconfig.json"), JSON.stringify({compilerOptions: {composite: true, types: []}, files: ["index.ts"], references: [{path: "../other"}]}));
      }
    } else if (shape === "fatal emitDeclarationOnly") {
      options.emitDeclarationOnly = true;
      source = 'export const value: string = 1;';
    } else if (shape === "multiline type error") {
      source = 'declare const input: {value: number}; export const output: {value: string} = input;';
      Object.assign(options, {pretty: true, traceResolution: true, explainFiles: true, diagnostics: true, extendedDiagnostics: true, listFiles: true, listEmittedFiles: true});
    } else if (shape === "uninstalled compiler companion") {
      options.resolveJsonModule = true;
      source = 'import metadata from "@typescript/typescript-linux-x64/package.json" with {type: "json"}; export const name = metadata.name;';
    } else if (shape === "unicode diagnostic") source = `import ${JSON.stringify("missing\r\u2028module")};`;
    else options.noLib = true;
    writeFileSync(join(project, "consumer.mts"), source);
    const config = shape === "malformed config" ? "{ invalid" : JSON.stringify({compilerOptions: options, files: (shape.startsWith("reference-only") || shape === "missing reference") ? [] : ["consumer.mts"], references: shape === "missing reference" ? [{path: "missing.json"}] : shape === "unbuilt composite reference" || shape.startsWith("reference-only") ? [{path: "reference"}] : undefined});
    writeFileSync(join(project, "tsconfig.json"), config);
    if (shape === "missing input") rmSync(join(project, "consumer.mts"));
    for (const present of shape === "uninstalled compiler companion" ? [false, true] : [false]) {
      if (present) {
        mkdirSync(join(project, "node_modules/@typescript"));
        symlinkSync(resolve(import.meta.dirname, "../node_modules/@typescript/typescript-linux-x64"), join(project, "node_modules/@typescript/typescript-linux-x64"), "junction");
      }
      const expected = oracle(project, shape.startsWith("reference-only") || shape === "missing reference"), before = filesystemSnapshot(root);
      const expectedCodes = shape === "mutual external symlinks" || present ? [] : shape === "unbuilt composite reference" ? ["TS6305"] : shape === "fatal emitDeclarationOnly" ? ["TS5069"] : shape === "multiline type error" ? ["TS2322"] : shape === "uninstalled compiler companion" ? ["TS2307"] : Array<string>(10).fill("TS2318");
      if (shape === "malformed config" || shape === "missing input" || shape === "unicode diagnostic" || shape === "missing reference") assert.equal(expected.ok, false);
      else if (shape.startsWith("reference-only")) assert.ok(expected.diagnostics.some(row => row.code === (shape === "reference-only cycle" ? "TS6202" : "TS2322")));
      else assert.deepEqual(expected.diagnostics.map(row => row.code), expectedCodes);
      if (shape === "multiline type error") assert.match(expected.diagnostics[0]!.message, /\n/);
      const matrix = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
      for (const row of matrix.rows) {
        assert.equal(row.ok, expected.ok);
        assert.equal(row.exit_code, expected.exit_code);
        assert.equal(row.diagnostic_count, expected.diagnostics.length);
        assert.deepEqual(row.diagnostics, expected.diagnostics);
      }
      assert.equal(readFileSync(join(project, "tsconfig.json"), "utf8"), config);
      assert.equal(filesystemSnapshot(root), before, "compiler reads linked dependencies without modifying original inputs");
    }
  });
}


for (const shape of ["modules", "scope", "broken scope", "internal scope", "process home", "inline linked compiler", "bin only", "config link", "default cache", "directory cache", "outfile cache", "build cache", "external cache", "dangling cache", "cyclic cache", "internal cache", "external reference", "linked reference"]) {
  test(`write boundary retains original inputs: ${shape}`, async t => {
    const root = mkdtempSync(join(tmpdir(), "sdk-write-boundary-")), project = join(root, "consumer"), shared = join(root, "shared");
    t.after(() => rmSync(root, {recursive: true, force: true}));
    mkdirSync(join(project, "node_modules"), {recursive: true}); mkdirSync(shared);
    const bound = dependencyBound(join(root, "selected"));
    writeFileSync(join(bound.root, "index.d.ts"), 'export declare const sdk: "selected";');
    dependencyBound(project);
    const modules = join(project, "node_modules"), scope = join(modules, "@unbrained");
    symlinkSync(resolve(compiler, "../.."), join(modules, "typescript"), "junction");
    const options: Record<string, unknown> = {types: [], module: "NodeNext"};
    let config: Record<string, unknown> = {compilerOptions: options, files: ["consumer.mts"]};
    writeFileSync(join(project, "consumer.mts"), 'import {sdk} from "@unbrained/pm-cli"; export const use: "selected" = sdk;');
    if (shape === "modules" || shape === "scope") {
      const original = shape === "modules" ? modules : scope;
      // Move only this disposable fixture, then preserve its installed identity through a link.
      const external = join(shared, "installed"); renameSync(original, external); symlinkSync(external, original, "junction");
      writeFileSync(join(external, "fixture-file"), "retain non-package entries");
      symlinkSync(join(shared, "absent"), join(external, "broken"));
    } else if (shape === "broken scope" || shape === "internal scope") {
      rmSync(scope, {recursive: true});
      const destination = shape === "internal scope" ? join(project, "local-scope") : join(shared, "missing");
      if (shape === "internal scope") mkdirSync(destination);
      symlinkSync(destination, scope, "junction");
    } else if (shape === "process home") {
      symlinkSync(shared, join(project, ".sdk-process"), "junction");
      writeFileSync(join(shared, "npmrc"), "registry=https://registry.npmjs.org/\nignore-scripts=false\n");
      symlinkSync(join(shared, "npmrc"), join(project, ".npmrc"));
    } else if (shape === "inline linked compiler") {
      symlinkSync(resolve(import.meta.dirname, "../node_modules/@types"), join(modules, "@types"), "junction");
      symlinkSync(resolve(import.meta.dirname, "../node_modules/undici-types"), join(modules, "undici-types"), "junction");
    } else if (shape === "bin only") {
      rmSync(join(modules, "typescript")); mkdirSync(join(modules, ".bin"));
      symlinkSync(compiler, join(modules, ".bin/tsc"));
    } else if (shape.includes("cache")) {
      Object.assign(options, {incremental: true, tsBuildInfoFile: "cache/state.tsbuildinfo"});
      const target = shape === "internal cache" ? join(project, "local-cache") : shared;
      if (shape === "internal cache") mkdirSync(target);
      if (shape === "default cache") {
        delete options.tsBuildInfoFile; symlinkSync(join(shared, "state.tsbuildinfo"), join(project, "tsconfig.tsbuildinfo"));
      } else if (["directory cache", "outfile cache"].includes(shape)) {
        delete options.tsBuildInfoFile;
        if (shape === "directory cache") { options.outDir = "dist"; mkdirSync(join(project, "dist")); }
        else { options.outFile = "bundle.js"; options.module = "System"; }
        symlinkSync(join(shared, "state.tsbuildinfo"), join(project, shape === "directory cache" ? "dist/tsconfig.tsbuildinfo" : "bundle.tsbuildinfo"));
      } else if (shape === "build cache") {
        delete options.incremental; delete options.tsBuildInfoFile;
        mkdirSync(join(project, "reference"));
        writeFileSync(join(project, "reference/index.ts"), "export const value = 1;");
        writeFileSync(join(project, "reference/tsconfig.json"), JSON.stringify({compilerOptions: {types: []}, files: ["index.ts"]}));
        symlinkSync(join(shared, "state.tsbuildinfo"), join(project, "reference/tsconfig.tsbuildinfo"));
        config = {compilerOptions: options, files: [], references: [{path: "reference"}]};
      } else if (shape === "dangling cache") {
        mkdirSync(join(project, "cache")); symlinkSync(join(shared, "missing"), join(project, "cache/state.tsbuildinfo"));
      } else if (shape === "cyclic cache") {
        mkdirSync(join(project, "cache")); symlinkSync("other", join(project, "cache/state.tsbuildinfo")); symlinkSync("state.tsbuildinfo", join(project, "cache/other"));
      } else symlinkSync(target, join(project, "cache"), "junction");
    } else if (shape.includes("reference")) {
      writeFileSync(join(shared, "tsconfig.json"), JSON.stringify({compilerOptions: {composite: true, types: []}, files: ["index.ts"]}));
      writeFileSync(join(shared, "index.ts"), "export const value = 1;");
      if (shape === "linked reference") symlinkSync(shared, join(project, "reference"), "junction");
      config = {compilerOptions: options, files: [], references: [{path: shape === "linked reference" ? "reference" : "../shared"}]};
    }
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify(config));
    if (shape === "config link") {
      writeFileSync(join(shared, "config.json"), JSON.stringify(config)); rmSync(join(project, "tsconfig.json"));
      symlinkSync(join(shared, "config.json"), join(project, "tsconfig.json"));
    }
    const before = filesystemSnapshot(root);
    const check = shape === "inline linked compiler"
      ? checkSdkContracts({compiler: join(modules, "typescript/bin/tsc"), minimum: bound, current: bound, examples: [{id: "minimal", source: "export const value = 1;"}]})
      : checkSdkContracts({consumer: project, minimum: bound, current: bound});
    if (["default cache", "directory cache", "outfile cache", "build cache", "external cache", "dangling cache", "cyclic cache", "external reference", "linked reference", "process home", "config link"].includes(shape)) {
      await assert.rejects(check, error => error instanceof SdkContractRefusal && error.code === "isolation_refused");
    } else {
      const matrix = await check;
      assert.equal(matrix.ok, true, JSON.stringify(matrix.rows));
    }
    assert.equal(filesystemSnapshot(root), before, "shared SDK, dependency, config and cache bytes remain untouched");
  });
}
