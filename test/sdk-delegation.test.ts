/** Real executable oracles for the four round-11 review reproductions. */
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, relative, resolve} from "node:path";
import test from "node:test";
import {checkSdkContracts, SdkContractRefusal} from "../sdk-contracts.ts";
import {dependencyBound, dependencyEntry, filesystemSnapshot, testCompiler, directApiDiagnostics} from "./dependency-fixtures.ts";

const compiler = testCompiler();

/** Compare structured consumer API diagnostics rather than rendered compiler headers. */
function oracle(project: string): {ok: boolean; exit_code: number; codes: string[]; diagnostics: ReturnType<typeof directApiDiagnostics>} {
  const diagnostics = directApiDiagnostics(project);
  return {ok: diagnostics.length === 0, exit_code: diagnostics.length ? 1 : 0, codes: diagnostics.map(d => d.code), diagnostics};
}

for (const shape of ["mutual external symlinks", "fatal emitDeclarationOnly", "noLib globals", "multiline type error", "missing input", "malformed config", "unicode diagnostic", "uninstalled compiler companion"]) {
  test(`round 11 real compiler differential: ${shape}`, async t => {
    const root = mkdtempSync(join(tmpdir(), "sdk-delegation-")), project = join(root, "consumer");
    t.after(() => rmSync(root, {recursive: true, force: true}));
    mkdirSync(join(project, "node_modules"), {recursive: true});
    symlinkSync(dirname(dirname(compiler)), join(project, "node_modules/typescript"), "junction");
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
    } else if (shape === "fatal emitDeclarationOnly") {
      options.emitDeclarationOnly = true;
      source = 'export const value: string = 1;';
    } else if (shape === "multiline type error") {
      source = 'declare const input: {value: number}; export const output: {value: string} = input;';
      Object.assign(options, {pretty: true, traceResolution: true, explainFiles: true, diagnostics: true, extendedDiagnostics: true, listFiles: true, listEmittedFiles: true});
    } else if (shape === "uninstalled compiler companion") {
      options.resolveJsonModule = true;
      source = 'import metadata from "@typescript/typescript-linux-x64/package.json" with {type: "json"}; export const name = metadata.name;';
    } else if (shape === "unicode diagnostic") { options.noUncheckedSideEffectImports = true; source = `import ${JSON.stringify("missing\r\u2028module")};`; }
    else options.noLib = true;
    writeFileSync(join(project, "consumer.mts"), source);
    const config = shape === "malformed config" ? "{ invalid" : JSON.stringify({compilerOptions: options, files: ["consumer.mts"]});
    writeFileSync(join(project, "tsconfig.json"), config);
    if (shape === "missing input") rmSync(join(project, "consumer.mts"));
    for (const present of shape === "uninstalled compiler companion" ? [false, true] : [false]) {
      if (present) {
        mkdirSync(join(project, "node_modules/@typescript"));
        symlinkSync(resolve(import.meta.dirname, "../node_modules/@typescript/typescript-linux-x64"), join(project, "node_modules/@typescript/typescript-linux-x64"), "junction");
      }
      const expected = oracle(project), before = filesystemSnapshot(root);
      const expectedCodes = shape === "mutual external symlinks" || present ? [] : shape === "fatal emitDeclarationOnly" ? ["TS2322", "TS5069"] : shape === "multiline type error" ? ["TS2322"] : shape === "uninstalled compiler companion" ? ["TS2307"] : Array<string>(8).fill("TS2318");
      if (shape === "malformed config" || shape === "missing input" || shape === "unicode diagnostic") assert.equal(expected.ok, false);
      else assert.deepEqual(expected.codes, expectedCodes);
      if (shape === "multiline type error") assert.match(expected.diagnostics[0]!.message, /\n  /);
      const matrix = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
      for (const row of matrix.rows) {
        assert.equal(row.ok, expected.ok);
        assert.equal(row.exit_code, expected.exit_code);
        assert.equal(row.diagnostic_count, expected.codes.length);
        assert.deepEqual(row.diagnostics, expected.diagnostics);
      }
      assert.equal(readFileSync(join(project, "tsconfig.json"), "utf8"), config);
      assert.equal(filesystemSnapshot(root), before, "compiler reads linked dependencies without modifying original inputs");
    }
  });
}


for (const shape of ["modules", "scope", "broken scope", "internal scope", "process home", "inline linked compiler", "bin only", "config link", "default cache", "directory cache", "outfile cache", "external cache", "dangling cache", "cyclic cache", "internal cache"]) {
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
    const config: Record<string, unknown> = {compilerOptions: options, files: ["consumer.mts"]};
    writeFileSync(join(project, "consumer.mts"), 'import {sdk} from "@unbrained/pm-cli"; export const use: "selected" = sdk;');
    if (shape === "modules" || shape === "scope") {
      const original = shape === "modules" ? modules : scope;
      // Move only this disposable fixture, then preserve its installed identity through a link.
      const external = join(shared, "installed"); renameSync(original, external); symlinkSync(external, original, "junction");
      writeFileSync(join(external, "fixture-file"), "retain non-package entries");
      symlinkSync(join(shared, "absent"), join(external, "broken"));
      if (shape === "modules") {
        const metadata = join(bound.root, "package.json"), linked = join(shared, "sdk-package.json");
        writeFileSync(linked, readFileSync(metadata)); rmSync(metadata);
        symlinkSync(linked, metadata);
      }
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
      } else if (shape === "dangling cache") {
        mkdirSync(join(project, "cache")); symlinkSync(join(shared, "missing"), join(project, "cache/state.tsbuildinfo"));
      } else if (shape === "cyclic cache") {
        mkdirSync(join(project, "cache")); symlinkSync("other", join(project, "cache/state.tsbuildinfo")); symlinkSync("state.tsbuildinfo", join(project, "cache/other"));
      } else symlinkSync(target, join(project, "cache"), "junction");
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
    if (shape === "bin only") await assert.rejects(check, error => error instanceof SdkContractRefusal && error.code === "compiler_unavailable");
    else if (["default cache", "directory cache", "outfile cache", "dangling cache", "external cache", "cyclic cache", "process home", "config link"].includes(shape)) {
      await assert.rejects(check, error => error instanceof SdkContractRefusal && error.code === "isolation_refused");
    } else {
      const matrix = await check;
      if (shape === "outfile cache") assert.equal(matrix.checks, 2);
      else assert.equal(matrix.ok, true, JSON.stringify(matrix.rows));
    }
    assert.equal(filesystemSnapshot(root), before, "shared SDK, dependency, config and cache bytes remain untouched");
  });
}
