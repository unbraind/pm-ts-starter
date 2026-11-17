/** Sandbox dependency, registry allowlist and round 9/10 dependency-shape contracts. Part e of the SDK contract suite; see sdk-contracts-support.ts. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, readdirSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { Worker } from "node:worker_threads";
import {dependencyEntry, testCompiler, directApiDiagnostics, dependencyBound, filesystemSnapshot, boundaryRandom, INSTALL_TIMEOUT_MS, bunExecutable} from "./dependency-fixtures.ts";
import { SdkContractRefusal, type SdkContractOptions } from "../sdk-contracts.ts";
import { testDepth, testTimeout } from "./support/depth.ts";
import test, { type TestContext } from "node:test";
import { sdk, target, compiler, checkSdkContracts, installationEnv, scratch, refuses, command, packedFixture, linkedCompilerConsumer, noEmitConsumer, restoreEnvironment, plainCopy, assertPlainRows } from "./sdk-contracts-support.ts";

test("plain compiler oracle removes its baseline before returning the verdict", t => {
  const project = noEmitConsumer(t);
  const temporary = scratch(t);
  const tempKeys = ["TMPDIR", "TEMP", "TMP"];
  const previous = tempKeys.map(key => process.env[key]);
  try {
    for (const key of tempKeys) process.env[key] = temporary;
    assert.deepEqual(plainCopy(project, t), {ok: true, codes: []});
    writeFileSync(join(project, "consumer.mts"), 'export const value: string = 1;');
    assert.deepEqual(plainCopy(project, t), {ok: false, codes: ["TS2322"]});
    for (const directory of readdirSync(temporary)) {
      assert.deepEqual(readdirSync(join(temporary, directory)), [], "the oracle must remove the copied project immediately");
    }
  } finally {
    restoreEnvironment(tempKeys, previous);
  }
});

test("real noEmit delegation prevents allowJs output collisions while preserving config bytes", async t => {
  const project = linkedCompilerConsumer(t);
  writeFileSync(join(project, "consumer.js"), "export const value = 1;");
  for (const outDir of [undefined, "dist"]) {
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {allowJs: true, types: [], module: "NodeNext", outDir}, files: ["consumer.js"]}));
    const expected = plainCopy(project, t), before = filesystemSnapshot(project);
    assert.equal(expected.ok, true);
    assert.deepEqual(expected.codes, []);
    const matrix = await checkSdkContracts({minimum: target, current: target, consumer: project});
    assertPlainRows(matrix, expected);
    assert.equal(filesystemSnapshot(project), before);
  }
});

test("unmodified copy accepts JSON imports and ordinary quoted path literals", async t => {
  const project = linkedCompilerConsumer(t);
  writeFileSync(join(project, "consumer.mts"), 'import data from "./data.json" with {type: "json"}; export const use = {"path":"../external-data.json", "extends":"../../ordinary-data.json", value: data.path};');
  writeFileSync(join(project, "data.json"), '{"path":"../external-data.json"}');
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {resolveJsonModule: true, noEmit: true, types: [], module: "NodeNext"}, files: ["consumer.mts"]}));
  const expected = plainCopy(project, t), before = filesystemSnapshot(project);
  assert.equal(expected.ok, true);
  const matrix = await checkSdkContracts({minimum: target, current: target, consumer: project});
  assertPlainRows(matrix, expected);
  assert.equal(filesystemSnapshot(project), before);
});

test("missing compilers refuse but dependency copies never invoke broken npm installers", async t => {
  const project = join(scratch(t), "consumer");
  mkdirSync(join(project, "node_modules/empty-scope"), {recursive: true});
  writeFileSync(join(project, "tsconfig.json"), '{"files":["consumer.ts"]}');
  writeFileSync(join(project, "consumer.ts"), 'export const value = 1;');
  const original = filesystemSnapshot(project);
  await assert.rejects(checkSdkContracts({minimum: target, current: target, consumer: project}), refuses("compiler_unavailable"));
  assert.equal(filesystemSnapshot(project), original);

  const bin = scratch(t), previousPath = process.env.PATH, previousPlatform = process.platform, previousNode = process.env.npm_node_execpath, previousNpm = process.env.npm_execpath;
  for (const executable of ["npm", "npm.cmd"]) { writeFileSync(join(bin, executable), '#!/bin/sh\nexit 42\n'); chmodSync(join(bin, executable), 0o755); }
  try {
    process.env.PATH = bin;
    const fakeNode = join(bin, "node"), fakeNpm = join(bin, "npm-cli.js");
    writeFileSync(fakeNode, "unavailable runtime"); writeFileSync(fakeNpm, "process.exit(42);");
    process.env.npm_node_execpath = process.execPath; process.env.npm_execpath = fakeNpm;
    assert.equal((await checkSdkContracts({minimum: target, current: target})).ok, true);
    process.env.npm_node_execpath = fakeNode; delete process.env.npm_execpath;
    for (const platform of ["linux", "win32"]) {
      Object.defineProperty(process, "platform", {value: platform});
      assert.equal((await checkSdkContracts({minimum: target, current: target})).ok, true);
    }
  } finally {
    Object.defineProperty(process, "platform", {value: previousPlatform});
    process.env.PATH = previousPath;
    if (previousNode === undefined) delete process.env.npm_node_execpath; else process.env.npm_node_execpath = previousNode;
    if (previousNpm === undefined) delete process.env.npm_execpath; else process.env.npm_execpath = previousNpm;
  }
});

test("sandbox dependency artifacts copy original metadata without executing prepare or postinstall", async t => {
  const project = noEmitConsumer(t), dependency = join(project, "node_modules/artifact-fixture");
  mkdirSync(dependency);
  const metadata = join(dependency, "package.json");
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {noEmit: true, types: [], module: "NodeNext", resolveJsonModule: true}, files: ["consumer.mts"]}));
  for (const script of ["prepare", "postinstall"]) {
    writeFileSync(metadata, JSON.stringify({name: "artifact-fixture", version: "1.0.0", scripts: {
      [script]: 'node -e "require(\'node:fs\').writeFileSync(\'executed\',\'forbidden\');process.exit(42)"',
    }}));
    writeFileSync(join(project, "consumer.mts"), `import metadata from "artifact-fixture/package.json" with {type: "json"}; export const script: string = metadata.scripts.${script};`);
    const expected = plainCopy(project, t), original = filesystemSnapshot(project);
    assert.equal(expected.ok, true);
    assertPlainRows(await checkSdkContracts({minimum: target, current: target, consumer: project}), expected);
    assert.equal(filesystemSnapshot(project), original);
  }
  for (const malformed of ["{", "null", "[]", "42"]) {
    writeFileSync(metadata, malformed);
    await assert.rejects(checkSdkContracts({minimum: target, current: target, consumer: project}), refuses("sdk_unavailable"));
  }
});

test("implicit external emits are refused before any compiler write outside the copy", async t => {
  const project = linkedCompilerConsumer(t), outside = scratch(t);
  const source = join(outside, "external.ts"), emitted = join(outside, "external.js");
  writeFileSync(source, 'export const value = 1;'); writeFileSync(emitted, 'preserve existing external bytes');
  writeFileSync(join(project, "consumer.mts"), `import {value} from ${JSON.stringify(emitted)}; export const use = value;`);
  const original = filesystemSnapshot(outside);
  for (const output of [{}, {outDir: "dist", rootDir: "."}, {outDir: "dist", composite: true}]) {
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], module: "NodeNext", ...output}, files: ["consumer.mts"]}));
    await assert.rejects(checkSdkContracts({minimum: target, current: target, consumer: project}), error => {
      assert.ok(error instanceof SdkContractRefusal);
      assert.match(error.remedy, /external\.ts/);
      return error.code === "isolation_refused";
    });
    assert.equal(filesystemSnapshot(outside), original, "native fallback emits must not touch external files");
  }
});

test("canonical sandbox roots accept compiler file lists through a symlinked temporary directory", async t => {
  const project = noEmitConsumer(t), root = scratch(t), physical = join(root, "physical"), logical = join(root, "logical");
  mkdirSync(physical); symlinkSync(physical, logical, "junction");
  const keys = ["TMPDIR", "TMP", "TEMP"], previous = keys.map(key => process.env[key]);
  try {
    for (const key of keys) process.env[key] = logical;
    const matrix = await checkSdkContracts({minimum: target, current: target, consumer: project});
    assert.equal(matrix.checks, 2); assertPlainRows(matrix, {ok: true, codes: []});
  } finally {
    restoreEnvironment(keys, previous);
  }
});

test("direct SDK callers need no npm script environment or executable search paths", async t => {
  const project = noEmitConsumer(t);
  const keys = ["PATH", "npm_execpath", "npm_node_execpath"], previous = keys.map(key => process.env[key]);
  try {
    process.env.PATH = ""; delete process.env.npm_execpath;
    for (const runtime of [undefined, join(project, "missing-runtime")]) {
      if (runtime === undefined) delete process.env.npm_node_execpath; else process.env.npm_node_execpath = runtime;
      const matrix = await checkSdkContracts({minimum: target, current: target, consumer: project});
      assertPlainRows(matrix, {ok: true, codes: []});
    }
  } finally {
    restoreEnvironment(keys, previous);
  }
});

test("round 9 npm location tripwires survive the fixed global-prefix case and generated configurations", async t => {
  const project = noEmitConsumer(t), outside = scratch(t), home = join(outside, "home"), prefix = join(outside, "prefix");
  mkdirSync(home); mkdirSync(prefix);
  writeFileSync(join(prefix, "existing-installation"), "preserve");
  writeFileSync(join(home, ".npmrc"), `global=true\nprefix=${prefix}\ncache=${prefix}\n`);
  const keys = ["prefix", "global", "location", "cache", "userconfig", "globalconfig", "workspace", "workspaces", "install-strategy", "global-style",
    "bin-links", "script-shell", "node-options", "ignore-scripts", "foreground-scripts", "tmp", "tmpdir", "link", "install-links"];
  const envKeys = ["HOME", ...keys.flatMap(key => ["npm_config_" + key.replaceAll("-", "_"), "NPM_CONFIG_" + key.toUpperCase().replaceAll("-", "_")])];
  const previous = envKeys.map(key => process.env[key]), random = boundaryRandom(15409);
  const empty = await checkSdkContracts({minimum: target, current: target, consumer: project});
  const cases = [`global=true\nprefix=${prefix}\n`, ...Array.from({length: 12}, (_, index) => keys.map(key => {
    const values = [prefix, "../../" + prefix.slice(1), "true", "false", "global", "nested", "--require=" + join(prefix, "inject.cjs")];
    return `${key}=${values[(random() + index) % values.length]}`;
  }).join("\n"))];
  try {
    process.env.HOME = home;
    for (const [index, config] of cases.entries()) {
      writeFileSync(join(project, ".npmrc"), config);
      if (index > 0) for (const key of envKeys.slice(1)) process.env[key] = [prefix, "../" + prefix.slice(1), "true", "false"][random() % 4]!;
      const original = filesystemSnapshot(project), tripwire = filesystemSnapshot(outside);
      const checked = await checkSdkContracts({minimum: target, current: target, consumer: project});
      assert.deepEqual(checked, empty, `generated configuration ${index}: verdict equals empty npmrc`);
      assert.equal(filesystemSnapshot(project), original, `generated configuration ${index}: consumer untouched`);
      assert.equal(filesystemSnapshot(outside), tripwire, `generated configuration ${index}: HOME and prefix tripwires untouched`);
    }
  } finally { restoreEnvironment(envKeys, previous); }
  t.diagnostic(`npm property: ${cases.length} configurations, 19 keys, both environment casings, absolute and parent-relative values; all consumer/HOME/prefix tree hashes unchanged.`);
});

test("round 9 registry allowlist preserves scoped private registry credentials and CA settings", async t => {
  const project = noEmitConsumer(t), receipt = join(scratch(t), "registry.json");
  unlinkSync(join(project, "node_modules/typescript"));
  cpSync(dirname(dirname(compiler)), join(project, "node_modules/typescript"), {recursive: true});
  const directory = join(project, "node_modules/typescript"), metadataFile = join(directory, "package.json");
  const metadata = JSON.parse(readFileSync(metadataFile, "utf8"));
  writeFileSync(metadataFile, JSON.stringify({...metadata, main: "./registry-api.cjs"}));
  writeFileSync(join(directory, "registry-api.cjs"), `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(receipt)},JSON.stringify({config:fs.readFileSync('.npmrc','utf8'),home:process.env.HOME,cache:process.env.XDG_CACHE_HOME,keys:Object.keys(process.env).filter(key=>/^npm_config_/i.test(key))}));module.exports=require('./lib/typescript.js');`);
  const allowed = ["registry=https://registry.npmjs.org/", "@fixture:registry=https://registry.example.invalid/", "//registry.example.invalid/:_authToken=synthetic-fixture-token", "strict-ssl=false", "ca[]=synthetic-ca", "cafile=fixture-ca.pem"];
  // A CA file is meaningful only for TLS connections; these local artifact installs use the normal registry.
  writeFileSync(join(project, "fixture-ca.pem"), "synthetic-ca");
  writeFileSync(join(project, ".npmrc"), allowed.join("\n") + "\nprefix=../../escape\nignore-scripts=false\nnode-options=--require=forbidden\n");
  const original = filesystemSnapshot(project);
  assert.equal((await checkSdkContracts({minimum: target, current: target, consumer: project})).ok, true);
  const observed = JSON.parse(readFileSync(receipt, "utf8")) as {config: string; home: string; cache: string; keys: string[]};
  assert.deepEqual(observed.config.trim().split("\n"), allowed);
  assert.deepEqual(observed.keys, []);
  assert.ok(observed.cache.startsWith(observed.home + "/"));
  assert.equal(filesystemSnapshot(project), original);
});

test("round 9 scoped registry must-allow preserves a real authenticated private dependency without network", async t => {
  const project = noEmitConsumer(t), root = scratch(t), artifact = join(root, "artifact"), receipt = join(root, "requests.jsonl");
  mkdirSync(artifact);
  writeFileSync(join(artifact, "package.json"), JSON.stringify({name: "@fixture/private", version: "1.0.0", types: "index.d.ts"}));
  writeFileSync(join(artifact, "index.d.ts"), "export declare const value: number;");
  const tarball = packedFixture(artifact, root);
  const server = spawn(process.execPath, ["--input-type=module", "-e", `import {createServer} from 'node:http'; import {readFileSync,appendFileSync} from 'node:fs';
const tarball=readFileSync(${JSON.stringify(tarball)});
const server=createServer((req,res)=>{
  const authenticated=req.headers.authorization==='Bearer synthetic-fixture-token';
  appendFileSync(${JSON.stringify(receipt)},JSON.stringify({authenticated})+'\\n');
  if(!authenticated){res.writeHead(401);res.end();return;}
  if(req.url.endsWith('.tgz')){res.end(tarball);return;}
  res.setHeader('content-type','application/json');
  res.end(JSON.stringify({name:'@fixture/private','dist-tags':{latest:'1.0.0'},versions:{'1.0.0':{name:'@fixture/private',version:'1.0.0',dist:{tarball:'http://127.0.0.1:'+server.address().port+'/private.tgz'}}}}));
});server.listen(0,'127.0.0.1',()=>console.log(server.address().port));`], {stdio: ["ignore", "pipe", "pipe"]});
  t.after(() => server.kill());
  const port = await new Promise<string>((resolvePort, reject) => {
    server.stdout.once("data", chunk => resolvePort(String(chunk).trim()));
    server.once("error", reject); server.once("exit", () => reject(new Error("registry exited before readiness")));
  });
  const provision = join(root, "provision"); mkdirSync(provision);
  const npmrc = `@fixture:registry=http://127.0.0.1:${port}/\n//127.0.0.1:${port}/:_authToken=synthetic-fixture-token\n`;
  writeFileSync(join(provision, ".npmrc"), npmrc);
  const install = spawnSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "@fixture/private@1.0.0"], {cwd: provision, encoding: "utf8", timeout: testTimeout(30000), env: installationEnv()});
  assert.equal(install.status, 0, install.stderr || install.stdout || install.error?.message || "Package installation failed.");
  cpSync(join(provision, "node_modules/@fixture"), join(project, "node_modules/@fixture"), {recursive: true});
  writeFileSync(join(project, ".npmrc"), npmrc + "global=true\nprefix=../../tripwire\n");
  const requestBytes = readFileSync(receipt, "utf8");
  writeFileSync(join(project, "consumer.mts"), 'import {value} from "@fixture/private"; export const use: number = value;');
  const before = filesystemSnapshot(project);
  assert.equal((await checkSdkContracts({minimum: target, current: target, consumer: project})).ok, true);
  assert.equal(readFileSync(receipt, "utf8"), requestBytes, "checker never contacts the registry");
  const requests = requestBytes.trim().split("\n").map(line => JSON.parse(line) as {authenticated: boolean});
  assert.ok(requests.length >= 2); assert.ok(requests.every(request => request.authenticated));
  assert.equal(filesystemSnapshot(project), before);
});


/** Compare the current checker bound to an untouched independent copy, including failing controls. */
async function dependencyOracle(project: string, bound: SdkContractOptions["current"], t: TestContext): Promise<{ok: boolean; codes: string[]}> {
  const expected = plainCopy(project, t), original = filesystemSnapshot(project);
  const matrix = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
  assert.equal(matrix.rows[1]!.ok, expected.ok);
  assert.equal(matrix.rows[1]!.diagnostic_count, expected.codes.length);
  assert.deepEqual([...matrix.rows[1]!.codes].sort(), [...expected.codes].sort());
  assertPlainRows(matrix, expected);
  assert.equal(filesystemSnapshot(project), original, "consumer dependency files, links, metadata and timestamps remain untouched");
  return expected;
}

