/** Execute the path classifier and keep CI tiers honest for new starter clones. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseDocument } from "yaml";

interface Step { name?: string; run?: string; uses?: string; if?: string; with?: Record<string, unknown> }
interface Workflow {
  on: Record<string, { paths?: string[] }>;
  jobs: Record<string, { "runs-on": string; "timeout-minutes": number; steps: Step[]; strategy?: { matrix: Record<string, unknown> } }>;
}

/** Strict parsing rejects duplicate keys and malformed workflows. */
function workflow(path: string): Workflow {
  const parsed = parseDocument(readFileSync(new URL("../" + path, import.meta.url), "utf8"), { strict: true, uniqueKeys: true });
  assert.deepEqual(parsed.errors, [], path);
  assert.deepEqual(parsed.warnings, [], path);
  return parsed.toJS() as Workflow;
}

/** Quote literal text for interpolation into a regular expression. */
function escapeRegexLiteral(part: string): string {
  return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Apply the workflow's star patterns in order, with dot directories included. */
function selectedByPaths(path: string, patterns: readonly string[]): boolean {
  return patterns.reduce((selected, entry) => {
    const pattern = entry.replace(/^!/, "");
    // Fail explicitly if a workflow starts using syntax this small contract matcher lacks.
    assert.doesNotMatch(pattern, /[?+[\]{}()\\]/, "unsupported workflow path pattern");
    const expression = pattern.split(/(\*\*\/|\*\*|\*)/).map(part => {
      if (part === "**/") return "(?:[^/]+/)*";
      if (part === "**") return "[\\s\\S]*";
      if (part === "*") return "[^/]*";
      return escapeRegexLiteral(part);
    }).join("");
    return new RegExp(`^${expression}$`).test(path) ? !entry.startsWith("!") : selected;
  }, false);
}

test("path filters include dot directories and apply exclusions and re-inclusions in order", () => {
  for (const path of [".agents/pm/check.ts", ".agents/pm/nested/check.ts", ".agents/pm/.nested/check.ts"]) {
    assert.equal(selectedByPaths(path, ["**"]), true);
    assert.equal(selectedByPaths(path, ["**", "!.agents/pm/**"]), false);
    assert.equal(selectedByPaths(path, ["**", "!.agents/pm/**", ".agents/pm/**/*.ts"]), true);
    assert.equal(selectedByPaths(path, ["**", ".agents/pm/**/*.ts", "!.agents/pm/**"]), false);
  }
});

test("literal workflow path segments escape regex metacharacters and unsupported glob syntax fails", () => {
  const literal = ".*+?^${}()|[]\\";
  const expression = new RegExp(`^${escapeRegexLiteral(literal)}$`);
  assert.match(literal, expression);
  assert.doesNotMatch(`${literal}x`, expression);
  for (const character of "?+[]{}()\\") {
    assert.throws(() => selectedByPaths("file.ts", [`file${character}.ts`]), /unsupported workflow path pattern/);
  }
});

test("coverage shard docs describe Node major compatibility", () => {
  const docs = readFileSync(new URL("../docs/ci-tiers.md", import.meta.url), "utf8");
  assert.match(docs, /Missing\/duplicate shards and differing Node majors fail closed\./);
  assert.match(docs, /Minor and patch differences within the same major are accepted\./);
});

const ci = workflow(".github/workflows/ci.yml");

test("the CI tier table distinguishes shard builds from committed output checks", () => {
  const docs = readFileSync(new URL("../docs/ci-tiers.md", import.meta.url), "utf8");
  const check = "Build and verify committed output is current";
  for (const job of ["quick-shard", "coverage-shard"]) {
    const steps = ci.jobs[job].steps;
    assert.ok(steps.some(step => step.run?.split("\n").some(command => command.trim() === "npm run build")));
    assert.ok(!steps.some(step => step.name === check));
  }
  const release = ci.jobs["release-gate"];
  assert.equal(release.steps.find(step => step.uses?.startsWith("actions/setup-node@"))?.with?.["node-version"], 26);
  assert.match(release.steps.find(step => step.name === check)?.run ?? "", /git status .*'dist\/'/);
  assert.match(docs, /^\| Build and committed dist consistency \| build only \| yes \| — \| yes \|$/m);
});

test("documentation and tracker changes retain health, privacy and input checks", () => {
  const steps = ci.jobs.test.steps;
  assert.ok(steps.some(step => step.run?.includes("pm health --strict-exit --require-merge-drivers")));
  const docs = steps.find(step => step.name === "Check documentation and tracker changes");
  assert.equal(docs?.if, "needs.changes.result == 'success' && needs.changes.outputs.code != 'true'");
  for (const command of ["npm run changelog:check", "test/identity-audit.test.ts", "test/package-metadata.test.ts", "test/compatibility-floor.test.ts", "test/sdk-compiler-entry.test.ts"]) assert.ok(docs?.run?.includes(command), command);
});

test("NUL-delimited classifier keeps docs cheap and executable tracker files in the code tier", { skip: process.platform === "win32" && "The workflow classifier runs in Ubuntu Bash" }, t => {
  const root = mkdtempSync(join(tmpdir(), "ci-paths-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = ci.jobs.changes.steps.find(step => step.name === "Detect code changes")?.run;
  assert.ok(script);
  // A tiny git shim emits the exact diff protocol without depending on a remote.
  const git = join(root, "git");
  writeFileSync(git, '#!/bin/sh\ncat "$CI_PATH_INPUT"\n', { mode: 0o755 });
  for (const [paths, expected] of [
    [["README.md", "docs/example.json", ".agents/pm/tasks/example.toon"], false],
    [[".agents/pm/nested/check.ts"], true], [[".agents/pm/check.mjs"], true],
    [["docs/line\nbreak.md", "index.ts"], true], [["old-source.ts", "docs/moved.md"], true],
  ] as const) {
    writeFileSync(join(root, "input"), paths.join("\0") + "\0");
    writeFileSync(join(root, "output"), "");
    execFileSync("/bin/bash", ["-c", script], { env: { ...process.env, PATH: root + ":" + process.env.PATH,
      GITHUB_EVENT_NAME: "pull_request", BASE_SHA: "base", HEAD_SHA: "head", RUNNER_TEMP: root,
      CI_PATH_INPUT: join(root, "input"), GITHUB_OUTPUT: join(root, "output") } });
    assert.equal(readFileSync(join(root, "output"), "utf8"), `code=${expected}\n`);
  }
});

test("deep separates full installer graphs", () => {
  for (const path of [".github/workflows/ci-deep.yml", "templates/backend/.github/workflows/ci-deep.yml"]) {
    const deep = workflow(path).jobs.deep;
    assert.deepEqual(deep.strategy?.matrix, { "node-version": [22, 26], runtime: ["npm", "bun"] });
    assert.equal(deep["timeout-minutes"], 120);
    const gates = deep.steps.filter(step => step.run === "npm run release:check" || step.run === "bun run release:check");
    assert.equal(gates.length, 2);
    for (const gate of gates) assert.ok(gate.if?.includes(`matrix.runtime == '${gate.run!.startsWith("npm") ? "npm" : "bun"}'`));
    for (const step of deep.steps) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
  }
});

test("root deep defaults to local while generated deep requires explicit opt-in", () => {
  assert.equal(workflow(".github/workflows/ci-deep.yml").jobs.deep["runs-on"], "${{ vars.PM_LOCAL_DEEP != 'off' && fromJSON('[\"self-hosted\",\"pm-local\"]') || 'ubuntu-latest' }}");
  assert.equal(workflow("templates/backend/.github/workflows/ci-deep.yml").jobs.deep["runs-on"], "${{ vars.PM_LOCAL_DEEP == 'on' && fromJSON('[\"self-hosted\",\"pm-local\"]') || 'ubuntu-latest' }}");
});

test("generated deep Bun legs execute behavior under Bun after the release gate", () => {
  const steps = workflow("templates/backend/.github/workflows/ci-deep.yml").jobs.deep.steps;
  const release = steps.findIndex(step => step.run === "bun run release:check");
  const behavior = steps.findIndex(step => step.run === "bun run test:bun");
  assert.ok(behavior > release);
  assert.equal(steps[behavior].if, "matrix.runtime == 'bun'");
});

test("CodeQL skips prose but includes executable tracker changes in every template", () => {
  const paths = [".github/workflows/codeql.yml"];
  for (const directory of readdirSync(new URL("../templates/", import.meta.url), { withFileTypes: true })) {
    if (directory.isDirectory()) {
      const path = `templates/${directory.name}/.github/workflows/codeql.yml`;
      // Only templates that ship CodeQL have an event filter contract.
      if (existsSync(new URL("../" + path, import.meta.url))) paths.push(path);
    }
  }
  assert.ok(paths.includes("templates/backend/.github/workflows/codeql.yml"));
  for (const source of paths) for (const event of ["push", "pull_request"]) {
    const patterns = workflow(source).on[event].paths!;
    assert.ok(patterns, `${source}: ${event}`);
    for (const [path, expected] of [["README.md", false], ["docs/example.json", false], [".agents/pm/tasks/example.toon", false],
      ...["js", "mjs", "cjs", "ts"].flatMap(extension => [[`.agents/pm/check.${extension}`, true], [`.agents/pm/nested/check.${extension}`, true]] as const),
      ["index.ts", true]] as const) {
      const selected = selectedByPaths(path, patterns);
      assert.equal(selected, expected, `${source}: ${event}: ${path}`);
      if (path === ".agents/pm/tasks/example.toon") {
        const withoutExclusion = patterns.filter(pattern => pattern !== "!.agents/pm/**");
        assert.throws(() => assert.equal(selectedByPaths(path, withoutExclusion), expected),
          { code: "ERR_ASSERTION" }, `${source}: ${event}: removing the tracker exclusion must fail the contract`);
      }
    }
  }
});

test("all root and shipped workflow YAML parses strictly", () => {
  for (const directory of [".github/workflows/", "templates/backend/.github/workflows/"]) {
    for (const name of readdirSync(new URL("../" + directory, import.meta.url))) {
      if (/\.ya?ml$/.test(name)) workflow(directory + name);
    }
  }
});


test("template checkouts do not retain credentials for validation jobs", () => {
  const directory = "templates/backend/.github/workflows/";
  for (const name of readdirSync(new URL("../" + directory, import.meta.url))) {
    if (!/\.ya?ml$/.test(name)) continue;
    const checkouts = Object.values(workflow(directory + name).jobs)
      .flatMap(job => job.steps).filter(step => step.uses?.startsWith("actions/checkout@"));
    assert.ok(checkouts.length > 0, `${name}: checkout contract must exercise a checkout`);
    for (const checkout of checkouts) assert.equal(checkout.with?.["persist-credentials"], false, name);
  }
});
