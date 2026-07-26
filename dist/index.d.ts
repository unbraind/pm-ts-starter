import type { ExtensionApi, PmCliExpectedError } from "@unbrained/pm-cli/sdk";
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
export { pmExpectedError, isPmCliExpectedError };
declare const _default: {
    name: string;
    version: any;
    activate(api: ExtensionApi): void;
};
export default _default;
//# sourceMappingURL=index.d.ts.map