test("round 10 dependency-shape differential preserves aliases file link workspaces peers bundled and installed names", async t => {
  const cases = ["review-npm-alias", "scoped-alias", "file-copy", "file-link", "link", "workspace", "unidentified-workspace-relative", "peer", "bundled", "metadata-mismatch", "nested-alias", "hidden-store"];
  let comparisons = 0;
  for (const shape of cases) {
    const project = noEmitConsumer(t), bound = dependencyBound(project);
    const installed = shape === "scoped-alias" ? "@scope/alias-fixture" : "alias-fixture";
    const dependencies: Record<string, string> = {[installed]: shape === "scoped-alias" ? "npm:@actual/fixture@1" : "npm:actual-fixture@1"};
    let workspace: string[] | undefined;
    if (["file-link", "link", "workspace", "unidentified-workspace-relative", "hidden-store"].includes(shape)) {
      const location = shape === "hidden-store" ? "node_modules/.store/actual-fixture" : "packages/actual-fixture";
      dependencyEntry(project, location, "actual-fixture");
      symlinkSync(join(project, location), join(project, "node_modules", installed), "junction");
      dependencies[installed] = shape.includes("workspace") ? "workspace:*" : (shape === "link" ? "link:" : "file:") + "./packages/actual-fixture";
      if (shape.includes("workspace")) {
        workspace = ["packages/*"];
        dependencyEntry(project, "packages/sibling", "sibling");
        writeFileSync(join(project, location, "index.d.ts"), shape === "workspace" ? 'export {value} from "sibling";' : 'export {value} from "../sibling/index.js";');
        if (shape === "workspace") symlinkSync(join(project, "packages/sibling"), join(project, "node_modules/sibling"), "junction");
      }
    } else {
      dependencyEntry(join(project, "node_modules"), installed, shape === "scoped-alias" ? "@actual/fixture" : "actual-fixture");
      if (shape === "file-copy") {
        dependencyEntry(project, "packages/actual-fixture", "actual-fixture");
        dependencies[installed] = "file:./packages/actual-fixture";
      }
    }
    if (["peer", "bundled", "nested-alias"].includes(shape)) {
      const owner = join(project, "node_modules", installed), leaf = shape === "peer" ? "peer-fixture" : "child-alias";
      dependencyEntry(join(project, "node_modules"), leaf, "actual-child", 'export declare const value: "wrong-hoist";');
      const nested = shape === "peer" ? join(project, "node_modules") : join(owner, "node_modules");
      dependencyEntry(nested, leaf, "actual-child");
      writeFileSync(join(owner, "index.d.ts"), `export {value} from ${JSON.stringify(leaf)};`);
      const metadata = JSON.parse(readFileSync(join(owner, "package.json"), "utf8")) as Record<string, unknown>;
      metadata[shape === "peer" ? "peerDependencies" : "dependencies"] = {[leaf]: shape === "nested-alias" ? "npm:actual-child@1" : "1.0.0"};
      if (shape === "bundled") metadata.bundledDependencies = [leaf];
      writeFileSync(join(owner, "package.json"), JSON.stringify(metadata));
    }
    writeFileSync(join(project, "package.json"), JSON.stringify({private: true, type: "module", dependencies, workspaces: workspace}));
    // A stale lock must not cause re-resolution of the actual installed tree.
    writeFileSync(join(project, "package-lock.json"), JSON.stringify({name: "fixture", lockfileVersion: 3, packages: {}}));
    for (const valid of [true, false]) {
      writeFileSync(join(project, "consumer.mts"), `import {value} from ${JSON.stringify(installed)}; import {sdk} from "@unbrained/pm-cli"; export const use: ${valid ? '"selected"' : '"wrong"'} = value; export {sdk};`);
      const expected = await dependencyOracle(project, bound, t);
      assert.equal(expected.ok, valid, shape);
      if (!valid) assert.deepEqual(expected.codes, ["TS2322"], shape);
      comparisons += 2;
    }
  }
  t.diagnostic(`Dependency corpus: ${cases.length} installed shapes, 24 untouched plain-tsc oracles, ${comparisons} bound comparisons; matching verdicts and error codes, including the alias-fixture/actual-fixture review case.`);
});

