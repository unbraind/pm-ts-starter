import { type ExtensionBlueprint, type ExtensionModule } from "@unbrained/pm-cli/sdk/authoring";
import type { PmCliExpectedError } from "@unbrained/pm-cli/sdk";
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
declare function pmExpectedError(message: string, options?: TsStarterErrorOptions): PmCliExpectedError;
declare function isPmCliExpectedError(error: unknown): error is PmCliExpectedError;
interface PmRunResult {
    ok: boolean;
    stdout: string;
    stderr: string;
    status: number | null;
}
export declare function runPm(pmRoot: string, args: string[]): PmRunResult;
declare const demoProfile: {
    name: string;
    title: string;
    summary: string;
    types: {
        name: string;
        description: string;
        folder: string;
        aliases: string[];
    }[];
    statuses: {
        id: string;
        description: string;
        roles: string[];
    }[];
    fields: {
        key: string;
        type: string;
        description: string;
    }[];
    workflows: {
        type: string;
        allowed_transitions: [string, string][];
    }[];
    config: {
        key: string;
        value: string;
        summary: string;
    }[];
    templates: {
        name: string;
        options: {
            type: string;
            title: string;
        };
    }[];
    packages: {
        spec: string;
        reason: string;
    }[];
};
declare const blueprint: ExtensionBlueprint;
declare const derivedCapabilities: ("commands" | "hooks" | "importers" | "parser" | "preflight" | "renderers" | "schema" | "search" | "services")[];
declare const manifestMirror: {
    name: string;
    version: string;
    entry: string;
    priority: number;
    capabilities: ("commands" | "hooks" | "importers" | "parser" | "preflight" | "renderers" | "schema" | "search" | "services")[];
};
declare const composedModule: ExtensionModule;
declare const packagedModule: ExtensionModule, synthesizedManifest: import("@unbrained/pm-cli/sdk").ExtensionManifest;
export default packagedModule;
export { pmExpectedError, isPmCliExpectedError };
export { blueprint, derivedCapabilities, manifestMirror, synthesizedManifest, composedModule, demoProfile, };
//# sourceMappingURL=index.d.ts.map