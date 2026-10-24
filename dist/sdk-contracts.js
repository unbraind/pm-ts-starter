/** Compile author-owned consumer examples against exact installed SDK declarations. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
/** Actionable input/tooling refusals, distinct from a valid matrix with API drift. */
export class SdkContractRefusal extends Error {
    /** Stable refusal discriminator. */
    code;
    /** Safe retry guidance without raw tool output or machine paths. */
    remedy;
    /** Construct a typed boundary failure with a safe operator remedy. */
    constructor(code, remedy) {
        super(remedy);
        this.code = code;
        this.remedy = remedy;
    }
}
/** Public authoring and certified all-status read examples, with checked return semantics. */
export const SDK_CONSUMER_EXAMPLES = [
    { id: "authoring", source: `import { defineCommand, composeExtension, defineExtensionBlueprint } from "@unbrained/pm-cli/sdk/authoring";
export const extension = composeExtension(defineExtensionBlueprint({ commands: [defineCommand({
  name: "consumer greeting", description: "Return a typed greeting", run(ctx) {
    const root: string = ctx.pm_root;
    return { root };
  }
})] }));\n` },
    { id: "complete-read", source: `import { PmClient, certifyCompleteListResult } from "@unbrained/pm-cli/sdk";
export async function count(pmRoot: string): Promise<number> {
  const result = await new PmClient({ pmRoot, noExtensions: true }).listAllComplete();
  certifyCompleteListResult(result);
  return result.items.length;
}\n` },
];
/** Validate author input before creating scratch files; reject vacuous and unbounded checks. */
export function parseSdkConsumerExamples(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 16)
        throw new SdkContractRefusal("invalid_input", "Provide 1 to 16 consumer examples with unique ids and TypeScript source.");
    const seen = new Set();
    for (const entry of value) {
        if (!entry || typeof entry.id !== "string" || !/^[a-z][a-z0-9-]{0,47}$/.test(entry.id) || seen.has(entry.id) ||
            typeof entry.source !== "string" || !entry.source.trim() || Buffer.byteLength(entry.source) > 65536 ||
            Object.keys(entry).some(key => !["id", "source"].includes(key)))
            throw new SdkContractRefusal("invalid_input", "Use unique lowercase example ids and nonempty TypeScript source of at most 64 KiB; only id and source are accepted.");
        seen.add(entry.id);
    }
    return structuredClone(value);
}
/** Check installation identity without loading or executing target SDK code. */
function targetRoot(target) {
    try {
        if (!target || !/^\d+\.\d+\.\d+$/.test(target.version) || typeof target.root !== "string" || !target.root.trim())
            throw new Error("invalid target");
        const root = resolve(target.root);
        const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
        if (metadata.name !== "@unbrained/pm-cli" || metadata.version !== target.version)
            throw new Error("identity mismatch");
        return root;
    }
    catch {
        throw new SdkContractRefusal("sdk_unavailable", "Install the exact declared SDK versions in separate directories and pass their package roots; package name and version must match. Registry provenance remains the provisioner's responsibility.");
    }
}
/** Run the selected compiler; resolution traces stay private and bounded. */
function compileConsumer(project, compiler, file, paths = {}) {
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: {
            paths, strict: true, noEmit: true, skipLibCheck: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: [],
        }, files: [file] }));
    const result = spawnSync(process.execPath, [resolve(compiler), "--project", join(project, "tsconfig.json"), "--pretty", "false", "--traceResolution"], {
        cwd: project, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, NODE_OPTIONS: "", GIT_CEILING_DIRECTORIES: dirname(dirname(project)) },
    });
    const codes = [...result.stdout.matchAll(/error (TS\d+):/g)].map(match => match[1]);
    if (result.error || result.signal || result.status === null || (result.status !== 0 && codes.length === 0))
        throw new SdkContractRefusal("compiler_unavailable", "Provide a working TypeScript JavaScript compiler entry; each compilation must finish within 30 seconds and 8 MiB of private resolution output.");
    return { codes, trace: result.stdout };
}
/** Collect SDK imports actually encountered by TypeScript, including external declarations. */
function sdkSpecifiers(trace) {
    const specifiers = trace.split("======== Resolving module '").slice(1).map(record => {
        const header = record.slice(0, record.indexOf("'. ========"));
        return header.slice(0, header.lastIndexOf("' from '"));
    });
    return [...new Set(specifiers.filter(specifier => specifier === "@unbrained/pm-cli" || specifier.startsWith("@unbrained/pm-cli/")))];
}
/** Resolve each import natively through the selected installation's exports before rebinding. */
function compileBoundConsumer(project, compiler) {
    let compiled = compileConsumer(project, compiler, "consumer.ts");
    const paths = {};
    const checked = new Set();
    const resolutionCodes = [];
    for (;;) {
        const pending = sdkSpecifiers(compiled.trace).filter(specifier => !checked.has(specifier));
        if (!pending.length)
            return [...compiled.codes, ...resolutionCodes];
        // Namespace probes force unresolved imports in skipLibCheck declarations to
        // become real TS2307 diagnostics in a checked source file. No declarations
        // are synthesized, and the probe has no paths mapping or outside imports.
        writeFileSync(join(project, "resolution.ts"), pending.map((specifier, index) => `import * as sdk${index} from ${JSON.stringify(specifier)}; export { sdk${index} };`).join("\n"));
        const native = compileConsumer(project, compiler, "resolution.ts");
        resolutionCodes.push(...native.codes);
        for (const specifier of pending)
            checked.add(specifier);
        for (const specifier of pending) {
            const marker = `======== Module name '${specifier}' was successfully resolved to '`;
            const start = native.trace.indexOf(marker);
            if (start < 0)
                continue;
            const tail = native.trace.slice(start + marker.length).split("'. ========", 1)[0];
            paths[specifier] = [tail.split("' with Package ID '", 1)[0]];
        }
        compiled = compileConsumer(project, compiler, "consumer.ts", paths);
    }
}
/** Locate a compiler only when the caller did not supply one; omit-dev installs get a remedy. */
export function resolveSdkContractCompiler(from = import.meta.url) {
    try {
        return join(dirname(createRequire(from).resolve("typescript/package.json")), "bin", "tsc");
    }
    catch {
        throw new SdkContractRefusal("compiler_unavailable", "Install TypeScript or pass --compiler pointing to its executable JavaScript entry.");
    }
}
/** Compile real declarations in exclusive per-call scratch storage; never touch a tracker. */
export async function checkSdkContracts(options) {
    const examples = parseSdkConsumerExamples(options.examples ?? SDK_CONSUMER_EXAMPLES);
    const targets = { minimum: { ...options.minimum, root: targetRoot(options.minimum) }, current: { ...options.current, root: targetRoot(options.current) } };
    const compiler = options.compiler ?? resolveSdkContractCompiler();
    const scratch = mkdtempSync(join(tmpdir(), "pm-sdk-contract-"));
    const rows = [];
    try {
        options.onProgress?.("allocated");
        writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
        for (const target of ["minimum", "current"]) {
            const project = join(scratch, target);
            mkdirSync(join(project, "node_modules", "@unbrained"), { recursive: true });
            symlinkSync(targets[target].root, join(project, "node_modules", "@unbrained", "pm-cli"), "junction");
            options.onProgress?.("linked");
            for (const example of examples) {
                writeFileSync(join(project, "consumer.ts"), example.source);
                const codes = compileBoundConsumer(project, compiler);
                rows.push({ target, sdk: targets[target].version, example: example.id, ok: codes.length === 0, diagnostic_count: codes.length, codes: codes.slice(0, 3) });
                options.onProgress?.("compiled");
            }
        }
    }
    finally {
        // Remove only this invocation's exclusive allocation, never caller/peer paths.
        try {
            options.onProgress?.("cleanup");
        }
        finally {
            rmSync(scratch, { recursive: true, force: true });
        }
    }
    const failed = rows.filter(row => !row.ok).length;
    return { version: 1, ok: failed === 0, checks: rows.length, failed, rows,
        remedy: failed === 0 ? "Keep these examples in the release gate." : "Restore the consumed public API or deliberately revise the compatibility promise and consumer example; dependency bumps remain separate." };
}
//# sourceMappingURL=sdk-contracts.js.map