test("round 10 property preserves seeded random alias scoped file dependency graphs by installed import name", async t => {
  const results: {graphs: number; edges: number}[] = [];
  // Keep every deterministic graph while limiting active compiler workers to two.
  for (const shards of [[0, 1], [2, 3]]) results.push(...await Promise.all(shards.filter(shard => shard * 50 < testDepth(200)).map(shard => new Promise<{graphs: number; edges: number}>((resolveWorker, reject) => {
    const worker = new Worker(new URL("./dependency-property-worker.ts", import.meta.url), {workerData: {shard, compiler, graphs: Math.min(50, testDepth(200) - shard * 50)}});
    let result: {graphs: number; edges: number} | undefined;
    t.after(() => worker.terminate());
    worker.once("message", message => { result = message; });
    worker.once("error", reject);
    worker.once("exit", code => {
      if (code === 0 && result) resolveWorker(result);
      else reject(new Error(`dependency property worker exited ${code} without a completed result`));
    });
  }))));
  assert.equal(results.reduce((sum, row) => sum + row.graphs, 0), testDepth(200));
  t.diagnostic(`Dependency property: up to 4 deterministic shards, at most 2 active workers, ${testDepth(200)} independent random graphs, ${results.reduce((sum, row) => sum + row.edges, 0)} edges, alias/scoped/file shapes and nested aliases; ${testDepth(200)} passing plain-tsc oracles, ${2 * testDepth(200)} checker rows without drift; all original tree snapshots unchanged.`);
});

