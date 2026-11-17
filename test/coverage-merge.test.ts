/** Compare actual offset-based hit unions against an unsharded runtime report. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runCoverageGate, mergeCoverageShards, runScriptEntry } from "../scripts/coverage-gate.ts";

/** Give real coverage fixtures the same required source scope and strict thresholds. */
function writeCoverageConfig(root: string): void {
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", coverageGate: {
    sources: ["src"], tests: ["test/*.test.ts"], thresholds: { lines: 100, branches: 100, functions: 100 },
  } }));
}

test("sharded coverage equals unsharded including one-shard branches and functions", t => {
  const root = mkdtempSync(join(tmpdir(), "coverage union-"));
  t.after(() => rmSync(root, {recursive:true,force:true}));
  mkdirSync(join(root,"test"));
  mkdirSync(join(root,"src"));
  writeCoverageConfig(root);
  writeFileSync(join(root,"src/value.ts"), `export function classify(value: number) {
  if (value > 0) return positive();
  return negative();
}
export function positive() { return "positive"; }
export function negative() { return "negative"; }
`);
  for (const [name,value,expected] of [["a",1,"positive"],["b",-1,"negative"]] as const) writeFileSync(join(root,`test/${name}.test.ts`), `import test from 'node:test'; import assert from 'node:assert/strict'; import {classify} from '../src/value.ts'; test('${name}',()=>assert.equal(classify(${value}), '${expected}'));`);
  for (const [shard,output] of [["1/1","whole"],["1/2","first"],["2/2","second"],["1/1",join(root,"absolute-whole")]]) assert.equal(runCoverageGate(root,"ignore",{shard,output}),0);
  const paths=["first/hits.json","second/hits.json"];
  const merged=mergeCoverageShards(root,paths,["src/value.ts"]);
  const absolutePaths = paths.map(path => join(root, path));
  assert.deepEqual(mergeCoverageShards(root,absolutePaths,["src/value.ts"]),merged);
  assert.deepEqual(JSON.parse(readFileSync(join(root,"absolute-whole","hits.json"),"utf8")).files,
    JSON.parse(readFileSync(join(root,"whole","hits.json"),"utf8")).files);
  assert.equal(runCoverageGate(root,"ignore",{merge:absolutePaths}),0);
  // This report came directly from Node's native reporter, without merge conversion.
  const whole=JSON.parse(readFileSync(join(root,"whole/hits.json"),"utf8")) as typeof merged;
  assert.ok(whole.files.length > 0);
  for (const path of paths) {
    const shard=JSON.parse(readFileSync(join(root,path),"utf8"));
    assert.deepEqual([...new Set(shard.raw.map((script: {url:string})=>script.url))],["src/value.ts"]);
    assert.deepEqual(shard.files.map((file: {path:string})=>file.path),["src/value.ts"]);
  }
  const covered=(report: typeof merged) => report.files.map(file => ({...file, path:relative(root,isAbsolute(file.path) ? file.path : join(root,file.path)).replaceAll("\\","/"), lines:(file.lines as {line:number;count:number}[]).map(hit=>({...hit,count:Number(hit.count>0)})), branches:(file.branches as {line:number;count:number}[]).map(hit=>({...hit,count:Number(hit.count>0)})), functions:(file.functions as {name:string;line:number;count:number}[]).map(hit=>({...hit,count:Number(hit.count>0)}))}));
  assert.deepEqual(covered(merged),covered(whole));
  for(const path of paths) { const shard=JSON.parse(readFileSync(join(root,path),"utf8")); assert.ok(shard.files[0].functions.some((hit:{count:number})=>hit.count===0)); assert.ok(shard.files[0].branches.some((hit:{count:number})=>hit.count===0)); }
  assert.equal(runCoverageGate(root,"ignore",{merge:paths}),0);
  const savedArgv=process.argv, savedExit=process.exit;
  let status: number | undefined;
  process.exit=((code?:number)=>{status=code;}) as typeof process.exit;
  try {
    for(const args of [["--shard","1/2","--output","cli"],["--shard","1/2","--output",join(root,"absolute-cli")],["--merge",...paths],["--merge",...absolutePaths]]) {
      process.argv=[savedArgv[0]!,fileURLToPath(new URL("../scripts/coverage-gate.ts",import.meta.url)),...args];
      runScriptEntry(root);assert.equal(status,0);
    }
  } finally {process.argv=savedArgv;process.exit=savedExit;}
  const secondSaved=readFileSync(join(root,paths[1]!),"utf8");
  const sameHalf=JSON.parse(readFileSync(join(root,paths[0]!),"utf8"));sameHalf.shard="2/2";
  writeFileSync(join(root,paths[1]!),JSON.stringify(sameHalf));
  assert.equal(runCoverageGate(root,"ignore",{merge:paths}),1,"partial union must retain the original 100 percent threshold");
  writeFileSync(join(root,paths[1]!),secondSaved);
  assert.throws(()=>runCoverageGate(root,"ignore",{shard:"1/2"}),/missing shard report or output/);
  const saved=readFileSync(join(root,paths[0]!),"utf8");
  const change=(mutate:(artifact: {digest:string;node:string;raw:{url:string;functions?:unknown}[]})=>void) => {const artifact=JSON.parse(saved);mutate(artifact);writeFileSync(join(root,paths[0]!),JSON.stringify(artifact));};
  change(artifact=>{artifact.digest="wrong"});assert.throws(()=>mergeCoverageShards(root,paths,["src/value.ts"]),/source mismatch/);
  change(artifact=>{artifact.node=process.versions.node.replace(/\d+$/, patch => String(Number(patch) + 1))});
  assert.deepEqual(mergeCoverageShards(root,paths,["src/value.ts"]),merged,"patch differences must preserve the native coverage union");
  change(artifact=>{artifact.node=process.versions.node.startsWith("26.") ? "22.0.0" : "26.0.0"});assert.throws(()=>mergeCoverageShards(root,paths,["src/value.ts"]),/runtime mismatch/);
  change(artifact=>{artifact.raw[0].functions=null});assert.throws(()=>mergeCoverageShards(root,paths,["src/value.ts"]),/native merge failed/);
  change(artifact=>{artifact.raw=[]});
  assert.equal(runCoverageGate(root,"ignore",{merge:paths}),1,"empty contributions must not hide incomplete union coverage");
  change(artifact=>{artifact.raw[0].url="../outside.ts"});assert.throws(()=>mergeCoverageShards(root,paths,["src/value.ts"]),/unexpected source/);
  assert.equal(runCoverageGate(root,"ignore",{merge:paths}),1);
  writeFileSync(join(root,paths[0]!),saved);
  assert.equal(runCoverageGate(root,"ignore",{merge:[paths[0]!]}),1);
  assert.throws(()=>mergeCoverageShards(root,[paths[0]!],["src/value.ts"]),/missing shards/);
  assert.throws(()=>mergeCoverageShards(root,[paths[0]!,paths[0]!],["src/value.ts"]),/duplicate or missing/);
});

