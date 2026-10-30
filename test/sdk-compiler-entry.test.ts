/** Compiler selection promises must match canonical package containment on every surface. */
import assert from "node:assert/strict";
import {chmodSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync} from "node:fs";
import {dirname, join, resolve, sep} from "node:path";
import test from "node:test";
import {createExtensionTestHarness} from "@unbrained/pm-cli/sdk/testing";
import extension from "../index.ts";
import {checkSdkContracts, SdkContractRefusal} from "../sdk-contracts.ts";
import {apiConsumer, boundaryRandom, dependencyBound, filesystemSnapshot, testCompiler, testDirectory} from "./dependency-fixtures.ts";

test("compiler entry contract agrees across registered help, SDK declarations and documentation", async () => {
  const harness = await createExtensionTestHarness(extension, {name: "pm-ts-starter", capabilities: ["commands", "renderers", "hooks", "schema", "importers", "search", "parser", "preflight", "services"]});
  const flag = harness.activation.registrations.flags.flatMap(entry => entry.flags).find(entry => entry.long === "--compiler");
  assert.ok(flag); assert.ok(flag.description);
  for (const text of [flag.description, ...["sdk-contracts.ts", "README.md"].map(file => readFileSync(resolve(import.meta.dirname, "..", file), "utf8"))]) {
    assert.match(text, /inline/i);
    assert.match(text, /node_modules\/typescript/);
    assert.match(text, /symlink/i);
    assert.match(text, /wrappers[\s\S]*rejected/i);
    assert.doesNotMatch(text, /JavaScript or executable shell shim/);
  }
});

test("compiler entry property accepts contained files and aliases and refuses executable external wrappers", async t => {
  const {root, project, bound} = apiConsumer(t), modules = join(project, "node_modules"), compiler = join(modules, "typescript/bin/tsc");
  for (const name of ["@types", "undici-types"]) symlinkSync(resolve(import.meta.dirname, "../node_modules", name), join(modules, name), "junction");
  const bin = join(modules, ".bin"); mkdirSync(bin);
  const alias = join(bin, "tsc"); symlinkSync(compiler, alias);
  const examples = [{id: "minimal", source: "export const value: number = 1;"}];
  for (const entry of [compiler, join(dirname(dirname(compiler)), "lib/typescript.js"), alias]) {
    const before = filesystemSnapshot(root), result = await checkSdkContracts({minimum: bound, current: bound, compiler: entry, examples});
    assert.equal(result.ok, true); assert.equal(result.checks, 2);
    assert.equal(filesystemSnapshot(root), before);
  }
  const foreignAlias = join(root, "external-compiler"); symlinkSync(compiler, foreignAlias);
  const beforeAlias = filesystemSnapshot(root);
  await assert.rejects(checkSdkContracts({minimum: bound, current: bound, compiler: foreignAlias, examples}), error => error instanceof SdkContractRefusal && error.code === "compiler_unavailable");
  assert.equal(filesystemSnapshot(root), beforeAlias);
  unlinkSync(alias);
  const random = boundaryRandom(154488), names = ["tsc", "tsc.cmd", "tsc.cjs", ...Array.from({length: 12}, (_, index) => `wrapper-${random().toString(36)}-${[" ", "'", '"', "\n", "\u2028", "--"][index % 6]}`)];
  for (const [index, name] of names.entries()) {
    const entry = join(bin, name);
    writeFileSync(entry, index % 2 ? "#!/bin/sh\nexit 47\n" : "#!/usr/bin/env node\nprocess.exit(47);\n"); chmodSync(entry, 0o755);
    const before = filesystemSnapshot(root);
    await assert.rejects(checkSdkContracts({minimum: bound, current: bound, compiler: entry, examples}), error => {
      assert.ok(error instanceof SdkContractRefusal); assert.equal(error.code, "compiler_unavailable");
      assert.match(error.remedy, /external shell\/JavaScript wrappers are rejected/);
      assert.match(error.remedy, /node_modules\/typescript/); return true;
    });
    assert.equal(filesystemSnapshot(root), before);
  }
});

test("compiler installation property keeps literal node_modules delimiters in native filenames", async t => {
  const root = testDirectory(t, "sdk-compiler-native-"), random = boundaryRandom(154490), bound = dependencyBound(root);
  const components = Array.from({length: 8}, () => "literal-" + random().toString(36) + (sep === "/" ? "\\node_modules\\part" : "-part"));
  const installation = join(root, ...components); mkdirSync(installation, {recursive: true});
  const modules = dirname(dirname(dirname(testCompiler())));
  for (const alias of [join(installation, "node_modules"), join(root, "node_modules/node_modules")]) {
    symlinkSync(modules, alias, "junction");
    const before = filesystemSnapshot(root);
    const result = await checkSdkContracts({minimum: bound, current: bound, compiler: join(alias, "typescript/bin/tsc"), examples: [{id: "minimal", source: "export const value = 1;"}]});
    assert.equal(result.ok, true); assert.equal(result.checks, 2); assert.equal(filesystemSnapshot(root), before);
  }
});
