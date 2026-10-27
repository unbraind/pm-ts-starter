/** Installed dependency fixtures shared by corpus and property oracles. */
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdirSync, writeFileSync, readdirSync, readFileSync, readlinkSync, lstatSync} from "node:fs";
import {join} from "node:path";
import type {SdkContractOptions} from "../sdk-contracts.ts";

/** Write a dependency exactly where the consumer installed it, independent of its metadata name. */
export function dependencyEntry(root: string, installed: string, actual: string, declarations = 'export declare const value: "selected";'): void {
  const directory = join(root, installed);
  mkdirSync(directory, {recursive: true});
  writeFileSync(join(directory, "package.json"), JSON.stringify({name: actual, version: "1.0.0", types: "index.d.ts", scripts: {prepare: "exit 42", postinstall: "exit 42"}}));
  writeFileSync(join(directory, "index.d.ts"), declarations);
}

/** Give dependency-only oracles an identical small SDK at the installed current bound. */
export function dependencyBound(project: string): SdkContractOptions["current"] {
  const root = join(project, "node_modules/@unbrained/pm-cli");
  mkdirSync(root, {recursive: true});
  writeFileSync(join(root, "package.json"), JSON.stringify({name: "@unbrained/pm-cli", version: "1.0.0", types: "index.d.ts"}));
  writeFileSync(join(root, "index.d.ts"), 'export declare const sdk: "current";');
  return {root, version: "1.0.0"};
}


/** Detect writes even when a compiler rewrites identical bytes or restores the file inventory. */
export function filesystemSnapshot(root: string): string {
  const digest = createHash("sha256");
  const visit = (name: string): void => {
    const file = join(root, name), info = lstatSync(file, {bigint: true});
    digest.update(name).update([info.mode, info.size, info.mtimeNs, info.ctimeNs].join(":"));
    if (info.isFile()) digest.update(readFileSync(file));
    if (info.isSymbolicLink()) digest.update(readlinkSync(file));
    if (info.isDirectory()) for (const child of readdirSync(file).sort()) visit(join(name, child));
  };
  visit(".");
  return digest.digest("hex");
}

/** Deterministic generator, independent of compiler diagnostics and npm behavior. */
export function boundaryRandom(seed: number): () => number {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed ^ (seed >>> 16)) >>> 0; };
}

/** Provision an exact unmodified public compiler without lifecycle scripts or user credentials. */
export function installTestCompiler(directory: string, version: string): void {
  const result = spawnSync("npm", ["install", "--prefix", directory, "--ignore-scripts", "--no-package-lock", "--no-audit", "--no-fund", `typescript@${version}`], {
    encoding: "utf8", timeout: 120000, env: {...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts")), NPM_CONFIG_USERCONFIG: "/dev/null", npm_config_userconfig: "/dev/null"},
  });
  assert.equal(result.status, 0, result.stderr);
}
