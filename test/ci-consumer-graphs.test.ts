/** CI must certify each installed dependency graph before replacing it. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("CI completes npm acceptance before a fresh Bun install and gates Bun on that install", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const steps = workflow.split(/^      - name: /m).slice(1).map(step => step.replace(/^\s*#.*$/gm, ""));
  const npm = steps.findIndex(step => /^\s*run: npm run release:check$/m.test(step));
  const install = steps.findIndex(step => /^\s*id: bun_install$/m.test(step));
  const bun = steps.findIndex(step => /^\s*run: bun run release:check$/m.test(step));
  assert.ok(npm >= 0 && install > npm && bun > install, "each release gate must run on its own installed graph");
  const preparation = steps[install];
  assert.match(preparation, /!cancelled\(\)/);
  assert.match(preparation, /steps\.npm_release\.outcome == 'success'/);
  assert.match(preparation, /steps\.npm_release\.outcome == 'failure'/);
  assert.match(preparation, /\brm -rf node_modules\s*\n\s*bun install --no-save\s*$/);
  assert.match(steps[bun], /if: \$\{\{ !cancelled\(\) && steps\.bun_install\.outcome == 'success' \}\}/);
  assert.doesNotMatch(preparation + steps[bun], /continue-on-error/);
});
