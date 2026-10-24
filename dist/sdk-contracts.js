/** Compile author-owned consumer examples against exact installed SDK declarations. */
import { spawnSync } from "node:child_process";
import { cpSync, constants, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
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
/** Copy bytes and dereference links so compiler resolution stays inside the consumer. */
function copyConsumer(source, destination, omitSdk = false) {
    cpSync(source, destination, { recursive: true, dereference: true, mode: constants.COPYFILE_FICLONE,
        filter: file => {
            const path = relative(source, file).replaceAll("\\", "/");
            return !(omitSdk && path === "node_modules/@unbrained/pm-cli") && path !== ".git" && !/(^|\/)node_modules\/\.bin$/.test(path);
        } });
}
/** Run only the consumer compiler; every error contributes to drift without filtering codes. */
function compileConsumer(project, compiler) {
    const result = spawnSync(process.execPath, [compiler, "--project", "tsconfig.json", "--noEmit", "--skipLibCheck", "false", "--pretty", "false"], {
        cwd: project, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, NODE_OPTIONS: "", GIT_CEILING_DIRECTORIES: dirname(project) },
    });
    const diagnostics = [...result.stdout.matchAll(/^(?:(.+)\((\d+),(\d+)\): |)error (TS\d+):/gm)].map(match => {
        const file = match[1] === undefined ? "<config>" : relative(project, resolve(project, match[1]));
        return { code: match[4], file: isAbsolute(file) || file.startsWith("..") ? "<external>" : file.replaceAll("\\", "/"),
            line: Number(match[2] ?? 0), column: Number(match[3] ?? 0) };
    });
    if (result.error || result.signal || result.status === null || (result.status !== 0 && diagnostics.length === 0))
        throw new SdkContractRefusal("compiler_unavailable", "Provide the consumer's working TypeScript compiler; each compilation must finish within 30 seconds and 8 MiB of private diagnostic output.");
    return diagnostics;
}
/** Prepare the legacy inline examples as a self-contained strict consumer project. */
function inlineConsumer(project, compiler) {
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: {
            strict: true, noEmit: true, skipLibCheck: false, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: ["node"],
        }, files: ["consumer.ts"] }));
    // Copy the installed toolchain and ambient dependencies, never remap declarations.
    try {
        if (basename(compiler) !== "tsc") {
            const entry = join(project, "compiler.cjs");
            writeFileSync(entry, readFileSync(compiler));
            return entry;
        }
        const modules = dirname(dirname(dirname(resolve(compiler))));
        for (const name of ["typescript", "@typescript", "@types", "undici-types"]) {
            const source = join(modules, name);
            if (existsSync(source))
                copyConsumer(source, join(project, "node_modules", name));
        }
        return join(project, "node_modules", "typescript", "bin", "tsc");
    }
    catch {
        throw new SdkContractRefusal("compiler_unavailable", "Provide a readable TypeScript compiler installation to copy into the inline consumer.");
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
    if (options.consumer !== undefined && (typeof options.consumer !== "string" || !options.consumer.trim() || options.examples !== undefined || options.compiler !== undefined))
        throw new SdkContractRefusal("invalid_input", "Provide either a self-contained consumer directory or inline examples and an optional compiler.");
    const examples = options.consumer === undefined ? parseSdkConsumerExamples(options.examples ?? SDK_CONSUMER_EXAMPLES) : [{ id: "consumer", source: "" }];
    const targets = { minimum: { ...options.minimum, root: targetRoot(options.minimum) }, current: { ...options.current, root: targetRoot(options.current) } };
    const compiler = options.compiler ?? (options.consumer === undefined ? resolveSdkContractCompiler() : "");
    const scratch = mkdtempSync(join(tmpdir(), "pm-sdk-contract-"));
    const rows = [];
    try {
        options.onProgress?.("allocated");
        for (const target of ["minimum", "current"]) {
            const project = join(scratch, target);
            let entry;
            if (options.consumer === undefined)
                entry = inlineConsumer(project, compiler);
            else {
                copyConsumer(resolve(options.consumer), project, true);
                entry = join(project, "node_modules", "typescript", "bin", "tsc");
            }
            const installed = join(project, "node_modules", "@unbrained", "pm-cli");
            rmSync(installed, { recursive: true, force: true });
            copyConsumer(targets[target].root, installed);
            targetRoot({ root: installed, version: targets[target].version });
            options.onProgress?.("linked");
            for (const example of examples) {
                if (options.consumer === undefined)
                    writeFileSync(join(project, "consumer.ts"), example.source);
                const diagnostics = compileConsumer(project, entry);
                rows.push({ target, sdk: targets[target].version, example: example.id, ok: diagnostics.length === 0, diagnostic_count: diagnostics.length,
                    codes: diagnostics.slice(0, 3).map(diagnostic => diagnostic.code), diagnostics: diagnostics.slice(0, 3) });
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