/** Real executable oracles for the four round-11 review reproductions. */
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, relative, resolve} from "node:path";
import test from "node:test";
import {checkSdkContracts, type SdkContractDiagnostic} from "../sdk-contracts.ts";
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
    const error = (global ? line : line.slice(split + 2)).match(/^error (TS\d+): (.*)$/)!;
    diagnostics.push({code: error[1]!, file: position ? relative(project, resolve(project, position[1]!)).replaceAll("\\", "/") : "<config>",
      line: Number(position?.[2] ?? 0), column: Number(position?.[3] ?? 0), message: [error[2]!, ...continuations].join("\n").replaceAll(project, ".")});
  }
  return {ok: run.status === 0, exit_code: run.status, diagnostics};
}

for (const shape of ["mutual external symlinks", "unbuilt composite reference", "fatal emitDeclarationOnly", "noLib globals", "multiline type error", "reference-only solution", "reference-only cycle", "missing input", "malformed config"]) {
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
    } else options.noLib = true;
    writeFileSync(join(project, "consumer.mts"), source);
    const config = shape === "malformed config" ? "{ invalid" : JSON.stringify({compilerOptions: options, files: shape.startsWith("reference-only") ? [] : ["consumer.mts"], references: shape === "unbuilt composite reference" || shape.startsWith("reference-only") ? [{path: "reference"}] : undefined});
    writeFileSync(join(project, "tsconfig.json"), config);
    if (shape === "missing input") rmSync(join(project, "consumer.mts"));
    const expected = oracle(project, shape.startsWith("reference-only")), before = filesystemSnapshot(root);
    const expectedCodes = shape === "mutual external symlinks" ? [] : shape === "unbuilt composite reference" ? ["TS6305"] : shape === "fatal emitDeclarationOnly" ? ["TS5069"] : shape === "multiline type error" ? ["TS2322"] : Array<string>(10).fill("TS2318");
    if (shape === "malformed config" || shape === "missing input") assert.equal(expected.ok, false);
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
  });
}
