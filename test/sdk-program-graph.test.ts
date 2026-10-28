/** Compiler-owned project graphs and usage-mode resolutions match real build verdicts. */
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {cpSync, mkdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import test from "node:test";
import {checkSdkContracts, SdkContractRefusal} from "../sdk-contracts.ts";
import {apiConsumer, dependencyBound, directApiDiagnostics, filesystemSnapshot} from "./dependency-fixtures.ts";

/** Check the real binary in an independent writable copy; never parse compiler text. */
function buildVerdict(project: string): boolean {
  const oracle = join(dirname(project), "build-oracle");
  cpSync(project, oracle, {recursive: true, verbatimSymlinks: true});
  try {
    const result = spawnSync(process.execPath, [join(oracle, "node_modules/typescript/bin/tsc"), "--build", "--force", join(oracle, "tsconfig.json"), "--pretty", "false"], {
      encoding: "utf8", timeout: 30000,
      env: {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/TOKEN|SECRET|PASSWORD|CREDENTIAL|NPM_MEDIA_SERVER|NODE_OPTIONS|NODE_PATH|NODE_V8_COVERAGE/i.test(key))), NPM_CONFIG_USERCONFIG: "/dev/null"},
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.ok(result.status === 0 || result.status === 1 || result.status === 2, result.stderr);
    return result.status === 0;
  } finally { rmSync(oracle, {recursive: true, force: true}); }
}

/** Compare full API diagnostics and independently verify the build binary's verdict. */
async function agreesWithBuild(project: string, bound: ReturnType<typeof dependencyBound>): Promise<void> {
  const expected = directApiDiagnostics(project), ok = buildVerdict(project), before = filesystemSnapshot(project);
  assert.equal(expected.length === 0, ok, JSON.stringify(expected));
  const matrix = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
  for (const row of matrix.rows) { assert.equal(row.ok, ok); assert.deepEqual(row.diagnostics, expected); }
  assert.equal(filesystemSnapshot(project), before);
}

/** Select distinct declaration branches so the wrong usage mode changes the diagnostic verdict. */
function conditionalSdk(root: string, version: string, branch: string): void {
  const exports = branch === "dual" ? {import: "./import.d.mts", require: "./require.d.mts"} : {[branch]: `./${branch}.d.mts`};
  writeFileSync(join(root, "package.json"), JSON.stringify({name: "@unbrained/pm-cli", version, type: "module", exports: {".": exports}}));
  for (const mode of ["import", "require"]) writeFileSync(join(root, mode + ".d.mts"), `export declare const sdk: "${mode}";`);
}

test("program review retains require usage in an mts consumer", async t => {
  const {project, bound} = apiConsumer(t); conditionalSdk(bound.root, bound.version, "require");
  writeFileSync(join(project, "consumer.mts"), 'import sdk = require("@unbrained/pm-cli"); export const value: "require" = sdk.sdk;');
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], module: "NodeNext"}, files: ["consumer.mts"]}));
  assert.deepEqual(directApiDiagnostics(project), []);
  await agreesWithBuild(project, bound);
});

test("program refuses typesVersions resolutions without a compiler package identity", async t => {
  const {project, bound} = apiConsumer(t);
  writeFileSync(join(bound.root, "package.json"), JSON.stringify({name: "@unbrained/pm-cli", version: bound.version, types: "index.d.ts", typesVersions: {">=5.9": {"*": ["selected.d.ts"]}}}));
  writeFileSync(join(bound.root, "selected.d.ts"), 'export declare const sdk: "current";');
  for (const resolution of ["Node16", "NodeNext", "Bundler"]) for (const kind of ["mts", "cts"]) {
    const file = "consumer." + kind;
    writeFileSync(join(project, file), kind === "mts" ? 'import {sdk} from "@unbrained/pm-cli/sdk"; export const value: "current" = sdk;' : 'import sdk = require("@unbrained/pm-cli/sdk"); export const value: "current" = sdk.sdk;');
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], moduleResolution: resolution, module: resolution === "Bundler" ? "Preserve" : resolution}, files: [file]}));
    assert.deepEqual(directApiDiagnostics(project), []);
    await assert.rejects(checkSdkContracts({consumer: project, minimum: bound, current: bound}), error => error instanceof SdkContractRefusal && error.code === "isolation_refused" && error.remedy.includes("selected.d.ts"));
  }
});

test("program keeps symlinked config origins for relative extends and files", async t => {
  const {project, bound} = apiConsumer(t); mkdirSync(join(project, "config"));
  writeFileSync(join(project, "base.json"), '{"compilerOptions":{"types":[],"lib":["ES5"],"module":"NodeNext"}}');
  writeFileSync(join(project, "config/base.json"), '{"compilerOptions":{"unknownWrongOrigin":true}}');
  writeFileSync(join(project, "config/template.json"), '{"extends":"./base.json","files":["consumer.ts"]}');
  rmSync(join(project, "tsconfig.json")); symlinkSync("config/template.json", join(project, "tsconfig.json"));
  assert.deepEqual(directApiDiagnostics(project).map(d => d.code), ["TS2322"]);
  await agreesWithBuild(project, bound);
});

test("program source aliases use canonical diagnostic filenames without changing module kind", async t => {
  const {project, bound} = apiConsumer(t);
  for (const extension of ["mts", "cts", "ts"]) {
    const file = "alias." + extension; symlinkSync("consumer.ts", join(project, file));
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], module: "NodeNext"}, files: [file]}));
    const expected = directApiDiagnostics(project); assert.deepEqual(expected.map(d => [d.code, d.file]), [["TS2322", "consumer.ts"]]);
    await agreesWithBuild(project, bound);
  }
});

for (const version of ["5.9.3", "6.0.3"]) test(`program graph and module-mode properties TypeScript ${version}`, async t => {
  const {project, bound} = apiConsumer(t, version); rmSync(join(project, "consumer.ts"));
  await t.test("module syntax by file kind and conditional export", async () => {
    const syntaxes = [
      {name: "import", source: 'import {sdk} from "@unbrained/pm-cli"; export {sdk};'},
      {name: "require", source: 'import sdk = require("@unbrained/pm-cli"); export {sdk};'},
      {name: "dynamic", source: 'export const value = import("@unbrained/pm-cli");'},
      {name: "type", source: 'import type {sdk} from "@unbrained/pm-cli"; export type Value = typeof sdk;'},
      ...["import", "require"].map(mode => ({name: "type-" + mode, source: `import type {sdk} from "@unbrained/pm-cli" with {"resolution-mode":"${mode}"}; export type Value = typeof sdk;`})),
      ...["import", "require"].map(mode => ({name: "query-" + mode, source: `export type Value = typeof import("@unbrained/pm-cli", {with:{"resolution-mode":"${mode}"}}).sdk;`})),
      {name: "mixed", source: 'import sdk = require("@unbrained/pm-cli"); export const required: "require" = sdk.sdk; export const loaded = import("@unbrained/pm-cli").then(value => {const imported: "import" = value.sdk; return imported;});'},
    ];
    for (const extension of ["mts", "cts", "ts"]) for (const branch of ["require", "import", "dual"]) for (const syntax of syntaxes) {
      const file = "consumer." + extension;
      conditionalSdk(bound.root, bound.version, branch);
      writeFileSync(join(project, file), syntax.source);
      writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES2022"], module: "NodeNext", composite: true, outDir: "dist"}, files: [file]}));
      await agreesWithBuild(project, bound); rmSync(join(project, file));
    }
  });
  t.diagnostic("81 syntax/file/export combinations; complete API diagnostics and real tsc --build verdict agree");
});
