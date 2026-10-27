/** Differential controls for warm consumer caches and independently compiled SDK bounds. */
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test, {after} from "node:test";
import {checkSdkContracts, type SdkContractMatrix} from "../sdk-contracts.ts";
import {dependencyBound, filesystemSnapshot, installTestCompiler} from "./dependency-fixtures.ts";

const tools = new Map<string, string>();
after(() => { for (const root of tools.values()) rmSync(root, {recursive: true, force: true}); });
/** Install an unchanged stock compiler once per version, outside every consumer copy. */
function compiler(version: string): string {
  let root = tools.get(version);
  if (!root) {
    root = mkdtempSync(join(tmpdir(), "sdk-cache-compiler-")); tools.set(version, root);
    installTestCompiler(root, version);
  }
  return join(root, "node_modules/typescript");
}
/** Invoke the real compiler directly; no checker parsing or synthetic compiler diagnostics. */
function plain(entry: string, project: string, build: boolean, emit: boolean): {ok: boolean; codes: string[]} {
  const result = spawnSync(process.execPath, [entry, build ? "--build" : "--project", "tsconfig.json", ...emit ? [] : ["--noEmit"], "--pretty", "false"], {cwd: project, encoding: "utf8", timeout: 30000});
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  return {ok: result.status === 0, codes: [...result.stdout.matchAll(/error (TS\d+):/g)].map(match => match[1]!)};
}

for (const version of ["5.9.3", "6.0.3"]) for (const mode of ["reference build", "project", "composite project"] as const) for (const custom of [false, true]) {
  test(`cache-free TypeScript ${version}: ${mode}, ${custom ? "custom target" : "tsbuildinfo"}`, async t => {
    const build = mode === "reference build", composite = mode === "composite project";
    const tool = compiler(version), entry = join(tool, "bin/tsc"), root = mkdtempSync(join(tmpdir(), "sdk-warm-cache-"));
    t.after(() => rmSync(root, {recursive: true, force: true}));
    const project = join(root, "warm"), sandbox = join(root, "sandbox"); mkdirSync(sandbox);
    const current = dependencyBound(join(root, "current")), minimum = dependencyBound(join(root, "minimum"));
    const metadata = JSON.parse(readFileSync(join(current.root, "package.json"), "utf8")) as {name: string; version: string; types: string}; metadata.version = "2.0.0";
    writeFileSync(join(current.root, "package.json"), JSON.stringify(metadata)); current.version = "2.0.0";
    writeFileSync(join(minimum.root, "index.d.ts"), 'export declare const sdk: "minimum";');
    mkdirSync(join(project, "node_modules/.bin"), {recursive: true}); mkdirSync(join(project, "reference"));
    cpSync(current.root, join(project, "node_modules/@unbrained/pm-cli"), {recursive: true});
    symlinkSync(tool, join(project, "node_modules/typescript"), "junction");
    writeFileSync(join(project, "package.json"), '{"type":"module"}');
    writeFileSync(join(project, "reference/index.ts"), 'import {sdk} from "@unbrained/pm-cli"; export const value: "current" = sdk;');
    const cache = custom ? "reference/compiler-state.cache" : build ? "reference/dist/tsconfig.tsbuildinfo" : "dist/tsconfig.tsbuildinfo";
    const options = {types: [], lib: ["ES5"], module: "NodeNext", rootDir: ".", outDir: "dist", ...build || composite ? {composite: true} : {incremental: true}, ...custom ? {tsBuildInfoFile: "reference/compiler-state.cache"} : {}};
    if (build) {
      writeFileSync(join(project, "reference/tsconfig.json"), JSON.stringify({compilerOptions: {...options, ...custom ? {tsBuildInfoFile: "compiler-state.cache"} : {}}, files: ["index.ts"]}));
      writeFileSync(join(project, "tsconfig.json"), JSON.stringify({files: [], references: [{path: "reference"}]}));
    } else {
      if (composite) {
        mkdirSync(join(project, "dependency"));
        writeFileSync(join(project, "dependency/index.ts"), "export const dependency = 1;");
        writeFileSync(join(project, "dependency/tsconfig.json"), JSON.stringify({compilerOptions: {composite: true, types: [], lib: ["ES5"], module: "NodeNext", outDir: "dist"}, files: ["index.ts"]}));
        assert.deepEqual(plain(entry, join(project, "dependency"), true, true), {ok: true, codes: []});
        writeFileSync(join(project, "reference/index.ts"), 'import {dependency} from "../dependency/index.js"; import {sdk} from "@unbrained/pm-cli"; export const value: "current" = sdk; export {dependency};');
      }
      writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: options, files: ["reference/index.ts"], ...composite ? {references: [{path: "dependency"}]} : {}}));
    }
    assert.deepEqual(plain(entry, project, build, false), {ok: true, codes: []});
    assert.ok(existsSync(join(project, cache)), "warm build created real compiler state");
    const caches = [cache, "unrelated.tsbuildinfo", "node_modules/cache-fixture/unused.tsbuildinfo", ...composite ? ["dependency/dist/tsconfig.tsbuildinfo"] : []];
    mkdirSync(join(project, "node_modules/cache-fixture"));
    mkdirSync(join(project, "retained.tsbuildinfo")); writeFileSync(join(project, "retained.tsbuildinfo/resource"), "directory input");
    writeFileSync(join(project, caches[1]!), "unused cache"); writeFileSync(join(project, caches[2]!), "dependency cache");
    writeFileSync(join(project, "node_modules/.bin/package.json"), '{"type":"commonjs"}');
    writeFileSync(join(project, "node_modules/.bin/tsc"), `const fs=require('node:fs'),cp=require('node:child_process');
const args=process.argv.slice(2); if(!args.some(a=>['--help','--showConfig','--listFilesOnly'].includes(a))) fs.appendFileSync('.cache-proof.jsonl',JSON.stringify({args,caches:${JSON.stringify(caches)}.map(p=>fs.existsSync(p))})+'\\n');
const run=cp.spawnSync(process.execPath,[${JSON.stringify(entry)},...args],{stdio:'inherit'});process.exit(run.status??1);`);
    const cold = join(root, "cold"); cpSync(project, cold, {recursive: true});
    for (const cache of caches) rmSync(join(cold, cache));
    const expected: {ok: boolean; codes: string[]}[] = [];
    for (const [name, bound] of [["minimum", minimum], ["current", current]] as const) {
      const oracle = join(root, "oracle-" + name); cpSync(cold, oracle, {recursive: true});
      rmSync(join(oracle, "node_modules/@unbrained/pm-cli"), {recursive: true}); cpSync(bound.root, join(oracle, "node_modules/@unbrained/pm-cli"), {recursive: true});
      expected.push(plain(entry, oracle, build, false));
    }
    assert.deepEqual(expected, [{ok: false, codes: ["TS2322"]}, {ok: true, codes: []}]);
    const rows: SdkContractMatrix["rows"][] = [];
    const controls: {args: string[]; caches: boolean[]}[] = [];
    for (const consumer of [cold, project]) {
      const before = filesystemSnapshot(consumer), saved = process.env.TMPDIR;
      let scratch = "", bound = 0;
      try {
        process.env.TMPDIR = sandbox;
        const matrix = await checkSdkContracts({consumer, minimum, current, onProgress(phase) {
          if (phase === "allocated") scratch = join(sandbox, readdirSync(sandbox)[0]!);
          if (phase === "compiled") {
            const receipts = readFileSync(join(scratch, bound++ === 0 ? "minimum" : "current", ".cache-proof.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line) as {args: string[]; caches: boolean[]});
            assert.equal(receipts.length, 1);
            controls.push(...receipts);
            assert.ok(existsSync(join(scratch, bound === 1 ? "minimum" : "current", "retained.tsbuildinfo/resource")), "cache suffix directories are preserved");
          }
        }});
        assert.deepEqual(matrix.rows.map(row => ({ok: row.ok, codes: row.diagnostics.map(diagnostic => diagnostic.code)})), expected);
        rows.push(matrix.rows);
      } finally { if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved; }
      assert.equal(filesystemSnapshot(consumer), before, "consumer caches, outputs and dependency metadata remain byte-identical");
    }
    assert.deepEqual(rows[0], rows[1], "warm and cold consumers produce identical complete bound matrices");
    for (const receipt of controls) {
      assert.deepEqual(receipt.caches, caches.map(() => false), "every compiler invocation starts without copied caches");
      if (build) assert.ok(receipt.args.includes("--force"));
      else if (composite) assert.ok(receipt.args.includes("--tsBuildInfoFile"), "composite project metadata is isolated without changing reference checking");
      else assert.equal(receipt.args[receipt.args.indexOf("--incremental") + 1], "false");
    }
  });
}

