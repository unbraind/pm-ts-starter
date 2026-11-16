/** Compare actual offset-based hit unions against an unsharded runtime report. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCoverageGate, mergeCoverageShards, runScriptEntry } from "../scripts/coverage-gate.ts";

test("sharded coverage equals unsharded including one-shard branches and functions", t => {
  const root = mkdtempSync(join(tmpdir(), "coverage-union-"));
  t.after(() => rmSync(root, {recursive:true,force:true}));
  mkdirSync(join(root,"test"));
  writeFileSync(join(root,"package.json"), JSON.stringify({type:"module",coverageGate:{sources:["."],tests:["test/*.test.ts"],thresholds:{lines:100,branches:100,functions:100}}}));
  writeFileSync(join(root,"value.ts"), `export function classify(value: number) {
  if (value > 0) return positive();
  return negative();
}
export function positive() { return "positive"; }
export function negative() { return "negative"; }
`);
  for (const [name,value,expected] of [["a",1,"positive"],["b",-1,"negative"]] as const) writeFileSync(join(root,`test/${name}.test.ts`), `import test from 'node:test'; import assert from 'node:assert/strict'; import {classify} from '../value.ts'; test('${name}',()=>assert.equal(classify(${value}), '${expected}'));`);
  for (const [shard,output] of [["1/1","whole"],["1/2","first"],["2/2","second"]]) assert.equal(runCoverageGate(root,"ignore",{shard,output}),0);
  const paths=["first/hits.json","second/hits.json"];
  const merged=mergeCoverageShards(root,paths,["value.ts"]), whole=mergeCoverageShards(root,["whole/hits.json"],["value.ts"]);
  assert.deepEqual(merged.totals,whole.totals);
  const covered=(report: typeof merged) => report.files.map(file => ({...file, lines:(file.lines as {line:number;count:number}[]).map(hit=>({...hit,count:Number(hit.count>0)})), branches:(file.branches as {line:number;count:number}[]).map(hit=>({...hit,count:Number(hit.count>0)})), functions:(file.functions as {name:string;line:number;count:number}[]).map(hit=>({...hit,count:Number(hit.count>0)}))}));
  assert.deepEqual(covered(merged),covered(whole));
  for(const path of paths) { const shard=JSON.parse(readFileSync(join(root,path),"utf8")); assert.ok(shard.files[0].functions.some((hit:{count:number})=>hit.count===0)); assert.ok(shard.files[0].branches.some((hit:{count:number})=>hit.count===0)); }
  assert.equal(runCoverageGate(root,"ignore",{merge:paths}),0);
  const savedArgv=process.argv, savedExit=process.exit;
  let status: number | undefined;
  process.exit=((code?:number)=>{status=code;}) as typeof process.exit;
  try {
    for(const args of [["--shard","1/2","--output","cli"],["--merge",...paths]]) {
      process.argv=[savedArgv[0]!,new URL("../scripts/coverage-gate.ts",import.meta.url).pathname,...args];
      runScriptEntry(root);assert.equal(status,0);
    }
  } finally {process.argv=savedArgv;process.exit=savedExit;}
  const secondSaved=readFileSync(join(root,paths[1]!),"utf8");
  const sameHalf=JSON.parse(readFileSync(join(root,paths[0]!),"utf8"));sameHalf.shard="2/2";
  writeFileSync(join(root,paths[1]!),JSON.stringify(sameHalf));
  assert.equal(runCoverageGate(root,"ignore",{merge:paths}),1,"partial union must retain the original 100 percent threshold");
  writeFileSync(join(root,paths[1]!),secondSaved);
  assert.throws(()=>runCoverageGate(root,"ignore",{shard:"1/2"}),/empty shard or missing output/);
  const saved=readFileSync(join(root,paths[0]!),"utf8");
  const change=(mutate:(artifact: {digest:string;node:string;raw:{url:string;functions?:unknown}[]})=>void) => {const artifact=JSON.parse(saved);mutate(artifact);writeFileSync(join(root,paths[0]!),JSON.stringify(artifact));};
  change(artifact=>{artifact.digest="wrong"});assert.throws(()=>mergeCoverageShards(root,paths,["value.ts"]),/source mismatch/);
  change(artifact=>{artifact.node="0.0.0"});assert.throws(()=>mergeCoverageShards(root,paths,["value.ts"]),/runtime mismatch/);
  change(artifact=>{artifact.raw[0].functions=null});assert.throws(()=>mergeCoverageShards(root,paths,["value.ts"]),/native merge failed/);
  change(artifact=>{artifact.raw=[]});assert.throws(()=>mergeCoverageShards(root,paths,["value.ts"]),/empty shard/);
  change(artifact=>{artifact.raw[0].url="../outside.ts"});assert.throws(()=>mergeCoverageShards(root,paths,["value.ts"]),/unexpected source/);
  assert.equal(runCoverageGate(root,"ignore",{merge:paths}),1);
  writeFileSync(join(root,paths[0]!),saved);
  assert.equal(runCoverageGate(root,"ignore",{merge:[paths[0]!]}),1);
  assert.throws(()=>mergeCoverageShards(root,[paths[0]!],["value.ts"]),/missing shards/);
  assert.throws(()=>mergeCoverageShards(root,[paths[0]!,paths[0]!],["value.ts"]),/duplicate or missing/);
});
