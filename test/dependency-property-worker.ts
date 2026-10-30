/** Independent real-compiler property shards; workers run tests, never agent/model tasks. */
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {parentPort, workerData} from "node:worker_threads";
import {checkSdkContracts} from "../sdk-contracts.ts";
import {dependencyEntry, dependencyBound, boundaryRandom, filesystemSnapshot} from "./dependency-fixtures.ts";

const {shard, compiler} = workerData as {shard: number; compiler: string};
const root = mkdtempSync(join(tmpdir(), "sdk-property-"));
const project = join(root, "consumer");
mkdirSync(join(project, "node_modules"), {recursive: true});
symlinkSync(dirname(dirname(compiler)), join(project, "node_modules/typescript"), "junction");
writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions:{noEmit:true,types:[],module:"NodeNext"},files:["consumer.mts"]}));

const bound = dependencyBound(project), random = boundaryRandom(15410 + shard);
let edges = 0;
try {
  const shapes = new Set<string>();
  for (let graph = 0; graph < 50; graph++) {
    for (let node = 0; node < 6; node++) rmSync(join(project, "node_modules", `graph-alias-${node}`), {recursive: true, force: true});
    rmSync(join(project, "node_modules/@graph"), {recursive: true, force: true});
    rmSync(join(project, "packages"), {recursive: true, force: true});
    for (let leaf = 0; leaf < 7; leaf++) rmSync(join(project, "node_modules", `child-${leaf}`), {recursive: true, force: true});
    const dependencies: Record<string, string> = {}, imports: string[] = [];
    const count = 2 + random() % 5;
    for (let node = 0; node < count; node++) {
      const shape = ["alias", "scoped", "file"][random() % 3]!;
      shapes.add(shape);
      const name = shape === "scoped" ? `@graph/alias-${node}` : `graph-alias-${node}`;
      const actual = `actual-${graph}-${node}`, root = join(project, "node_modules", name);
      if (shape === "file") {
        dependencyEntry(project, `packages/${actual}`, actual);
        mkdirSync(dirname(root), {recursive: true});
        symlinkSync(join(project, "packages", actual), root, "junction");
      } else dependencyEntry(join(project, "node_modules"), name, actual);
      // Private nested aliases deliberately shadow a conflicting hoisted directory.
      const child = `child-${random() % 7}`;
      dependencyEntry(join(project, "node_modules"), child, `actual-${child}`, 'export declare const value: "wrong-hoist";');
      dependencyEntry(join(root, "node_modules"), child, `actual-${child}`);
      writeFileSync(join(root, "index.d.ts"), `export {value} from ${JSON.stringify(child)};`);
      const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, unknown>;
      metadata.dependencies = {[child]: `npm:actual-${child}@1`};
      writeFileSync(join(root, "package.json"), JSON.stringify(metadata));
      dependencies[name] = shape === "file" ? `file:./packages/${actual}` : `npm:${actual}@1`;
      imports.push(`import {value as value${node}} from ${JSON.stringify(name)}; export const use${node}: "selected" = value${node};`);
      edges += 2;
    }
    writeFileSync(join(project, "package.json"), JSON.stringify({private: true, type: "module", dependencies}));
    writeFileSync(join(project, "consumer.mts"), imports.join("\n"));
    const baseline = join(root, "baseline");
    cpSync(project, baseline, {recursive:true});
    const plain = spawnSync(process.execPath, [compiler, "--project", "tsconfig.json"], {cwd:baseline,encoding:"utf8"});
    try {
      assert.equal(plain.status, 0, `shard ${shard}, graph ${graph}: ${plain.stdout}`);
      const original = filesystemSnapshot(project);
      const matrix = await checkSdkContracts({consumer:project,minimum:bound,current:bound});
      assert.deepEqual(matrix.rows.map(row => ({ok:row.ok,codes:row.codes,diagnostic_count:row.diagnostic_count})), [{ok:true,codes:[],diagnostic_count:0},{ok:true,codes:[],diagnostic_count:0}], `shard ${shard}, graph ${graph}`);
      assert.equal(filesystemSnapshot(project), original);
      if ((graph + 1) % 10 === 0) process.stdout.write(`dependency property shard ${shard}: ${graph + 1}/50 verified\n`);
    } finally {rmSync(baseline, {recursive:true,force:true});}
  }
  assert.equal(shapes.size, 3);
} finally {rmSync(root, {recursive:true,force:true});}
parentPort!.postMessage({graphs:50,edges});
