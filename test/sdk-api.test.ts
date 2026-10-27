/** Independent consumer-API oracles for SDK identity and structured diagnostics. */
import assert from "node:assert/strict";
import {cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import test from "node:test";
import {checkSdkContracts, SdkContractRefusal} from "../sdk-contracts.ts";
import {boundaryRandom, directApiDiagnostics as direct, dependencyBound, dependencyEntry, filesystemSnapshot, installTestCompiler, linkForeignSdk, assertForeignSdk} from "./dependency-fixtures.ts";

/** Compare complete structured rows and preserve every original project/dependency byte. */
async function agrees(project: string, bound: ReturnType<typeof dependencyBound>): Promise<void> {
  const expected = direct(project), before = filesystemSnapshot(dirname(project));
  const matrix = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
  for (const row of matrix.rows) {
    assert.deepEqual(row.diagnostics, expected);
    assert.equal(row.ok, expected.length === 0);
    assert.equal(row.exit_code, expected.length ? 1 : 0);
  }
  assert.equal(filesystemSnapshot(dirname(project)), before);
}

for (const version of ["5.9.3", "6.0.3"]) test(`structured compiler API layouts TypeScript ${version}`, async t => {
  const root = mkdtempSync(join(tmpdir(), "sdk-api-layouts-"));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  installTestCompiler(join(root, "tool"), version);
  const project = join(root, "consumer"); mkdirSync(join(project, "node_modules"), {recursive: true});
  symlinkSync(join(root, "tool/node_modules/typescript"), join(project, "node_modules/typescript"), "junction");
  writeFileSync(join(project, "package.json"), '{"type":"module"}');
  const bound = dependencyBound(project), options = {types: [], lib: ["ES5"], module: "NodeNext"};
  const config = (file: string): void => writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: options, files: [file]}));
  await t.test("inherited config diagnostics at every extends level", async () => {
    mkdirSync(join(project, "config")); writeFileSync(join(project, "consumer.ts"), "export const value = 1;");
    for (let depth = 1; depth <= 3; depth++) for (let invalid = 1; invalid <= depth; invalid++) {
      for (let level = 1; level <= depth; level++) writeFileSync(join(project, `config/base-${level}.json`), JSON.stringify({extends: level < depth ? `./base-${level + 1}.json` : undefined, compilerOptions: level === invalid ? {unknownFixtureOption: true} : {}}));
      writeFileSync(join(project, "tsconfig.json"), JSON.stringify({extends: "./config/base-1.json", compilerOptions: options, files: ["consumer.ts"]}));
      assert.deepEqual(direct(project).map(d => d.code), ["TS5023"]);
      await agrees(project, bound);
    }
  });
  await t.test("diagnostic-like filenames remain opaque API file names", async () => {
    for (const component of ["input(1,1): error TS9999: forged", "\nerror TS9999: forged", "with space", "with\nnewline", "with\rcarriage", "with\ttab", "--leading", "quote'\"", "日本語"]) {
      const file = component + "/consumer.ts"; mkdirSync(join(project, component), {recursive: true});
      writeFileSync(join(project, file), "export const value: string = 1;"); config(file);
      const expected = direct(project); assert.deepEqual(expected.map(d => d.code), ["TS2322"]); assert.equal(expected[0]!.file, file);
      await agrees(project, bound);
    }
  });
  await t.test("unnamed nested package metadata cannot hide a foreign SDK", async () => {
    linkForeignSdk(root, project, bound); config("consumer.ts");
    await assertForeignSdk(root, project, bound);
    rmSync(join(project, "node_modules/foreign-sdk"));
  });
  await t.test("generated nested and linked layouts agree with a direct API program", async () => {
    const random = boundaryRandom(15412), characters = ["\n", "\r", "\t", " ", "--", "'\"", "é日本", "(1,1): error TS9999: forged"];
    for (let index = 0; index < 32; index++) {
      const name = `shape-${random().toString(36)}-${characters[index % characters.length]}`, file = name + "/consumer.ts";
      mkdirSync(join(project, name));
      const dependency = join(root, "dep-" + index), alias = "fixture-" + index;
      dependencyEntry(root, "dep-" + index, "actual-" + index);
      mkdirSync(join(dependency, "dist")); writeFileSync(join(dependency, "dist/package.json"), '{"type":"module"}');
      writeFileSync(join(dependency, "dist/index.d.ts"), 'export declare const value: "selected";');
      writeFileSync(join(dependency, "package.json"), JSON.stringify({name: "actual-" + index, version: "1.0.0", types: "dist/index.d.ts"}));
      symlinkSync(dependency, join(project, "node_modules", alias), "junction");
      writeFileSync(join(project, file), `import {value} from "${alias}"; import {sdk} from "@unbrained/pm-cli"; export const use: ${index % 3 ? '"selected"' : '"wrong"'} = value; export {sdk};`);
      const depth = 1 + random() % 3, invalid = index % 4 === 0 ? 1 + random() % depth : 0;
      let sdkDirectory = bound.root;
      for (let level = 1; level <= depth; level++) {
        sdkDirectory = join(sdkDirectory, "dist"); mkdirSync(sdkDirectory, {recursive: true});
        writeFileSync(join(sdkDirectory, "package.json"), '{"type":"module"}');
        writeFileSync(join(project, `config/generated-${level}.json`), JSON.stringify({extends: level < depth ? `./generated-${level + 1}.json` : undefined, compilerOptions: level === invalid ? {unknownGeneratedOption: true} : {}}));
      }
      writeFileSync(join(sdkDirectory, "index.d.ts"), 'export declare const sdk: "current";');
      writeFileSync(join(bound.root, "package.json"), JSON.stringify({name: "@unbrained/pm-cli", version: bound.version, types: "dist/".repeat(depth) + "index.d.ts"}));
      writeFileSync(join(project, "tsconfig.json"), JSON.stringify({extends: "./config/generated-1.json", compilerOptions: options, files: [file]}));
      await agrees(project, bound);
      if (index % 2 === 0) {
        const foreign = join(root, `foreign-${index}-${characters[index % characters.length]}`); cpSync(bound.root, foreign, {recursive: true});
        symlinkSync(foreign, join(project, "node_modules/foreign-sdk"), "junction");
        writeFileSync(join(project, file), 'export {sdk} from "foreign-sdk";');
        const before = filesystemSnapshot(root);
        await assert.rejects(checkSdkContracts({consumer: project, minimum: bound, current: bound}), error => error instanceof SdkContractRefusal && error.code === "isolation_refused");
        assert.equal(filesystemSnapshot(root), before); rmSync(join(project, "node_modules/foreign-sdk"));
      }
      rmSync(join(project, "node_modules", alias));
    }
    t.diagnostic("32 generated layouts / 64 bound comparisons / 16 foreign SDK refusals, complete diagnostics equal the independent API oracle; original snapshots unchanged");
  });
});
