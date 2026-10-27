/** Compiler API failure and result boundaries never trust subprocess text. */
import assert from "node:assert/strict";
import {cpSync, readFileSync, unlinkSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import test from "node:test";
import {checkSdkContracts, SdkContractRefusal} from "../sdk-contracts.ts";
import {apiConsumer, filesystemSnapshot, testCompiler} from "./dependency-fixtures.ts";

test("API compiler failures and malformed private results produce typed refusals", async t => {
  const {root, project, bound} = apiConsumer(t), artifact = join(project, "node_modules/typescript");
  unlinkSync(artifact); cpSync(dirname(dirname(testCompiler())), artifact, {recursive: true});
  const metadata = join(artifact, "package.json"), original = JSON.parse(readFileSync(metadata, "utf8"));
  writeFileSync(metadata, JSON.stringify({...original, main: "./boundary.cjs"}));
  const module = join(artifact, "boundary.cjs"), diagnostic = {code: "TS2322", file: "consumer.ts", message: "type error", line: 1, column: 1};
  const malformed: unknown[] = [null, 42, {}, [], {ok: true, exit_code: 1, diagnostics: []}, {ok: false, exit_code: 1, diagnostics: "text"}, {refusal: "invented", remedy: "invalid"}, {refusal: "isolation_refused"}, ...[null, {...diagnostic, file: 1}, {...diagnostic, message: 1}, {...diagnostic, code: "invented"}, {...diagnostic, line: -1}, {...diagnostic, line: 1.5}, {...diagnostic, column: -1}, {...diagnostic, column: 1.5}, diagnostic].map(value => ({ok: true, exit_code: 0, diagnostics: [value]}))];
  const failures = ["require('node:fs').symlinkSync(process.argv[2]+'/consumer.ts',process.argv[6]);process.exit(0)", "process.exit(3)", "process.kill(process.pid,'SIGTERM')", "process.stderr.write('x'.repeat(9000000))", "process.stdout.write(JSON.stringify({ok:true,exit_code:0,diagnostics:[]}));process.exit(0)", "require('node:fs').writeFileSync(process.argv[6],'x'.repeat(9000000));process.exit(0)"];
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
