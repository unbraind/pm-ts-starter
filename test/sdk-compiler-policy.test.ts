/** Completeness is measured against the real invoked compiler, never a remembered list. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { classifiedCompilerOptions, compilerInputPaths, compilerOptionNames, COMPILER_OPTION_POLICY, COMPILER_OPTION_ROWS, enforcedCompilerArguments, enforcedCompilerOptions, inspectionCompilerArguments } from "../sdk-compiler-policy.ts";

const help = spawnSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "--help", "--all", "--locale", "en"], { encoding: "utf8" });

test("every real compiler, watch and build option has exactly one reasoned policy", () => {
  assert.equal(help.status, 0, help.stderr);
  // Independently enumerate the compiler output, including alias-bearing declarations.
  const actual = new Set(help.stdout.split(/\r?\n/).filter(line => line.startsWith("--")).map(line => line.slice(2).split(/[,\s]/)[0]!));
  const policy = classifiedCompilerOptions(help.stdout);
  assert.equal(COMPILER_OPTION_ROWS.length, policy.size, "every option has exactly one classification");
  assert.deepEqual(new Set(policy.keys()), actual);
  assert.deepEqual(new Set(COMPILER_OPTION_POLICY.keys()), actual);
  for (const [name, row] of policy) {
    assert.ok(["output", "checking", "neutral"].includes(row.category), name);
    assert.ok(row.reason.length > 30, name);
    assert.equal(row.category === "neutral", row.safe === "preserve", name);
  }
});

test("incomplete and future option tables fail closed; overrides cover every enforced row", () => {
  for (const incomplete of ["", "ALL COMPILER OPTIONS", "ALL COMPILER OPTIONS\nWATCH OPTIONS", "ALL COMPILER OPTIONS\nWATCH OPTIONS\nBUILD OPTIONS"]) {
    assert.throws(() => compilerOptionNames(incomplete), /complete English/);
  }
  assert.throws(() => classifiedCompilerOptions(help.stdout + "\n--future-unchecked-compiler-option\ntype: boolean\n"), /Classify every option/);
  assert.equal(compilerOptionNames(help.stdout + "\n--help, -?\n").length, classifiedCompilerOptions(help.stdout).size);
  assert.deepEqual(enforcedCompilerArguments(classifiedCompilerOptions(help.stdout)), ["--watch", "false"]);
  const policy = classifiedCompilerOptions(help.stdout), overrides = enforcedCompilerOptions(policy);
  const inspection = inspectionCompilerArguments(policy, resolve("consumer"));
  assert.deepEqual(inspection.slice(0, 2), ["--watch", "false"]);
  for (const [name, value] of Object.entries(overrides)) {
    const index = inspection.indexOf(`--${name}`);
    assert.ok(index >= 0, name);
    assert.equal(inspection[index + 1], value === null ? resolve("consumer", ".sdk-contract-inspection", name) : String(value), name);
  }
  for (const [name, row] of policy) {
    if (row.safe === "preserve" || row.safe === "command" || row.safe === "off") assert.equal(Object.hasOwn(overrides, name), false);
    else assert.equal(overrides[name], row.safe, name);
  }
});


test("resolution input policy includes unused aliases, base origins and path-shaped types", () => {
  const project = resolve("consumer");
  assert.deepEqual(compilerInputPaths(project, {}), [".", "."]);
  assert.deepEqual(compilerInputPaths(project, {paths: {unused: ["./declarations", 7]}}), [".", ".", resolve(project, "declarations"), 7]);
  assert.deepEqual(compilerInputPaths(project, {baseUrl: "base", rootDir: "src", paths: {alias: ["./contract"]},
    typeRoots: ["types"], rootDirs: ["generated"], types: ["node", "./local", resolve("external")]}),
  ["base", "src", resolve(project, "base/contract"), "types", "generated", "./local", resolve("external")]);
});
