/** Real compiler compatibility and writer-boundary regression controls. */
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import test, {type TestContext} from "node:test";
import {checkSdkContracts, SdkContractRefusal} from "../sdk-contracts.ts";
import {dependencyBound, filesystemSnapshot, installTestCompiler} from "./dependency-fixtures.ts";

const pinnedCompiler = resolve(import.meta.dirname, "../node_modules/typescript/bin/tsc");
/** Allocate a non-git consumer and independently provision its exact stock compiler. */
function consumer(t: TestContext, version?: string): {root: string; project: string; bound: ReturnType<typeof dependencyBound>} {
  const root = mkdtempSync(join(tmpdir(), "sdk-writer-test-"));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const project = join(root, "consumer");
  mkdirSync(join(project, "node_modules"), {recursive: true});
  if (version) installTestCompiler(project, version); else symlinkSync(dirname(dirname(pinnedCompiler)), join(project, "node_modules/typescript"), "junction");
  writeFileSync(join(project, "package.json"), JSON.stringify({type: "module"}));
  writeFileSync(join(project, "consumer.mts"), "export const value = 1;");
  return {root, project, bound: dependencyBound(project)};
}

for (const version of ["5.9.3", "6.0.3", "7.0.2"]) test(`unfiltered stock TypeScript ${version} accepts its minimal consumer`, async t => {
  const {project, bound} = consumer(t, version);
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], module: "NodeNext", noEmit: true}, files: ["consumer.mts"]}));
  const entry = join(project, "node_modules/typescript/bin/tsc"), original = readFileSync(entry);
  for (const valid of [true, false]) {
    writeFileSync(join(project, "consumer.mts"), valid ? "export const value = 1;" : "export const value: string = 1;");
    const expected = spawnSync(process.execPath, [entry, "-p", "tsconfig.json", "--noEmit", "--pretty", "false"], {cwd: project, encoding: "utf8"});
    assert.equal(expected.status === 0, valid);
    const before = filesystemSnapshot(project), matrix = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
    assert.deepEqual(matrix.rows.map(row => ({ok: row.ok, codes: row.codes})), [{ok: valid, codes: valid ? [] : ["TS2322"]}, {ok: valid, codes: valid ? [] : ["TS2322"]}]);
    assert.equal(filesystemSnapshot(project), before);
  }
  const outside = join(dirname(project), "profile-sentinel");
  writeFileSync(outside, "external profile sentinel");
  mkdirSync(join(project, "node_modules/output"));
  symlinkSync(outside, join(project, "node_modules/output/trace.json"));
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], module: "NodeNext", generateTrace: "node_modules/output", generateCpuProfile: "node_modules/output/trace.json", incremental: true, tsBuildInfoFile: "node_modules/output/cache", futureUnknownOption: true}, files: ["consumer.mts"]}));
  const oracle = join(dirname(project), "oracle");
  mkdirSync(join(oracle, "node_modules/output"), {recursive: true});
  for (const name of ["consumer.mts", "tsconfig.json"]) writeFileSync(join(oracle, name), readFileSync(join(project, name)));
  const direct = spawnSync(process.execPath, [entry, "-p", "tsconfig.json", "--noEmit", "--pretty", "false"], {cwd: oracle, encoding: "utf8"});
  assert.equal(direct.error, undefined); assert.notEqual(direct.status, 0);
  const codes = [...direct.stdout.matchAll(/error (TS\d+):/g)].map(match => match[1]);
  assert.ok(codes.includes("TS5023"));
  const before = filesystemSnapshot(dirname(project)), failed = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
  assert.equal(failed.ok, false, "unknown options are diagnosed by the actual compiler even with writers enabled");
  assert.deepEqual(failed.rows.map(row => row.diagnostics.map(diagnostic => diagnostic.code)), [codes, codes]);
  assert.equal(filesystemSnapshot(dirname(project)), before, "configuration, diagnostics and file-list probes confine every writer");
  if (version !== "7.0.2") {
    mkdirSync(join(project, "reference"));
    writeFileSync(join(project, "reference/tsconfig.json"), "{ invalid");
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({files: [], references: [{path: "reference"}]}));
    const snapshot = filesystemSnapshot(dirname(project));
    await assert.rejects(checkSdkContracts({consumer: project, minimum: bound, current: bound}), error => error instanceof SdkContractRefusal && error.code === "isolation_refused");
    assert.equal(filesystemSnapshot(dirname(project)), snapshot, "uninspectable build graphs are refused before writes");
  }
  assert.deepEqual(readFileSync(entry), original, "stock executable is never wrapped or filtered");
});

const writers = ["generateTrace", "generateCpuProfile", "pprofDir", "tsBuildInfoFile", "outDir", "declarationDir", "outFile", "incremental"];
for (const option of writers) for (const kind of ["file", "directory"]) for (const dependency of [false, true]) {
  test(`writer confinement ${option}: external ${kind} child in ${dependency ? "dependency" : "consumer"} tree`, async t => {
    const {root, project, bound} = consumer(t), outside = join(root, "outside");
    mkdirSync(outside); writeFileSync(join(outside, "trace.json"), "external sentinel bytes");
    const destination = join(project, dependency ? "node_modules/fixture-output" : "output");
    mkdirSync(destination, {recursive: true});
    if (dependency) writeFileSync(join(destination, "package.json"), JSON.stringify({name: "fixture-output", version: "1.0.0"}));
    symlinkSync(kind === "file" ? join(outside, "trace.json") : outside, join(destination, kind === "file" ? "trace.json" : "nested"), kind === "directory" ? "junction" : "file");
    const relative = dependency ? "node_modules/fixture-output" : "output";
    const options: Record<string, unknown> = {types: [], lib: ["ES5"], module: "NodeNext", declaration: true};
    if (option === "incremental" || option === "tsBuildInfoFile") Object.assign(options, {incremental: true, tsBuildInfoFile: relative + (kind === "file" ? "/trace.json" : "/nested/state.tsbuildinfo")});
    else {
      const output = relative + (kind === "directory" ? "/nested" : "");
      options[option] = option === "outFile" || option === "generateCpuProfile" ? output + "/trace.json" : output;
    }
    if (option === "outFile") options.module = "System";
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: options, files: ["consumer.mts"]}));
    const before = filesystemSnapshot(root);
    const run = checkSdkContracts({consumer: project, minimum: bound, current: bound});
    if (dependency) {
      const matrix = await run;
      assert.equal(matrix.checks, 2);
      if (["generateTrace", "tsBuildInfoFile", "outDir", "declarationDir", "incremental"].includes(option)) assert.equal(matrix.ok, true, JSON.stringify(matrix.rows));
    } else await assert.rejects(run, error => error instanceof SdkContractRefusal && error.code === "isolation_refused");
    assert.equal(filesystemSnapshot(root), before, "every external file, directory and input is byte-identical");
  });
}
