/** Deep CI certifies both independent installed dependency graphs. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

test("Deep CI gates each installer graph independently on both Node lines", () => {
  const workflow = parse(readFileSync(new URL("../.github/workflows/ci-deep.yml", import.meta.url), "utf8"));
  const job = workflow.jobs.deep;
  assert.deepEqual(job.strategy.matrix, {"node-version": [22, 26], runtime: ["npm", "bun"]});
  const steps = job.steps as {run?: string; if?: string; id?: string}[];
  const npm = steps.findIndex(step => step.run === "npm run release:check");
  const install = steps.findIndex(step => step.id === "bun_install");
  const bun = steps.findIndex(step => step.run === "bun run release:check");
  assert.ok(npm >= 0 && install > npm && bun > install);
  assert.equal(steps[npm].if, "matrix.runtime == 'npm'");
  assert.equal(steps[install].if, "matrix.runtime == 'bun'");
  assert.match(steps[install].run!, /rm -rf node_modules\s*\n\s*bun install --no-save/);
  assert.match(steps[bun].if!, /matrix.runtime == 'bun'.*steps.bun_install.outcome == 'success'/);
  assert.equal(job.env.PM_TEST_DEPTH, "full");
});
