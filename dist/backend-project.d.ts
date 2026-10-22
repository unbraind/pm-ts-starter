/** Compact refusal when generation cannot safely create a fresh directory. */
export interface GenerationRefusal {
    /** Failure discriminator. */
    ok: false;
    /** Stable reason, without exposing local paths. */
    code: "invalid_name" | "target_unavailable";
    /** Concrete recovery instruction. */
    remedy: string;
}
/** Result listing only relative artifacts suitable for agent output. */
export interface GeneratedBackendProject {
    /** Successful generation discriminator. */
    ok: true;
    /** Validated npm package and extension name. */
    name: string;
    /** Created paths relative to the new project directory. */
    files: string[];
    /** Commands to build and execute conformance tests. */
    next_steps: string[];
}
/** Locate the shipped TypeScript source in source and compiled package layouts. */
export declare function readBackendSource(moduleUrl: string): string;
/** Build a standalone extension with strict TypeScript and executable backend contracts. */
export declare function buildBackendProjectFiles(name: string): Record<string, string>;
/** Create a fresh project exclusively; never merge with or overwrite an existing directory. */
export declare function generateBackendProject(target: string, name: string): GeneratedBackendProject | GenerationRefusal;
//# sourceMappingURL=backend-project.d.ts.map