/** Malformed shard invocations must fail before they can run an unsharded gate. */
test("coverage CLI requires explicit values for shard and output flags", () => {
  const savedArgv = process.argv;
  try {
    for (const [args, message] of [
      [["--shard"], /--shard requires a value/],
      [["--shard", "1/2"], /--shard requires --output with a value/],
      [["--shard", "1/2", "--output"], /--output requires a value/],
      [["--output", "--shard", "1/2"], /--output requires a value/],
      [["--shard", "--output", "out"], /--shard requires a value/],
    ] as const) {
      process.argv = [savedArgv[0]!, fileURLToPath(new URL("../scripts/coverage-gate.ts", import.meta.url)), ...args];
      assert.throws(() => runScriptEntry(), message);
    }
  } finally { process.argv = savedArgv; }
});

/** Tooling-only shards are valid contributions; union source presence remains mandatory. */
test("successful tooling-only shard contributes empty hits without weakening the union", t => {
  const root = mkdtempSync(join(tmpdir(), "coverage tooling-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "test"));
  mkdirSync(join(root, "tooling"));
  writeCoverageConfig(root);
  writeFileSync(join(root, "src/value.ts"), "export function value() { return 42; }\n");
  writeFileSync(join(root, "tooling/check.ts"), "export const ready = true;\n");
  writeFileSync(join(root, "test/a.test.ts"), "import test from 'node:test'; import assert from 'node:assert/strict'; import {value} from '../src/value.ts'; test('source', () => assert.equal(value(), 42));\n");
  writeFileSync(join(root, "test/b.test.ts"), "import test from 'node:test'; import assert from 'node:assert/strict'; import {ready} from '../tooling/check.ts'; test('tooling', () => assert.equal(ready, true));\n");
  const paths = ["source/hits.json", "tooling-only/hits.json"];
  for (const [shard, output] of [["1/1", "whole"], ["1/2", "source"], ["2/2", "tooling-only"]]) {
    assert.equal(runCoverageGate(root, "ignore", { shard, output }), 0);
  }
  const tooling = JSON.parse(readFileSync(join(root, paths[1]!), "utf8"));
  assert.deepEqual(tooling.files, []);
  assert.deepEqual(tooling.raw, []);
  assert.deepEqual(mergeCoverageShards(root, paths, ["src/value.ts"]),
    mergeCoverageShards(root, ["whole/hits.json"], ["src/value.ts"]));
  assert.equal(runCoverageGate(root, "ignore", { merge: paths }), 0);
  assert.throws(() => mergeCoverageShards(root, [paths[0]!], ["src/value.ts"]), /missing shards/);
  writeFileSync(join(root, "src/missing.ts"), "export const missing = true;\n");
  for (const [shard, output] of [["1/2", "source"], ["2/2", "tooling-only"]]) {
    assert.equal(runCoverageGate(root, "ignore", { shard, output }), 0);
  }
  assert.equal(runCoverageGate(root, "ignore", { merge: paths }), 1, "the union must still load every required source");
});
