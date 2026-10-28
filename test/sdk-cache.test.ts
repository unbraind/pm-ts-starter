/** Differential controls for warm consumer caches and independently compiled SDK bounds. */
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, relative, sep} from "node:path";
import test, {after} from "node:test";
import {checkSdkContracts, type SdkContractMatrix} from "../sdk-contracts.ts";
import {dependencyBound, filesystemSnapshot, installTestCompiler, directApiDiagnostics} from "./dependency-fixtures.ts";

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
function plain(entry: string, project: string): {ok: boolean; codes: string[]} {
  const result = spawnSync(process.execPath, [entry, "--project", "tsconfig.json", "--noEmit", "--pretty", "false"], {cwd: project, encoding: "utf8", timeout: 30000});
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  return {ok: result.status === 0, codes: directApiDiagnostics(project).map(d => d.code)};
}

/** Give native cache oracles incompatible minimum and compatible current declarations. */
function cacheBounds(root: string) {
  const current = dependencyBound(join(root, "current")), minimum = dependencyBound(join(root, "minimum"));
  const metadata = JSON.parse(readFileSync(join(current.root, "package.json"), "utf8")) as {name: string; version: string; types: string}; metadata.version = "2.0.0";
  writeFileSync(join(current.root, "package.json"), JSON.stringify(metadata)); current.version = "2.0.0";
  writeFileSync(join(minimum.root, "index.d.ts"), 'export declare const sdk: "minimum";');
  return {minimum, current};
}

for (const version of ["5.9.3", "6.0.3"]) for (const mode of ["project", "composite project"] as const) for (const custom of [false, true]) {
  test(`cache-free TypeScript ${version}: ${mode}, ${custom ? "custom target" : "tsbuildinfo"}`, async t => {
    const composite = mode === "composite project";
    const tool = compiler(version), entry = join(tool, "bin/tsc"), root = mkdtempSync(join(tmpdir(), "sdk-warm-cache-"));
    t.after(() => rmSync(root, {recursive: true, force: true}));
    const project = join(root, "warm"), sandbox = join(root, "sandbox"); mkdirSync(sandbox);
    const {minimum, current} = cacheBounds(root);
    mkdirSync(join(project, "node_modules/.bin"), {recursive: true}); mkdirSync(join(project, "reference"));
    cpSync(current.root, join(project, "node_modules/@unbrained/pm-cli"), {recursive: true});
    symlinkSync(tool, join(project, "node_modules/typescript"), "junction");
    writeFileSync(join(project, "package.json"), '{"type":"module"}');
    writeFileSync(join(project, "reference/index.ts"), 'import {sdk} from "@unbrained/pm-cli"; export const value: "current" = sdk;');
    const cache = custom ? "reference/compiler-state.cache" : "dist/tsconfig.tsbuildinfo";
    const options = {types: [], lib: ["ES5"], module: "NodeNext", rootDir: ".", outDir: "dist", ...composite ? {composite: true} : {incremental: true}, ...custom ? {tsBuildInfoFile: "reference/compiler-state.cache"} : {}};
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: options, files: ["reference/index.ts"]}));
    assert.deepEqual(plain(entry, project), {ok: true, codes: []});
    assert.ok(existsSync(join(project, cache)), "warm build created real compiler state");
    const caches = [cache, "unrelated.tsbuildinfo", "node_modules/cache-fixture/unused.tsbuildinfo"];
    mkdirSync(join(project, "node_modules/cache-fixture"));
    mkdirSync(join(project, "retained.tsbuildinfo")); writeFileSync(join(project, "retained.tsbuildinfo/resource"), "directory input");
    writeFileSync(join(project, caches[1]!), "unused cache"); writeFileSync(join(project, caches[2]!), "dependency cache");
    const cold = join(root, "cold"); cpSync(project, cold, {recursive: true});
    for (const cache of caches) rmSync(join(cold, cache));
    const expected: {ok: boolean; codes: string[]}[] = [];
    for (const [name, bound] of [["minimum", minimum], ["current", current]] as const) {
      const oracle = join(root, "oracle-" + name); cpSync(cold, oracle, {recursive: true});
      rmSync(join(oracle, "node_modules/@unbrained/pm-cli"), {recursive: true}); cpSync(bound.root, join(oracle, "node_modules/@unbrained/pm-cli"), {recursive: true});
      expected.push(plain(entry, oracle));
    }
    assert.deepEqual(expected, [{ok: false, codes: ["TS2322"]}, {ok: true, codes: []}]);
    const rows: SdkContractMatrix["rows"][] = [];
    const controls: boolean[][] = [];
    for (const consumer of [cold, project]) {
      const before = filesystemSnapshot(consumer), saved = process.env.TMPDIR;
      let scratch = "", bound = 0;
      try {
        process.env.TMPDIR = sandbox;
        const matrix = await checkSdkContracts({consumer, minimum, current, onProgress(phase) {
          if (phase === "allocated") scratch = join(sandbox, readdirSync(sandbox)[0]!);
          if (phase === "compiled") {
            const copy = join(scratch, bound++ === 0 ? "minimum" : "current");
            controls.push(caches.map(cache => existsSync(join(copy, cache))));
            assert.ok(existsSync(join(copy, "retained.tsbuildinfo/resource")), "cache suffix directories are preserved");
          }
        }});
        assert.deepEqual(matrix.rows.map(row => ({ok: row.ok, codes: row.diagnostics.map(diagnostic => diagnostic.code)})), expected);
        rows.push(matrix.rows);
      } finally { if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved; }
      assert.equal(filesystemSnapshot(consumer), before, "consumer caches, outputs and dependency metadata remain byte-identical");
    }
    assert.deepEqual(rows[0], rows[1], "warm and cold consumers produce identical complete bound matrices");
    for (const [index, receipt] of controls.entries()) {
      assert.deepEqual(receipt, caches.map(() => index >= 2), "cold and warm cache inputs are preserved rather than deleted");
    }
  });
}

