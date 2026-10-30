/** Reference graphs are refused before stale declarations or package roots can affect a matrix. */
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {cpSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {basename, join} from "node:path";
import test from "node:test";
import {checkSdkContracts, SdkContractRefusal} from "../sdk-contracts.ts";
import {apiConsumer, boundaryRandom, directApiDiagnostics, assertProjectShapeRefusal, assertApiMatrix} from "./dependency-fixtures.ts";

/** Refusals identify both configs, explain the supported alternative and leave inputs untouched. */
async function refused(project: string, bound: ReturnType<typeof apiConsumer>["bound"], target: string): Promise<void> {
  await assertProjectShapeRefusal(project, bound, error => {
    assert.ok(error.remedy.includes('"tsconfig.json"'), error.remedy); assert.ok(error.remedy.includes(JSON.stringify(target)), error.remedy);
    assert.match(error.remedy, /each referenced project separately as its own root, or flatten the references/);
  });
}

/** Warm a real build or force its cold recheck without parsing compiler output. */
function build(project: string): {status: number | null; stdout: string} {
  const result = spawnSync(process.execPath, [join(project, "node_modules/typescript/bin/tsc"), "-b", "--force", "--pretty", "false"], {cwd: project, encoding: "utf8", timeout: 30000});
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  return {status: result.status, stdout: result.stdout};
}

for (const version of ["5.9.3", "6.0.3"]) {
  test(`reference refusal: warm inferred current-only declaration TypeScript ${version}`, async t => {
    const {root, project, bound} = apiConsumer(t, version);
    writeFileSync(join(bound.root, "index.d.ts"), "export declare function api(): {currentOnly: 1};");
    mkdirSync(join(project, "library"));
    writeFileSync(join(project, "library/index.ts"), 'import {api} from "@unbrained/pm-cli"; export const inferred = api();');
    const options = {types: [], lib: ["ES5"], module: "NodeNext", composite: true, outDir: "dist"};
    writeFileSync(join(project, "library/tsconfig.json"), JSON.stringify({compilerOptions: options, files: ["index.ts"]}));
    writeFileSync(join(project, "consumer.ts"), 'import {inferred} from "./library/dist/index.js"; export const value = inferred.currentOnly;');
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: options, files: ["consumer.ts"], references: [{path: "library"}]}));
    assert.equal(build(project).status, 0);
    const cold = join(root, "minimum-rebuild"); cpSync(project, cold, {recursive: true});
    writeFileSync(join(cold, "node_modules/@unbrained/pm-cli/index.d.ts"), "export declare function api(): {};");
    const rebuilt = build(cold); assert.notEqual(rebuilt.status, 0); assert.match(rebuilt.stdout, /TS2339/);
    // Existing declarations really contain the current-only inference before refusal.
    assert.match(readFileSync(join(project, "library/dist/index.d.ts"), "utf8"), /currentOnly/);
    await refused(project, bound, "library/tsconfig.json");
  });
}

test("reference refusal: nested foreign SDK root cannot grant relative declarations an identity", async t => {
  const {project, bound} = apiConsumer(t), foreign = join(project, "foreign-sdk"); mkdirSync(foreign);
  writeFileSync(join(foreign, "package.json"), '{"name":"@unbrained/pm-cli","version":"2.0.0","type":"module"}');
  writeFileSync(join(foreign, "index.d.ts"), "export declare const currentOnly: 1;");
  writeFileSync(join(foreign, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], composite: true}, files: ["index.d.ts"]}));
  writeFileSync(join(project, "consumer.ts"), 'export {currentOnly} from "./foreign-sdk/index.js";');
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], module: "NodeNext"}, files: ["consumer.ts"], references: [{path: "foreign-sdk"}]}));
  assert.deepEqual(directApiDiagnostics(project), []);
  await refused(project, bound, "foreign-sdk/tsconfig.json");
});

for (const version of ["5.9.3", "6.0.3"]) test(`reference graph refusal property TypeScript ${version}`, async t => {
  const {project, bound} = apiConsumer(t, version), random = boundaryRandom(15414);
  for (let sample = 0; sample < 24; sample++) {
    const depth = 1 + random() % 3, foreign = sample % 3 === 0, invalid = sample % 2 === 0;
    for (let level = 0; level < depth; level++) {
      const directory = join(project, "p" + level); mkdirSync(directory, {recursive: true});
      writeFileSync(join(directory, "index.d.ts"), 'export declare const value: "current";');
      writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], composite: true}, files: ["index.d.ts"], references: [{path: "../p" + ((level + 1) % depth)}]}));
    }
    const nested = join(project, "foreign"); mkdirSync(nested);
    writeFileSync(join(nested, "package.json"), '{"name":"@unbrained/pm-cli","version":"2.0.0"}');
    writeFileSync(join(nested, "index.d.ts"), "export declare const foreign: 1;");
    writeFileSync(join(nested, "tsconfig.json"), '{"compilerOptions":{"types":[],"composite":true},"files":["index.d.ts"]}');
    writeFileSync(join(project, "consumer.ts"), foreign ? 'export {foreign} from "./foreign/index.js";' : 'import {value} from "./p0/index.js"; export const result: ' + (invalid ? '"wrong"' : '"current"') + ' = value;');
    const config = {compilerOptions: {types: [], lib: ["ES5"], module: "NodeNext"}, files: ["consumer.ts"]};
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify(config));
    // The no-reference domain retains its previous API verdict and package-boundary refusal.
    if (foreign) await assert.rejects(checkSdkContracts({consumer: project, minimum: bound, current: bound}), error => error instanceof SdkContractRefusal && error.code === "unsupported_project_shape" && error.reason === "multiple_sdk_copies");
    else await assertApiMatrix(project, bound, directApiDiagnostics(project));
    const target = foreign ? "foreign" : "p0";
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({...config, references: [{path: target}]}));
    await refused(project, bound, target + "/tsconfig.json");
    for (let level = 0; level < depth; level++) rmSync(join(project, "p" + level), {recursive: true});
    rmSync(nested, {recursive: true});
  }
  t.diagnostic("24 generated graphs with cycles, depth 1–3, nested foreign SDKs and relative imports; paired reference-free controls");
});

test("reference refusal names an external referenced config by file name only", async t => {
  const {root, project, bound} = apiConsumer(t), external = join(root, "outside-library"); mkdirSync(external);
  writeFileSync(join(external, "index.d.ts"), "export declare const shared: 1;");
  writeFileSync(join(external, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], composite: true}, files: ["index.d.ts"]}));
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], module: "NodeNext"}, files: ["consumer.ts"], references: [{path: external}]}));
  await assertProjectShapeRefusal(project, bound, error => {
    // The private copy's relative path to an external config would walk the caller's filesystem ("../../…").
    assert.ok(!error.remedy.includes(".."), error.remedy);
    assert.ok(!error.remedy.includes(basename(root)) && !error.remedy.includes("outside-library"), error.remedy);
    assert.ok(error.remedy.includes('"tsconfig.json" references "tsconfig.json"'), error.remedy);
  });
});
