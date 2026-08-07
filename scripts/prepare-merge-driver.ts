/**
 * Installs pm's field-aware Git merge drivers during package preparation.
 *
 * Consumer installs may omit development dependencies and therefore have no
 * `pm` executable. That absence is an intentional no-op. Once `pm` resolves,
 * however, a failed merge-driver installation is surfaced to npm instead of
 * being mistaken for absence and silently leaving the clone unprotected.
 */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The process result fields needed to distinguish absence from failure. */
interface CommandResult {
  readonly error?: Error;
  readonly status: number | null;
}

/** Injectable command boundary used by the deterministic unit tests. */
type CommandRunner = (
  command: string,
  args: string[],
  options: { readonly stdio: "inherit" },
) => CommandResult;

/**
 * Runs `pm merge install` and returns the lifecycle exit code.
 *
 * @param runner - Command boundary; tests inject exact success and failure
 *   results while production uses Node's synchronous process runner.
 * @returns Zero when pm is absent or installation succeeds, otherwise the
 *   command's non-zero status.
 */
export function installMergeDrivers(runner: CommandRunner = spawnSync): number {
  const result = runner("pm", ["merge", "install"], { stdio: "inherit" });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    return 0;
  }
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

/**
 * Executes the installer only when this module is Node's main script.
 *
 * @param argv - Process arguments used to identify the entry module.
 * @param runner - Command boundary forwarded to {@link installMergeDrivers}.
 * @returns The lifecycle exit code, or `undefined` when imported as a module.
 */
export function runScriptEntry(
  argv: readonly string[] = process.argv,
  runner: CommandRunner = spawnSync,
): number | undefined {
  if (!argv[1]) {
    return undefined;
  }
  if (realpathSync(resolve(argv[1])) !== realpathSync(fileURLToPath(import.meta.url))) {
    return undefined;
  }
  return installMergeDrivers(runner);
}

process.exitCode = runScriptEntry() ?? process.exitCode;
