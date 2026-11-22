/** Differential compiler, hostile-specifier and declaration-resolution contracts. Part b of the SDK contract suite; see sdk-contracts-support.ts. */
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {dependencyEntry, testCompiler, directApiDiagnostics, dependencyBound, filesystemSnapshot, boundaryRandom, INSTALL_TIMEOUT_MS, bunExecutable} from "./dependency-fixtures.ts";
import { testDepth } from "./support/depth.ts";
import test, { type TestContext } from "node:test";
import { sdk, pinned, target, compiler, checkSdkContracts, minimumVersion, currentVersion, scratch, hostileSpecifiers, installedConsumer, assertLeaseDrift, instrumentOracle, declarationLayout, consumerConfig, compareOracle, linkedCompilerConsumer, plainCopy, assertPlainRows } from "./sdk-contracts-support.ts";

test("differential hostile specifiers in consumer and external declarations preserve every earlier row at both bounds", async t => {
  const root = scratch(t), project = installedConsumer("npm", "current");
  const receipt = join(root, "hostile.jsonl"); instrumentOracle(project, receipt, t);
  const config = consumerConfig(project, "nodenext", "esm");
  const minimum = { root: declarationLayout(join(root, "min"), minimumVersion, "types"), version: minimumVersion };
  const current = { root: declarationLayout(join(root, "cur"), currentVersion, "types"), version: currentVersion };
  let rows = 0;
  for (const location of ["consumer", "declaration"]) for (const [index, [id, specifier]] of hostileSpecifiers.entries()) {
    if (testDepth(2, 1) === 1 && location !== (index % 2 ? "declaration" : "consumer")) continue;
    const literal = id.startsWith("raw-") ? `"${specifier}"` : JSON.stringify(specifier);
    const source = `import * as sdk from ${literal}; export declare const api: typeof sdk;`;
    writeFileSync(join(project, "contract.d.mts"), source);
    writeFileSync(join(project, "consumer.mts"), location === "consumer" ? source : 'import {api} from "./contract.mjs"; export const use = api;');
    writeFileSync(receipt, "");
    const matrix = await checkSdkContracts({ minimum, current, consumer: project });
    compareOracle(matrix, receipt, project, config);
    assert.equal(matrix.failed, 2, `${location}/${id}`);
    assert.ok(matrix.rows.every(row => row.codes.some(code => /^(TS2307|TS1002)$/.test(code))));
    rows += matrix.checks;
  }
  assert.equal(rows, hostileSpecifiers.length * testDepth(2, 1) * 2);
  t.diagnostic(`Hostile differential: ${rows}/${rows} compiler verdicts agree.`);
});

test("consumer checking options pass unchanged to the real compiler", async t => {
  const project = linkedCompilerConsumer(t);
  for (const name of ["skipLibCheck", "skipDefaultLibCheck", "noCheck", "noResolve"]) {
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], module: "NodeNext", [name]: true}, files: ["consumer.mts"]}));
    writeFileSync(join(project, "consumer.mts"), "export const value: string = 1;");
    const plain = plainCopy(project, t), before = filesystemSnapshot(project);
    assertPlainRows(await checkSdkContracts({minimum: target, current: target, consumer: project}), plain);
    assert.equal(filesystemSnapshot(project), before);
  }
});

test("review reproductions require and versioned types declarations report TS2339 and TS2305 instead of false success", async t => {
  const root = scratch(t);
  for (const layout of ["types", "types@"]) await t.test(layout, async () => {
    const project = join(root, layout);
    const rootSdk = declarationLayout(join(project, "node_modules/@unbrained/pm-cli"), pinned, layout);
    const contract = join(project, "contract.d.cts");
    writeFileSync(contract, 'import sdk = require("@unbrained/pm-cli/sdk"); import {onlyImport} from "@unbrained/pm-cli/sdk"; export declare const use: typeof sdk.api.onlyImport;');
    symlinkSync(dirname(dirname(compiler)), join(project, "node_modules/typescript"), "junction");
    writeFileSync(join(project, "consumer.cts"), 'import {use} from "./contract.cjs"; export const value = use;');
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], noEmit: true, module: "NodeNext"}, files: ["consumer.cts"]}));
    const matrix = await checkSdkContracts({minimum: {root: rootSdk, version: pinned}, current: {root: rootSdk, version: pinned}, consumer: project});
    assert.equal(matrix.failed, 2, `${layout}: both selected bounds must reject the consumer`);
    for (const row of matrix.rows) {
      assert.ok(row.codes.includes("TS2305"), `${layout}: ${row.codes}`);
      assert.ok(row.codes.includes("TS2339"), `${layout}: ${row.codes}`);
    }
  });
});

