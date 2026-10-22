/** Self-contained project templates; the generated package has no starter runtime dependency. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
/** Locate the shipped TypeScript source in source and compiled package layouts. */
export function readBackendSource(moduleUrl) {
    return readFileSync(new URL(moduleUrl.endsWith(".ts") ? "./backend.ts" : "../backend.ts", moduleUrl), "utf8");
}
/** Build a standalone extension with strict TypeScript and executable backend contracts. */
export function buildBackendProjectFiles(name) {
    const packageJson = {
        name, version: "0.1.0", private: false, type: "module", main: "dist/index.js", types: "dist/index.d.ts",
        exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
        bin: { [name]: "dist/cli.js" }, files: ["dist", "manifest.json", "README.md"],
        engines: { node: ">=22.18.0" },
        scripts: { build: "tsc", typecheck: "tsc --noEmit", test: "node --test test/*.test.ts", "test:bun": "bun test test/*.test.ts", prepack: "npm run build" },
        dependencies: { "@toon-format/toon": "4.1.1" },
        peerDependencies: { "@unbrained/pm-cli": ">=2026.10.17" },
        devDependencies: { "@unbrained/pm-cli": "2026.10.17", "@types/node": "26.6.5", typescript: "7.0.2" },
        pm: { extensions: ["."] },
    };
    return {
        "package.json": JSON.stringify(packageJson, null, 2) + "\n",
        "manifest.json": JSON.stringify({ name, version: "0.1.0", entry: "./dist/index.js", pm_min_version: "2026.10.17", capabilities: ["commands"] }, null, 2) + "\n",
        "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: ["node"], declaration: true, outDir: "dist", rootDir: "src", skipLibCheck: true }, include: ["src/*.ts"] }, null, 2) + "\n",
        "src/backend.ts": readBackendSource(import.meta.url),
        "src/index.ts": extensionSource(name),
        "src/cli.ts": cliSource,
        "test/backend.test.ts": contractTests,
        "README.md": `# ${name}\n\nRead-only production pm extension. Run npm install, npm run build and npm test (or bun install, bun run build and bun run test:bun). Install the built package with pm package install.\n\nUse pm ${name} inspect, or node dist/cli.js inspect [tracker-root] [--json]. A leading --json uses the default .agents/pm tracker. TOON is the default. create/update/delete return nonzero typed refusals with remedies. SDK consumers import createDirectoryAdapter or createRemoteAdapter.\n\nRemoteReader.listAllComplete must return an unmodified SDK complete-list envelope. Supply your authenticated MCP/HTTP transport and enforce request timeouts and cancellation there. No network access or credentials are configured by this project. Contract tests use a real directory tracker and pass its receipts through the remote boundary. This proves adapter conformance, not acceptance of a deployed remote service.\n\n## Without git\n\nGeneration, builds, reads, refusals and contract tests work in plain directories with Git absent from PATH. No operation in this project requires Git. Reads suppress extension activation and return certified counts only; writes are unsupported. The SDK can maintain disposable read caches; use a copy for archival inputs.\n`,
        ".gitignore": "node_modules/\ndist/\n*.tgz\n",
    };
}
/** Emit the deployable extension registration using the same read-only backend as the CLI. */
function extensionSource(name) {
    return `import { defineExtension, defineCommand } from "@unbrained/pm-cli/sdk/authoring";
import { createDirectoryAdapter } from "./backend.js";
export * from "./backend.js";
/** Register a certified, compact read command in the pm host. */
export default defineExtension({
  name: "${name}", version: "0.1.0",
  activate(api) {
    api.registerCommand(defineCommand({
      name: "${name} inspect", description: "Inspect the complete tracker without mutation.",
      intent: "certify backend receipts", examples: ["pm ${name} inspect --json"],
      failure_hints: ["Initialize the tracker, then retry inspect."],
      async run(ctx) {
        const receipt = await createDirectoryAdapter(ctx.pm_root).execute("inspect");
        if (!receipt.ok) throw Object.assign(new Error(receipt.remedy), {
          name: "PmCliError", exitCode: 2, context: { code: receipt.code, receipt, nextSteps: [receipt.remedy] },
        });
        return receipt;
      },
    }));
  },
});
`;
}
const cliSource = `#!/usr/bin/env node
import { createDirectoryAdapter, parseCliInvocation, type BackendOperation } from "./backend.js";
import { encode } from "@toon-format/toon";
const { operation, tracker, flags } = parseCliInvocation(process.argv.slice(2));
if (!["inspect", "create", "update", "delete"].includes(operation) || flags.some(flag => flag !== "--json")) {
  console.log(JSON.stringify({ ok: false, code: "invalid_arguments", remedy: "Use inspect|create|update|delete [tracker-root] [--json]. A leading --json uses .agents/pm." }));
  process.exitCode = 2;
} else {
  const receipt = await createDirectoryAdapter(tracker).execute(operation as BackendOperation);
  console.log(flags.includes("--json") ? JSON.stringify(receipt) : encode(receipt));
  if (!receipt.ok) process.exitCode = 2;
}
`;
const contractTests = `import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PmClient } from "@unbrained/pm-cli/sdk";
import { createDirectoryAdapter, createRemoteAdapter } from "../src/backend.ts";

test("directory and remote certify real receipts without Git", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "backend-contract-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const client = new PmClient({ pmRoot: join(root, "tracker"), noExtensions: true });
  await client.init("contract", { defaults: true, mergeFence: false, agentGuidance: "skip" });
  await client.create({ title: "Real contract item", type: "Task", description: "Contract fixture", priority: 2 });
  const envelope = await client.listAllComplete();
  const readers = [createDirectoryAdapter(join(root, "tracker")), createRemoteAdapter({ async listAllComplete() { return envelope; } })];
  for (const adapter of readers) {
    const receipt = await adapter.execute("inspect");
    assert.equal(receipt.ok, true);
    if (!receipt.ok) assert.fail("inspection refused");
    assert.equal(receipt.item_count, 1);
    assert.equal(receipt.complete_list.no_omissions, true);
    for (const operation of ["create", "update", "delete"] as const) {
      const refused = await adapter.execute(operation);
      assert.equal(refused.ok, false);
      if (refused.ok) assert.fail("writes must refuse");
      assert.equal(refused.code, "unsupported_operation");
      assert.ok(refused.remedy);
    }
  }
  for (const field of ["read_output", "omission_receipt"] as const) {
    const broken = { ...envelope };
    Reflect.deleteProperty(broken, field);
    const result = await createRemoteAdapter({ async listAllComplete() { return broken; } }).execute("inspect");
    assert.equal(result.ok, false, field + " must be load-bearing");
    if (result.ok) assert.fail("missing receipt must refuse");
    assert.equal(result.code, "invalid_receipt");
    assert.ok(result.evidence?.findings.length);
  }
});
`;
/** Create a fresh project exclusively; never merge with or overwrite an existing directory. */
export function generateBackendProject(target, name) {
    if (!/^pm-[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) || name.length > 100) {
        return { ok: false, code: "invalid_name", remedy: "Choose a lowercase npm name such as pm-my-backend (at most 100 characters)." };
    }
    const files = buildBackendProjectFiles(name);
    const root = resolve(target);
    try {
        mkdirSync(root);
        mkdirSync(join(root, "src"));
        mkdirSync(join(root, "test"));
        for (const [path, contents] of Object.entries(files))
            writeFileSync(join(root, path), contents, { flag: "wx" });
    }
    catch {
        return { ok: false, code: "target_unavailable", remedy: "Choose a new writable directory under an existing parent. Inspect any partially created project before retrying." };
    }
    return { ok: true, name, files: Object.keys(files), next_steps: ["npm install", "npm run build", "npm test", "bun run test:bun"] };
}
//# sourceMappingURL=backend-project.js.map