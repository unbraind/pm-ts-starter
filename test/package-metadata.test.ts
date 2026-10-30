/** Regression coverage for the npm package links shipped in package.json. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

test("npm homepage points to the package catalog", () => {
  assert.equal(packageJson.homepage, "https://pm-cli.unbrained.dev/packages/pm-ts-starter");
});

test("npm author links to the maintainer about page", () => {
  assert.deepEqual(packageJson.author, {
    name: "unbrained",
    url: "https://unbrained.dev/about",
  });
});

test("npm repository points to the package repository", () => {
  assert.deepEqual(packageJson.repository, {
    "type": "git",
    "url": "git+https://github.com/unbraind/pm-ts-starter.git"
  });
});

test("npm bugs points to the package issue tracker", () => {
  assert.deepEqual(packageJson.bugs, {
    "url": "https://github.com/unbraind/pm-ts-starter/issues"
  });
});

test("every relative README link resolves to a file in the published package", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const links = [...readme.matchAll(/\]\(([^)#\s]+)[^)]*\)/g)].map((match) => match[1]).filter((target) => !/^[a-z][a-z+.-]*:/i.test(target));
  // npm's own pack plan is the shipped file list; `files` globs are only its input.
  const [plan] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8", shell: process.platform === "win32" })) as [{ files: { path: string }[] }];
  const shipped = new Set(plan.files.map((file) => file.path));
  assert.ok(links.length > 0, "README has relative links to check");
  assert.deepEqual(links.filter((target) => !shipped.has(target)), []);
});
