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
export { pmExpectedError, isPmCliExpectedError };
declare const _default: {
    name: string;
    version: any;
    activate(api: any): void;
};
export default _default;
//# sourceMappingURL=index.d.ts.map