for (const version of ["5.9.3", "6.0.3"]) for (const composite of [false, true]) for (const target of ["source", "configuration", "directory", "external"]) {
  test(`cache destination preserves ${target}: TypeScript ${version}, ${composite ? "composite" : "ordinary"}`, async t => {
    const root = mkdtempSync(join(tmpdir(), "sdk-cache-input-")), project = join(root, "consumer");
    t.after(() => rmSync(root, {recursive: true, force: true}));
    const {minimum, current} = cacheBounds(root);
    mkdirSync(join(project, "node_modules"), {recursive: true});
    cpSync(current.root, join(project, "node_modules/@unbrained/pm-cli"), {recursive: true});
    symlinkSync(join(compiler(version)), join(project, "node_modules/typescript"), "junction");
    writeFileSync(join(project, "package.json"), '{"type":"module"}');
    writeFileSync(join(project, "consumer.ts"), 'import {sdk} from "@unbrained/pm-cli"; export const value: "current" = sdk;');
    writeFileSync(join(project, "another.ts"), "export const valid = 1;");
    mkdirSync(join(project, "cache-directory")); writeFileSync(join(project, "cache-directory/retained"), "directory input");
    const external = join(root, "external-state.cache"); writeFileSync(external, "external input");
    const tsBuildInfoFile = target === "source" ? "consumer.ts" : target === "configuration" ? "tsconfig.json" : target === "directory" ? "cache-directory" : external;
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], module: "NodeNext", ...composite ? {composite: true} : {}, tsBuildInfoFile}, include: ["*.ts"]}));
    const expected: {ok: boolean; diagnostics: ReturnType<typeof directApiDiagnostics>}[] = [];
    for (const [name, bound] of [["minimum", minimum], ["current", current]] as const) {
      const oracle = join(root, "oracle-" + name); cpSync(project, oracle, {recursive: true});
      rmSync(join(oracle, "node_modules/@unbrained/pm-cli"), {recursive: true}); cpSync(bound.root, join(oracle, "node_modules/@unbrained/pm-cli"), {recursive: true});
      const diagnostics = directApiDiagnostics(oracle);
      expected.push({ok: diagnostics.length === 0, diagnostics});
    }
    assert.deepEqual(expected.map(row => row.ok), [false, true]);
    assert.deepEqual(expected[0]!.diagnostics.map(d => d.code), ["TS2322"]);
    const sandbox = join(root, "sandbox"); mkdirSync(sandbox);
    const before = filesystemSnapshot(project), outside = readFileSync(external);
    const saved = process.env.TMPDIR; let scratch = "", bound = "minimum";
    const copies: (Buffer | undefined)[][] = [], writerRoots: string[] = [];
    try {
      process.env.TMPDIR = sandbox;
      const inputs = ["consumer.ts", "another.ts", "tsconfig.json", "cache-directory/retained"];
      const matrix = await checkSdkContracts({consumer: project, minimum, current, onProgress(phase) {
        if (phase === "allocated") scratch = join(sandbox, readdirSync(sandbox)[0]!);
        if (phase === "compiled") {
          copies.push(inputs.map(input => existsSync(join(scratch, bound, input)) ? readFileSync(join(scratch, bound, input)) : undefined));
          writerRoots.push(...readdirSync(scratch).filter(name => name.startsWith("compiler-output-")));
          bound = "current";
        }
      }});
      assert.deepEqual(matrix.rows.map(row => ({ok: row.ok, diagnostics: row.diagnostics})), expected);
      assert.deepEqual(copies, [inputs.map(input => readFileSync(join(project, input))), inputs.map(input => readFileSync(join(project, input)))], "copied compiler inputs remain byte-identical");
      assert.ok(writerRoots.length > 0, "writer storage is outside the copied project");
      for (const name of writerRoots) assert.equal(relative(join(scratch, "minimum"), join(scratch, name)).split(sep)[0], "..");
    } finally { if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved; rmSync(sandbox, {recursive: true, force: true}); }
    assert.equal(filesystemSnapshot(project), before, "consumer inputs are never rewritten");
    assert.deepEqual(readFileSync(external), outside, "external input is never rewritten");
  });
}