for (const target of ["configuration", "directory", "external"]) test(`cache targets cannot replace ${target}`, async t => {
  const root = mkdtempSync(join(tmpdir(), "sdk-cache-target-")), project = join(root, "consumer");
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const bound = dependencyBound(project);
  symlinkSync(new URL("../node_modules/typescript", import.meta.url).pathname, join(project, "node_modules/typescript"), "junction");
  mkdirSync(join(project, "reference")); mkdirSync(join(project, "reference/cache-directory"));
  writeFileSync(join(project, "reference/index.ts"), "export const value = 1;");
  writeFileSync(join(project, "reference/tsconfig.json"), JSON.stringify({compilerOptions: {types: [], tsBuildInfoFile: target === "configuration" ? "tsconfig.json" : "cache-directory"}, files: ["index.ts"]}));
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({files: [], references: [{path: "reference"}]}));
  const cache = join(root, "external-state.cache"); writeFileSync(cache, "retain external state");
  if (target === "external") {
    writeFileSync(join(project, "consumer.mts"), 'import {sdk} from "@unbrained/pm-cli"; export const value: "current" = sdk;');
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], module: "NodeNext", incremental: true, tsBuildInfoFile: cache}, files: ["consumer.mts"]}));
  }
  const before = filesystemSnapshot(root), run = checkSdkContracts({consumer: project, minimum: bound, current: bound});
  if (target === "external") assert.equal((await run).ok, true);
  else await assert.rejects(run, error => error instanceof Error && "code" in error && error.code === "isolation_refused");
  assert.equal(filesystemSnapshot(root), before);
});