test("native SDK exports honor string, conditional, wildcard, blocked and missing-file targets", async t => {
  const root = join(scratch(t), "sdk"); cpSync(sdk, root, { recursive: true });
  const file = join(root, "package.json");
  const metadata = JSON.parse(readFileSync(file, "utf8")) as { exports: Record<string, unknown> };
  Object.assign(metadata.exports, {
    "./sdk/string": "./dist/sdk/authoring.d.ts",
    "./sdk/conditional": { import: { types: "./dist/sdk/authoring.d.ts" } },
    "./sdk/pattern/*": { types: "./dist/sdk/*.d.ts" },
    "./sdk/blocked": null,
    "./sdk/missing-file": { types: "./dist/sdk/does-not-exist.d.ts" },
    "./sdk/quoted'alias": { types: "./dist/sdk/authoring.d.ts" },
  });
  writeFileSync(file, JSON.stringify(metadata));
  const names = ["string", "conditional", "pattern/authoring", "blocked", "missing-file", "quoted'alias"];
  const result = await checkSdkContracts({ minimum: { root, version: pinned }, current: { root, version: pinned }, compiler,
    examples: names.map((name, index) => ({ id: `export-${index}`, source: `import * as sdk from "@unbrained/pm-cli/sdk/${name}"; export const api = sdk;` })) });
  assert.equal(result.failed, 4); assert.equal(result.checks, 12);
  for (const row of result.rows) {
    const missing = ["export-3", "export-4"].includes(row.example);
    assert.equal(row.ok, !missing);
    if (missing) assert.ok(row.codes.includes("TS2307"));
  }
});

test("copied external declarations resolve newer-only real SDK APIs as minimum drift under npm and Bun", async t => {
  const root = scratch(t);
  for (const runtime of ["npm", "bun"] as const) {
    const project = installedConsumer(runtime, "current");
    const config = consumerConfig(project, "nodenext", "esm").replace('"types": []', '"types": ["node"]');
    writeFileSync(join(project, "tsconfig.json"), config);
    writeFileSync(join(project, "contract.d.mts"), 'import * as sdk from "@unbrained/pm-cli/sdk"; export declare const publicSdk: typeof sdk;');
    writeFileSync(join(project, "consumer.mts"), 'import {publicSdk} from "./contract.mjs"; export const lease = publicSdk.acquireLockLease;');
    const receipt = join(root, `${runtime}.jsonl`); instrumentOracle(project, receipt, t);
    const matrix = await checkSdkContracts({
      minimum: { root: join(installedConsumer(runtime, "minimum"), "node_modules/@unbrained/pm-cli"), version: minimumVersion },
      current: { root: join(project, "node_modules/@unbrained/pm-cli"), version: currentVersion }, consumer: project,
    });
    compareOracle(matrix, receipt, project, config);
    assertLeaseDrift(matrix);
  }
});

test("an inline compiler installation without ambient Node types reports TS2688 rather than ignoring environment errors", async t => {
  const root = scratch(t), modules = join(root, "node_modules");
  mkdirSync(modules);
  symlinkSync(dirname(dirname(compiler)), join(modules, "typescript"), "junction");
  const matrix = await checkSdkContracts({ minimum: target, current: target, compiler: join(modules, "typescript/bin/tsc"),
    examples: [{ id: "ambient", source: "export const value = 1;" }] });
  assert.equal(matrix.failed, 2);
  assert.ok(matrix.rows.every(row => row.codes.includes("TS2688")));
});
