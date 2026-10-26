import { type ExtensionBlueprint, type ExtensionModule } from "@unbrained/pm-cli/sdk/authoring";
import type { PmCliExpectedError } from "@unbrained/pm-cli/sdk";
export * from "./rehearsal.ts";
export * from "./sdk-contracts.ts";
export * from "./backend.ts";
export * from "./backend-project.ts";
/**
 * Reads a JSON file that sits at the package root, from either module layout.
 *
 * Same directory first, then the parent. Published, this module sits in `dist/`
 * and the file is one level up, so the same-directory candidate simply misses
 * there and the parent still wins — `dist/` contains neither `package.json` nor
 * `manifest.json`. Run as source from the package root, the same-directory
 * candidate is the correct one, and trying the parent first would read whatever
 * package happens to enclose the checkout.
 *
 * Only a *missing* same-directory file advances to the parent. If that file
 * exists but is unreadable or malformed, falling through would answer the
 * question with a different package's data and report nothing wrong — the same
 * silent-wrong-package failure the candidate order exists to prevent, reached
 * by a different route.
 *
 * @param fileName - Bare file name to look for, e.g. `package.json`.
 * @param base - Directory to resolve from. Defaults to this module's own
 *   directory; tests pass an explicit base to exercise both layouts.
 * @returns The parsed JSON, or `undefined` when no candidate yields usable data.
 */
export declare function readRootJson(fileName: string, base?: string): unknown;
/**
 * Resolves the extension version from a parsed `manifest.json` value.
 *
 * Falls back to `"0.0.0"` when the manifest is missing or its `version` field
 * is not a string, so a corrupt or partial manifest never crashes the host —
 * the extension loads with a sentinel that surfaces in `ts-starter info`.
 *
 * @param manifest - The parsed contents of `manifest.json` (or `undefined`).
 * @returns The version string, or `"0.0.0"` as a fallback.
 */
export declare function resolveVersion(manifest: unknown): string;
/**
 * The pm-cli SDK release this reference is written against, reported by
 * `ts-starter info` and `ts-starter setup`.
 *
 * Derived from the declared `@unbrained/pm-cli` peer-dependency range rather
 * than a source literal, for the same reason {@link VERSION} reads
 * `manifest.json`: a hardcoded target silently drifts. This one had already
 * drifted 20 releases (`2026.7.6`) behind the declared peer range, so both
 * commands misreported the SDK contract this extension actually demonstrates.
 */
/**
 * Resolves the pm-cli SDK target from a parsed `package.json` value.
 *
 * Reads the `@unbrained/pm-cli` peer-dependency range and strips the leading
 * comparator (`>=`, `^`, etc.) so the bare version is what `ts-starter info`
 * reports. Falls back to `"unknown"` when the range is missing or not a string.
 *
 * @param pkg - The parsed contents of `package.json` (or `undefined`).
 * @returns The SDK target version, or `"unknown"` as a fallback.
 */
export declare function resolveSdkTarget(pkg: unknown): string;
interface TsStarterErrorContextInput {
    feature?: string;
    command?: string;
    attempted_command?: string;
    why?: string;
    hint?: string;
    suggested_retry?: string;
    examples?: string[];
    nextSteps?: string[];
    code?: string;
    [key: string]: unknown;
}
interface TsStarterErrorOptions {
    exitCode?: number;
    context?: TsStarterErrorContextInput;
    cause?: unknown;
}
/**
 * Construct a {@link PmCliExpectedError}-shaped error without importing the
 * CLI's runtime class.
 *
 * The CLI's top-level handler matches expected errors by `name === "PmCliError"`
 * rather than `instanceof`, so a locally built Error with that name is treated
 * like one the CLI itself threw. The exit code falls back to
 * {@link DEFAULT_USAGE_EXIT_CODE} when the caller omits it or passes a value
 * that is not a positive finite number, so a malformed option can never select
 * exit code 0. The loose `context` input is reshaped into a structured recovery
 * record (promoting the first present command/feature name, folding a bare
 * `hint` into `nextSteps`), and `cause` is attached non-enumerably so it does
 * not leak into serialized error output.
 *
 * @param message - Human-readable summary shown to the operator.
 * @param options - Optional exit code, recovery context, and cause.
 * @returns An Error carrying the expected-error name, exit code, and context.
 */
