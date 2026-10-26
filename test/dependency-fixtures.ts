/** Installed dependency fixtures shared by corpus and property oracles. */
import {createHash} from "node:crypto";
import {mkdirSync, writeFileSync, readdirSync, readFileSync, lstatSync} from "node:fs";
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
  for (const name of [".", ...readdirSync(root, {recursive: true}).map(String).sort()]) {
    const file = join(root, name), info = lstatSync(file, {bigint: true});
    digest.update(name).update([info.mode, info.size, info.mtimeNs, info.ctimeNs].join(":"));
    if (info.isFile()) digest.update(readFileSync(file));
  }
  return digest.digest("hex");
}

/** Deterministic generator, independent of compiler diagnostics and npm behavior. */
export function boundaryRandom(seed: number): () => number {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed ^ (seed >>> 16)) >>> 0; };
}
