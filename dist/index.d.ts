import { type ExtensionBlueprint, type ExtensionModule } from "@unbrained/pm-cli/sdk/authoring";
import type { PmCliExpectedError } from "@unbrained/pm-cli/sdk";
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