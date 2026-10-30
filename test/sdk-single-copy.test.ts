/** One SDK root closes vendored, nested, relative and linked declaration inheritance together. */
import assert from "node:assert/strict";
import {cpSync, mkdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {isAbsolute, join, relative, sep} from "node:path";
import test from "node:test";
import {apiConsumer, boundaryRandom, directApiDiagnostics, assertProjectShapeRefusal, assertApiMatrix} from "./dependency-fixtures.ts";

/** Materialize a wrapper re-export at arbitrary depth, retaining each package's own metadata. */
function wrapper(project: string, bound: ReturnType<typeof apiConsumer>["bound"], depth: number, second: boolean, linked: boolean, external?: string, nativeAlias = false): string {
  const root = join(project, "node_modules/wrapper"); mkdirSync(root, {recursive: true});
  writeFileSync(join(root, "package.json"), '{"name":"wrapper","version":"1.0.0","types":"index.d.ts"}');
  let current = root;
  for (let level = 0; level < depth; level++) {
    current = join(current, "nested" + level); mkdirSync(current);
    writeFileSync(join(current, "package.json"), JSON.stringify({name: "wrapper-part-" + level, version: "1.0.0"}));
  }
  const sdk = second ? external ?? join(current, "vendored-sdk") : bound.root;
  if (second) {
    cpSync(bound.root, sdk, {recursive: true});
    writeFileSync(join(sdk, "package.json"), '{"name":"@unbrained/pm-cli","version":"2.0.0","types":"dist/index.d.ts"}');
    mkdirSync(join(sdk, "dist")); writeFileSync(join(sdk, "dist/package.json"), '{"type":"module"}');
    writeFileSync(join(sdk, "dist/index.d.ts"), 'export declare const onlyCurrent: "current";');
  }
  const target = linked ? join(current, "sdk-link") : sdk;
  if (linked) symlinkSync(sdk, target, "junction");
  if (nativeAlias) {
    const scope = join(root, "node_modules/@unbrained"); mkdirSync(scope, {recursive: true});
    symlinkSync(target, join(scope, "pm-cli"), "junction");
    if (second) writeFileSync(join(sdk, "package.json"), '{"name":"@unbrained/pm-cli","version":"1.0.0","types":"index.d.ts"}');
    writeFileSync(join(root, "index.d.ts"), 'export {sdk as value} from "@unbrained/pm-cli";'); return root;
  }
  const specifier = "./" + relative(root, join(target, second ? "dist/index.js" : "index.js")).split(sep).join("/");
  writeFileSync(join(root, "index.d.ts"), `export {${second ? "onlyCurrent" : "sdk"} as value} from ${JSON.stringify(specifier)};`);
  return root;
}

/** Both root labels and the typed reason survive the private JSON channel without partial rows. */
async function refusesCopies(project: string, bound: ReturnType<typeof apiConsumer>["bound"]): Promise<void> {
  await assertProjectShapeRefusal(project, bound, error => {
    assert.equal(error.reason, "multiple_sdk_copies"); assert.equal(error.roots?.length, 2);
    assert.ok(error.roots?.includes("node_modules/@unbrained/pm-cli")); assert.ok(error.roots?.every(root => !isAbsolute(root)));
    assert.match(error.remedy, /Dedupe to one @unbrained\/pm-cli/);
  });
}

test("vendored wrapper review refuses the current-only SDK that direct minimum imports reject", async t => {
  const {project, bound} = apiConsumer(t);
  writeFileSync(join(project, "consumer.ts"), 'import {onlyCurrent} from "@unbrained/pm-cli"; export {onlyCurrent};');
  assert.deepEqual(directApiDiagnostics(project).map(d => d.code), ["TS2305"]);
  wrapper(project, bound, 2, true, false);
  writeFileSync(join(project, "consumer.ts"), 'import {sdk} from "@unbrained/pm-cli"; import {value} from "wrapper"; export const result: "current" = value; export {sdk};');
  assert.deepEqual(directApiDiagnostics(project), []);
  await refusesCopies(project, bound);
});

for (const version of ["5.9.3", "6.0.3"]) test(`single SDK root dependency-tree property TypeScript ${version}`, async t => {
  const {root, project, bound} = apiConsumer(t, version), random = boundaryRandom(15415);
  for (let sample = 0; sample < 16; sample++) {
    const depth = random() % 4, linked = Boolean(random() % 2), invalid = Boolean(random() % 2);
    for (const second of [false, true]) {
      const external = second && sample % 4 === 0 ? join(root, "external-sdk") : undefined;
      const entry = wrapper(project, bound, depth, second, linked || Boolean(external), external, sample % 3 === 1);
      writeFileSync(join(project, "consumer.ts"), `import {sdk} from "@unbrained/pm-cli"; import {value} from "wrapper"; export const result: ${invalid ? '"wrong"' : '"current"'} = value; export {sdk};`);
      const expected = directApiDiagnostics(project);
      assert.deepEqual(expected.map(d => d.code), invalid ? ["TS2322"] : []);
      if (second) await refusesCopies(project, bound);
      else await assertApiMatrix(project, bound, expected);
      rmSync(entry, {recursive: true}); if (external) rmSync(external, {recursive: true});
    }
  }
  t.diagnostic("16 paired trees / 32 variants: depth 0–3, wrappers, relative re-exports, links, same-version aliases and external SDK roots; single-copy verdicts equal native diagnostics");
});

test("SDK-specifier declarations outside the selected root name the consumer root", async t => {
  const {project, bound} = apiConsumer(t);
  writeFileSync(join(project, "shadow.d.ts"), 'export declare const onlyCurrent: 1;');
  writeFileSync(join(project, "consumer.ts"), 'export {onlyCurrent} from "@unbrained/pm-cli";');
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], lib: ["ES5"], paths: {"@unbrained/pm-cli": ["./shadow.d.ts"]}}, files: ["consumer.ts"]}));
  assert.deepEqual(directApiDiagnostics(project), []);
  await assertProjectShapeRefusal(project, bound, error => {assert.equal(error.reason, "multiple_sdk_copies"); assert.ok(error.roots?.includes("."));});
});

for (const [name, metadata] of [["an SDK-named", '{"name":"@unbrained/pm-cli","version":"9.9.9"}'], ["a malformed", "{ not json"]] as const) {
  test(`${name} package.json above the scratch copy never joins SDK ownership`, async t => {
    const {root, project, bound} = apiConsumer(t);
    // The checker's scratch copy lives under TMPDIR; plant decoy metadata in that shared ancestor.
    const decoy = join(root, "shared-tmp"); mkdirSync(decoy); writeFileSync(join(decoy, "package.json"), metadata);
    const previous = process.env.TMPDIR; process.env.TMPDIR = decoy;
    t.after(() => { if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous; });
    writeFileSync(join(project, "consumer.ts"), "export const value = 1;");
    await assertApiMatrix(project, bound, []);
  });
}