declare function pmExpectedError(message: string, options?: TsStarterErrorOptions): PmCliExpectedError;
/**
 * Type guard identifying an error the CLI treats as expected.
 *
 * Matches on the `name` tag rather than `instanceof`, mirroring exactly how the
 * CLI's own handler recognizes these errors, so a locally constructed error is
 * indistinguishable from one thrown inside the CLI. The `instanceof Error`
 * precondition keeps a plain object that merely sets `name` from narrowing the
 * type.
 *
 * @param error - Any caught value, typically from a `try`/`catch` boundary.
 * @returns True when `error` is an Error whose name is the expected-error tag.
 */
declare function isPmCliExpectedError(error: unknown): error is PmCliExpectedError;
interface PmRunResult {
    ok: boolean;
    stdout: string;
    stderr: string;
    status: number | null;
}
/**
 * Run the live `pm` binary against a workspace and capture its result.
 *
 * Spawns `pm --path <pmRoot> <args>` synchronously with a JSON-sized read buffer
 * (see {@link pmJsonMaxBuffer}), then normalizes the outcome into the
 * {@link PmRunResult} shape every caller shares. `ok` is true only when the
 * process exited zero AND Node reported no spawn error, so a crash and a clean
 * failure are both reported as not-ok. `stderr` falls back to a translated
 * read-failure message when the spawn itself errored before producing output,
 * so the field is never empty on a failure.
 *
 * @param pmRoot - Workspace root forwarded to pm as `--path`.
 * @param args - Additional pm arguments after the path flag.
 * @returns The captured exit status, streams, and derived `ok` flag.
 */
export declare function runPm(pmRoot: string, args: string[]): PmRunResult;
declare const demoProfile: {
    readonly name: "ts_starter_demo";
    readonly title: "TS Starter Demo Profile";
    readonly summary: "A minimal demonstration profile with one custom type, one status, one field, and one template.";
    readonly types: readonly [{
        readonly name: "Spike";
        readonly description: "A time-boxed research or exploration task.";
        readonly folder: "spikes";
        readonly aliases: ["spike"];
    }];
    readonly statuses: readonly [{
        readonly id: "explored";
        readonly description: "Spike has been explored and findings recorded.";
        readonly roles: ["terminal", "terminal_done"];
    }];
    readonly fields: readonly [{
        readonly key: "ts_starter_ref";
        readonly type: "string";
        readonly description: "Cross-reference marker for the TS starter demo.";
    }];
    readonly workflows: readonly [{
        readonly type: "Spike";
        readonly allowed_transitions: [["open", "explored"]];
    }];
    readonly config: readonly [{
        readonly key: "search_provider";
        readonly value: "bm25";
        readonly summary: "Use the built-in BM25 keyword search provider.";
    }];
    readonly templates: readonly [{
        readonly name: "spike";
        readonly options: {
            readonly type: "Spike";
            readonly title: "Investigate ...";
        };
    }];
    readonly packages: readonly [{
        readonly spec: "npm:@unbrained/pm-todos";
        readonly reason: "Provides a todo import/export package compatible with this profile.";
    }];
};
declare const blueprint: ExtensionBlueprint;
declare const derivedCapabilities: ("commands" | "hooks" | "importers" | "parser" | "preflight" | "renderers" | "schema" | "search" | "services")[];
declare const manifestMirror: {
    readonly name: "pm-ts-starter";
    readonly version: string;
    readonly entry: "./dist/index.js";
    readonly priority: 90;
    readonly capabilities: ("commands" | "hooks" | "importers" | "parser" | "preflight" | "renderers" | "schema" | "search" | "services")[];
};
declare const composedModule: ExtensionModule;
declare const packagedModule: ExtensionModule, synthesizedManifest: import("@unbrained/pm-cli/sdk").ExtensionManifest;
export default packagedModule;
export { pmExpectedError, isPmCliExpectedError };
export { blueprint, derivedCapabilities, manifestMirror, synthesizedManifest, composedModule, demoProfile, };
//# sourceMappingURL=index.d.ts.map