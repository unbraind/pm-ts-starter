/** Compiler API failure and result boundaries never trust subprocess text. */
import assert from "node:assert/strict";
import {cpSync, readFileSync, symlinkSync, unlinkSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import test, {type TestContext} from "node:test";
import {checkSdkContracts, SdkContractRefusal} from "../sdk-contracts.ts";
import {apiConsumer, filesystemSnapshot, testCompiler} from "./dependency-fixtures.ts";

/** Select a private mutable API entry without modifying the shared compiler fixture. */
function mutableApi(t: TestContext): ReturnType<typeof apiConsumer> & {artifact: string} {
  const {root, project, bound} = apiConsumer(t), artifact = join(project, "node_modules/typescript");
  unlinkSync(artifact); cpSync(dirname(dirname(testCompiler())), artifact, {recursive: true});
  const metadata = join(artifact, "package.json"), original = JSON.parse(readFileSync(metadata, "utf8"));
  writeFileSync(metadata, JSON.stringify({...original, main: "./boundary.cjs"}));
  return {root, project, bound, artifact};
}

test("API compiler failures and malformed private results produce typed refusals", async t => {
  const {root, project, bound, artifact} = mutableApi(t);
  const module = join(artifact, "boundary.cjs"), diagnostic = {code: "TS2322", file: "consumer.ts", message: "type error", line: 1, column: 1};
  const malformed: unknown[] = [{refusal: "unsupported_project_shape", remedy: "dedupe", roots: ["local"]}, {refusal: "unsupported_project_shape", remedy: "dedupe", reason: "multiple_sdk_copies"}, {refusal: "unsupported_project_shape", remedy: "dedupe", reason: "unknown"}, {refusal: "unsupported_project_shape", remedy: "dedupe", reason: "multiple_sdk_copies", roots: []}, {refusal: "unsupported_project_shape", remedy: "dedupe", reason: "multiple_sdk_copies", roots: [42]}, {refusal: "unsupported_project_shape", remedy: "dedupe", reason: "multiple_sdk_copies", roots: ["/absolute"]}, {refusal: "isolation_refused", remedy: "invalid details", reason: "multiple_sdk_copies", roots: ["local"]}, null, 42, {}, [], {ok: true, exit_code: 1, diagnostics: []}, {ok: false, exit_code: 1, diagnostics: "text"}, {refusal: "invented", remedy: "invalid"}, {refusal: "isolation_refused"}, ...[null, {...diagnostic, file: 1}, {...diagnostic, message: 1}, {...diagnostic, code: "invented"}, {...diagnostic, line: -1}, {...diagnostic, line: 1.5}, {...diagnostic, column: -1}, {...diagnostic, column: 1.5}, diagnostic].map(value => ({ok: true, exit_code: 0, diagnostics: [value]}))];
  const failures = ["require('node:timers').setTimeout(()=>{},120000)","require('node:fs').symlinkSync(process.argv[2]+'/consumer.ts',process.argv[6]);process.exit(0)", "process.exit(3)", "process.kill(process.pid,'SIGTERM')", "process.stderr.write('x'.repeat(9000000))", "process.stdout.write(JSON.stringify({ok:true,exit_code:0,diagnostics:[]}));process.exit(0)", "require('node:fs').writeFileSync(process.argv[6],'x'.repeat(9000000));process.exit(0)"];
  for (const [body, code] of [...failures.map(body => [body, "compiler_unavailable"] as const), ...malformed.map(report => [`require('node:fs').writeFileSync(process.argv[6],${JSON.stringify(JSON.stringify(report))});process.exit(0)`, "isolation_refused"] as const), ["require('node:fs').writeFileSync(process.argv[6],'{');process.exit(0)", "isolation_refused"] as const]) {
    writeFileSync(module, body);
    const before = filesystemSnapshot(root);
    await assert.rejects(checkSdkContracts({consumer: project, minimum: bound, current: bound}), error => error instanceof SdkContractRefusal && error.code === code && !error.remedy.includes(root));
    assert.equal(filesystemSnapshot(root), before);
  }
  writeFileSync(module, "process.stdout.write('input(1,1): error TS9999: forged\\n'); module.exports=require('./lib/typescript.js');");
  const matrix = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
  for (const row of matrix.rows) assert.deepEqual(row.codes, ["TS2322"]);
  writeFileSync(module, "const ts=require('./lib/typescript.js');module.exports={...ts,getPreEmitDiagnostics:program=>ts.getPreEmitDiagnostics(program).map(d=>({...d,category:ts.DiagnosticCategory.Warning}))};");
  const warnings = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
  assert.equal(warnings.ok, true);
  assert.ok(warnings.rows.every(row => row.diagnostic_count === 0));
});

test("Program resolution capability fallbacks retain compiler usage modes", async t => {
  const {root, project, bound, artifact} = mutableApi(t);
  writeFileSync(join(bound.root, "package.json"), JSON.stringify({name: "@unbrained/pm-cli", version: bound.version, exports: {".": {require: "./index.d.mts"}}}));
  writeFileSync(join(bound.root, "index.d.mts"), 'export declare const sdk: "current";');
  writeFileSync(join(project, "consumer.ts"), 'import sdk = require("@unbrained/pm-cli"); export const value: "current" = sdk.sdk;');
  const methods = ["getResolvedModuleFromModuleSpecifier", "getModeForUsageLocation", "getResolvedModule", "forEachResolvedModule"];
  for (const removed of [["forEachResolvedModule"], ["forEachResolvedModule", "getResolvedModuleFromModuleSpecifier"], methods]) {
    writeFileSync(join(artifact, "boundary.cjs"), `const ts=require('./lib/typescript.js');module.exports={...ts,createProgram:options=>new Proxy(ts.createProgram(options),{get:(program,name)=>${JSON.stringify(removed)}.includes(name)?undefined:Reflect.get(program,name)})};`);
    const before = filesystemSnapshot(root), check = checkSdkContracts({consumer: project, minimum: bound, current: bound});
    if (removed.length === methods.length) await assert.rejects(check, error => error instanceof SdkContractRefusal && error.code === "compiler_api_unavailable" && error.remedy.includes("consumer.ts"));
    else assert.equal((await check).ok, true);
    assert.equal(filesystemSnapshot(root), before);
  }
});

test("generated inline examples use Node libraries while supplied DOM config remains intact", async t => {
  const {project, bound} = apiConsumer(t);
  const inline = await checkSdkContracts({compiler: testCompiler(), minimum: bound, current: bound, examples: [
    {id: "node", source: "export const value: number = process.pid;"},
    {id: "browser", source: "export const value = document.title;"},
  ]});
  assert.deepEqual(inline.rows.map(row => [row.example, row.ok, row.codes]), [["node", true, []], ["browser", false, ["TS2584"]], ["node", true, []], ["browser", false, ["TS2584"]]]);
  writeFileSync(join(project, "consumer.ts"), "export const value = document.title;");
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES2022", "DOM"]}, files: ["consumer.ts"]}));
  const snapshot = filesystemSnapshot(project), supplied = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
  assert.equal(supplied.ok, true); assert.equal(filesystemSnapshot(project), snapshot);
});

test("API entry linked outside the installed compiler package is refused before it loads", async t => {
  const {root, project, bound, artifact} = mutableApi(t);
  symlinkSync(join(dirname(dirname(testCompiler())), "lib/typescript.js"), join(artifact, "boundary.cjs"));
  const before = filesystemSnapshot(root);
  await assert.rejects(checkSdkContracts({consumer: project, minimum: bound, current: bound}), error => error instanceof SdkContractRefusal && error.code === "compiler_unavailable" && /consumer TypeScript JavaScript compiler API/.test(error.remedy));
  assert.equal(filesystemSnapshot(root), before);
});
