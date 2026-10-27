/** Writer capabilities and filesystem safety independent of compiler diagnostic semantics. */
import assert from "node:assert/strict";
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {compilerWriterArguments, escapingCompilerOutputs, supportedWriterOptions} from "../sdk-compiler-policy.ts";

test("unneutralized writers inspect complete output subtrees and canonical ancestors", t => {
  const root = mkdtempSync(join(tmpdir(), "writer-paths-"));
  const project = join(root, "project"), external = join(root, "external");
  mkdirSync(project); mkdirSync(external);
  t.after(() => rmSync(root, {recursive: true, force: true}));
  writeFileSync(join(external, "sentinel"), "original");
  mkdirSync(join(project, "safe")); writeFileSync(join(project, "safe/file"), "local");
  symlinkSync(join(project, "safe"), join(project, "safe/cycle"));
  mkdirSync(join(project, "file-link")); symlinkSync(join(external, "sentinel"), join(project, "file-link/child"));
  mkdirSync(join(project, "dir-link")); symlinkSync(external, join(project, "dir-link/child"));
  symlinkSync(join(root, "absent"), join(project, "dangling"));
  symlinkSync(external, join(project, "outside"));
  mkdirSync(join(project, "broken-child")); symlinkSync(join(root, "absent"), join(project, "broken-child/link"));
  for (const [path, refused] of [["broken-child", true], ["safe", false], ["new/trace", false], ["file-link", true], ["dir-link", true], ["dangling", true], ["outside/new", true], ["../external", true], [external, true], ["node_modules/output", true]] as const) {
    assert.deepEqual(escapingCompilerOutputs({generateTrace: path}, project), refused ? ["generateTrace"] : [], path);
  }
  for (const options of [{incremental: true}, {composite: true, outDir: "dist"}, {incremental: true, outDir: "dist", rootDir: "."}, {incremental: true, outFile: "bundle.js"}, {incremental: true, tsBuildInfoFile: "safe/file"}]) {
    assert.deepEqual(escapingCompilerOutputs(options, project), []);
  }
  assert.deepEqual(escapingCompilerOutputs({outDir: external, declarationDir: external, outFile: external}, project), [], "noEmit prevents source and declaration emission");
  assert.deepEqual(escapingCompilerOutputs({tsBuildInfoFile: external}, project, join(project, "tsconfig.json"), new Set(), true), ["tsBuildInfoFile"], "build metadata cannot be redirected with a shared CLI path");
});

test("writer overrides use fresh private paths and leave unsupported checking options alone", t => {
  const project = mkdtempSync(join(tmpdir(), "writer-overrides-"));
  t.after(() => rmSync(project, {recursive: true, force: true}));
  const supported = supportedWriterOptions("--generateTrace\n--generateCpuProfile\n--pprofDir\n--tsBuildInfoFile\n--futureOption");
  assert.equal(supported.has("futureOption"), false);
  for (const options of [{generateTrace: "trace", generateCpuProfile: "cpu", pprofDir: "profile", incremental: true}, {composite: true}, {}]) {
    const result = compilerWriterArguments(supported, options, project, false);
    assert.deepEqual(escapingCompilerOutputs(options, project, undefined, result.neutralized), []);
    for (let index = 1; index < result.args.length; index += 2) assert.ok(result.args[index]!.startsWith(project + "/.sdk-output-"));
  }
  assert.deepEqual(compilerWriterArguments(new Set(), {generateTrace: "trace", incremental: true}, project, false).args, []);
  assert.deepEqual(compilerWriterArguments(supported, {incremental: true}, project, true).args, []);
});
