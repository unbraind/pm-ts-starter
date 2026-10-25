/** Completeness is measured against the real invoked compiler, never a remembered list. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { optionValue } from "./compiler-option-fixtures.ts";
import { classifiedCompilerOptions, compilerInputPaths, compilerOptionNames, COMPILER_OPTION_POLICY, COMPILER_OPTION_ROWS, enforcedCompilerOptions, refusedCompilerOptions } from "../sdk-compiler-policy.ts";

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
    if (row.category === "neutral") assert.equal(row.safe, "preserve", name);
  }
});

test("incomplete and future option tables fail closed; overrides cover every enforced row", () => {
  for (const incomplete of ["", "ALL COMPILER OPTIONS", "ALL COMPILER OPTIONS\nWATCH OPTIONS", "ALL COMPILER OPTIONS\nWATCH OPTIONS\nBUILD OPTIONS"]) {
    assert.throws(() => compilerOptionNames(incomplete), /complete English/);
  }
  assert.throws(() => classifiedCompilerOptions(help.stdout + "\n--future-unchecked-compiler-option\ntype: boolean\n"), /Classify every option/);
  assert.equal(compilerOptionNames(help.stdout + "\n--help, -?\n").length, classifiedCompilerOptions(help.stdout).size);
  const policy = classifiedCompilerOptions(help.stdout), sandbox = resolve("sandbox");
  assert.deepEqual(enforcedCompilerOptions(policy, {}, sandbox), {outDir: resolve(sandbox, "outDir/output")});
  assert.deepEqual(refusedCompilerOptions(policy, {}), []);
  assert.deepEqual(refusedCompilerOptions(policy, {noCheck: true, noResolve: true, watch: true, skipLibCheck: false}), ["watch", "noResolve", "noCheck"]);

});


test("resolution input policy includes unused aliases, base origins and path-shaped types", () => {
  const project = resolve("consumer");
  assert.deepEqual(compilerInputPaths(project, {}), [".", "."]);
  assert.deepEqual(compilerInputPaths(project, {paths: {unused: ["./declarations", 7]}}), [".", ".", resolve(project, "declarations"), 7]);
  assert.deepEqual(compilerInputPaths(project, {baseUrl: "base", rootDir: "src", paths: {alias: ["./contract"]},
    typeRoots: ["types"], rootDirs: ["generated"], types: ["node", "./local", resolve("external")]}),
  ["base", "src", resolve(project, "base/contract"), "types", "generated", "./local", resolve("external")]);
});


test("full option-table equality property preserves each nondefault value except sandbox output paths", t => {
  const policy = classifiedCompilerOptions(help.stdout), sandbox = resolve("sandbox");
  let checked = 0;
  for (const [name, row] of policy) {
    const original = {[name]: optionValue(help.stdout, name)};
    const effective: Record<string, unknown> = {...original, ...enforcedCompilerOptions(policy, original, sandbox)};
    for (const key of new Set([...policy.keys(), ...Object.keys(effective)])) {
      if (policy.get(key)?.safe === "relocate" && effective[key] !== undefined) assert.ok(String(effective[key]).startsWith(sandbox + "/"), `${name}: ${key}`);
      else assert.deepEqual(effective[key], original[key], `${name}: ${key}`);
    }
    assert.deepEqual(refusedCompilerOptions(policy, original), (row.safe === "refuse" || row.safe === "command") && original[name] === true ? [name] : []);
    checked++;
  }
  for (const original of [{incremental: true}, {composite: true}, {noEmit: true}, {noEmit: false}, {lib: ["es2022"], strict: false}]) {
    const effective: Record<string, unknown> = {...original, ...enforcedCompilerOptions(policy, original, sandbox)};
    for (const [key, value] of Object.entries(original)) assert.deepEqual(effective[key], value);
  }
  t.diagnostic(`Option equality: ${checked}/${policy.size} generated nondefault configurations preserve every non-output value.`);
});