test("round 10 review alias-fixture resolves by installed name rather than actual-fixture metadata", async t => {
  const project = noEmitConsumer(t), bound = dependencyBound(project);
  dependencyEntry(join(project, "node_modules"), "alias-fixture", "actual-fixture");
  writeFileSync(join(project, "node_modules/alias-fixture/package.json"), JSON.stringify({name:"actual-fixture",version:"1.0.0",types:"index.d.ts"}));
  writeFileSync(join(project, "package.json"), JSON.stringify({type: "module", dependencies: {"alias-fixture": "npm:actual-fixture@1"}}));
  writeFileSync(join(project, "consumer.mts"), 'import {value} from "alias-fixture"; export const use: "selected" = value;');
  const expected = plainCopy(project, t);
  assert.deepEqual(expected, {ok: true, codes: []});
  const matrix = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
  assertPlainRows(matrix, expected);
});

test("round 10 internal module and SDK scope links retain canonical selected SDK identity", async t => {
  for (const shape of ["module-root", "sdk-scope", "workspace-self"]) {
    const project = noEmitConsumer(t);
    if (shape === "module-root") {
      renameSync(join(project, "node_modules"), join(project, "installed-modules"));
      symlinkSync(join(project, "installed-modules"), join(project, "node_modules"), "junction");
    } else if (shape === "sdk-scope") {
      const scope = join(project, "packages/sdk-scope");
      mkdirSync(scope, {recursive:true});
      symlinkSync(scope, join(project, "node_modules/@unbrained"), "junction");
    } else symlinkSync(project, join(project, "node_modules/workspace-self"), "junction");
    const bound = dependencyBound(project);
    dependencyEntry(join(project, "node_modules"), "alias-fixture", "actual-fixture");
    writeFileSync(join(project, "consumer.mts"), 'import {value} from "alias-fixture"; import {sdk} from "@unbrained/pm-cli"; export const use: "selected" = value; export {sdk};');
    assert.equal((await dependencyOracle(project, bound, t)).ok, true, shape);
    if (shape === "workspace-self") {
      const outside = join(scratch(t), "sentinel"); writeFileSync(outside, "retain external bytes");
      symlinkSync(outside, join(project, "trace.json"));
      await assert.rejects(checkSdkContracts({consumer: project, minimum: bound, current: bound}), refuses("isolation_refused"));
      assert.equal(readFileSync(outside, "utf8"), "retain external bytes", "a self workspace does not exempt consumer output links");
    }
  }
});

test("dependency-root inventories larger than one command-line argument reach the compiler worker", async t => {
  const project = noEmitConsumer(t), bound = dependencyBound(project);
  // 2,000 installed packages: their scratch realpaths exceed Linux's 128 KiB per-argument and Windows' command-line limits.
  const stem = "inventory-".padEnd(48, "x");
  for (let index = 0; index < 2000; index++) dependencyEntry(project, `node_modules/${stem}-${index}`, `${stem}-${index}`);
  const matrix = await checkSdkContracts({consumer: project, minimum: bound, current: bound});
  assert.equal(matrix.ok, true, JSON.stringify(matrix.rows.map(row => row.codes)));
});

test("missing or non-directory consumer paths are typed invalid_input refusals without machine paths", async t => {
  const project = noEmitConsumer(t), bound = dependencyBound(project);
  for (const consumer of [join(project, "missing-consumer"), join(project, "consumer.mts")]) {
    await assert.rejects(checkSdkContracts({consumer, minimum: bound, current: bound}), error => refuses("invalid_input")(error) && !(error as SdkContractRefusal).remedy.includes(project));
  }
});
