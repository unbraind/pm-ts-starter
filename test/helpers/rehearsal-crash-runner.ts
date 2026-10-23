/** Terminate real SDK and filesystem operations at enumerated durable boundaries. */
import fs from "node:fs";
import promises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { PmClient } from "@unbrained/pm-cli/sdk";
import { rehearseSchemaMigration, type RehearsalOptions } from "../../rehearsal.ts";

const options = JSON.parse(process.argv[2]) as RehearsalOptions;
const boundary = process.argv[3];
let checkpoint = 0, operation = 0;

/** Exit without finally blocks, leaving the real durable artifacts and leases. */
function terminate(at: string): void {
  if (boundary === at) process.exit(73);
}

const rename = promises.rename;
promises.rename = async (...args: Parameters<typeof rename>) => {
  const target = String(args[1]);
  const wrapper = target === join(options.workDir, "rehearsal.json");
  const commit = target.includes(`${join("transactions", "sdk", "schema-rehearsal-")}`) && JSON.parse(fs.readFileSync(args[0], "utf8")).status === "committed";
  const step = /-(\d+)\.json$/.exec(target)?.[1];
  if (wrapper) terminate(`checkpoint:${checkpoint}:before`);
  if (commit) terminate(`commit:${step}:before`);
  await rename(...args);
  if (wrapper) terminate(`checkpoint:${checkpoint++}:after`);
  if (commit) terminate(`commit:${step}:after`);
};

const write = fs.writeFileSync;
fs.writeFileSync = (...args: Parameters<typeof write>) => {
  if (boundary === "copy:middle" && String(args[0]).startsWith(join(options.workDir, "tracker")) && Buffer.isBuffer(args[1])) {
    write(args[0], args[1].subarray(0, Math.max(1, Math.floor(args[1].length / 2))), args[2]);
    terminate("copy:middle");
  }
  write(...args);
};
syncBuiltinESMExports();

// These observers invoke the original SDK methods and never fabricate results.
// Keeping them at the SDK boundary also exercises the pre-fix implementation.
for (const name of ["schemaRenameField", "schemaRenameType", "schemaRemapStatus"] as const) {
  const original = PmClient.prototype[name];
  Object.defineProperty(PmClient.prototype, name, { value: async function (this: PmClient, ...args: Parameters<typeof original>) {
    const index = operation++;
    terminate(`sdk:${index}:before`);
    const result = await Reflect.apply(original, this, args);
    terminate(`sdk:${index}:after`);
    return result;
  } });
}

await rehearseSchemaMigration(options);
throw new Error(`Crash boundary was not reached: ${boundary}`);
