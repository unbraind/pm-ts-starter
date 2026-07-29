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