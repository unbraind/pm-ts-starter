/** Compile author-owned consumer examples against exact installed SDK declarations. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
/** Run the selected compiler, retaining only diagnostic codes anchored to diagnostic lines. */
function compileConsumer(project, compiler, file, paths = {}, skipLibCheck = true) {
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: {
            paths, strict: true, noEmit: true, skipLibCheck, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: [],
        }, files: [file] }));
    const result = spawnSync(process.execPath, [resolve(compiler), "--project", join(project, "tsconfig.json"), "--pretty", "false"], {
        cwd: project, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, NODE_OPTIONS: "", GIT_CEILING_DIRECTORIES: dirname(dirname(project)) },
    });
    const codes = [...result.stdout.matchAll(/^(?:[^\r\n]*\(\d+,\d+\): |)error (TS\d+):/gm)].map(match => match[1]);
    if (result.error || result.signal || result.status === null || (result.status !== 0 && codes.length === 0))
        throw new SdkContractRefusal("compiler_unavailable", "Provide a working TypeScript JavaScript compiler entry; each compilation must finish within 30 seconds and 8 MiB of private diagnostic output.");
    return codes;
}
/** Refuse failed or malformed structured tooling output without exposing private output. */
function toolStrings(result) {
    try {
        if (result.status !== 0)
            throw new Error("unavailable graph");
        const values = JSON.parse(result.stdout);
        if (!Array.isArray(values) || values.some(value => typeof value !== "string" && value !== null))
            throw new Error("unparsed graph");
        return values;
    }
    catch {
        throw new SdkContractRefusal("compiler_unavailable", "Provide working structured compiler and exports resolvers; every module specifier must parse within 30 seconds and 8 MiB before certification.");
    }
}
/** Read module specifiers from compiler ASTs, including the entire external declaration graph. */
function sdkSpecifiers(project, compiler) {
    try {
        const require = createRequire(import.meta.url);
        const apiPath = require.resolve("typescript/unstable/async", { paths: [dirname(resolve(compiler)), dirname(fileURLToPath(import.meta.url))] });
        const reader = join(project, "imports.mjs");
        writeFileSync(reader, `import {createRequire} from 'node:module';
const {API} = createRequire(import.meta.url)(${JSON.stringify(apiPath)});
const api = new API({cwd: process.cwd()});
try {
  const snapshot = await api.updateSnapshot({openProjects: [process.argv[2]]});
  try {
    const program = snapshot.getProject(process.argv[2]).program;
    const files = await program.getSourceFileNames();
    const sources = await Promise.all(files.map(file => program.getSourceFile(file)));
    const specifiers = sources.flatMap(source => [...source.imports, ...source.moduleAugmentations].map(node => {
      if (typeof node.text !== 'string') throw new Error('unparsed specifier');
      return node.text;
    }));
    console.log(JSON.stringify([...new Set(specifiers.filter(name => name === '@unbrained/pm-cli' || name.startsWith('@unbrained/pm-cli/')))]));
  } finally { await snapshot.dispose(); }
} finally { await api.close(); }`);
        const result = spawnSync(process.execPath, [reader, join(project, "tsconfig.json")], {
            cwd: project, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: "" },
        });
        const specifiers = toolStrings(result);
        if (specifiers.includes(null))
            throw new Error("unparsed module specifier");
        return specifiers;
    }
    catch {
        throw new SdkContractRefusal("compiler_unavailable", "Provide a TypeScript compiler with the structured declaration-graph API; every module specifier must parse within 30 seconds and 8 MiB before certification.");
    }
}
/** Resolve exports structurally under Node's types condition; JSON preserves every specifier byte. */
function selectedExports(project, specifiers) {
    const resolver = join(project, "resolve.mjs");
    writeFileSync(resolver, `import {existsSync} from 'node:fs'; import {fileURLToPath} from 'node:url';
const specifiers = JSON.parse(process.argv[2]);
console.log(JSON.stringify(specifiers.map(specifier => { try {
  const file = fileURLToPath(import.meta.resolve(specifier)); return existsSync(file) ? file : null;
} catch { return null; } })));`);
    const result = spawnSync(process.execPath, ["--conditions=types", resolver, JSON.stringify(specifiers)], {
        cwd: project, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: "" },
    });
    return toolStrings(result);
}
/** Bind every discovered SDK import to selected exports, then check declaration resolution without skipLibCheck. */
function compileBoundConsumer(project, compiler) {
    let codes = compileConsumer(project, compiler, "consumer.ts");
    const paths = {};
    const checked = new Set();
    const resolutionCodes = [];
    for (;;) {
        const pending = sdkSpecifiers(project, compiler).filter(specifier => !checked.has(specifier));
        if (!pending.length) {
            writeFileSync(join(project, "resolution.ts"), 'export * from "./consumer.js";');
            const graph = compileConsumer(project, compiler, "resolution.ts", paths, false);
            // Dependency environment/type-implementation errors are outside this use-site
            // contract. Missing modules, missing exports and syntax errors always drift.
            return [...codes, ...resolutionCodes, ...graph.filter(code => /^(?:TS1\d+|TS230[567]|TS2459|TS2460|TS2497|TS261[34]|TS2688|TS269[34]|TS2724|TS283[45]|TS2846|TS5\d+|TS6\d+|TS7016)$/.test(code))];
        }
        const resolved = selectedExports(project, pending);
        for (const [index, specifier] of pending.entries()) {
            checked.add(specifier);
            const file = resolved[index];
            if (typeof file !== "string")
                resolutionCodes.push("TS2307");
            else
                paths[specifier] = [file];
        }
        if (resolutionCodes.length)
            return [...codes, ...resolutionCodes];
        codes = compileConsumer(project, compiler, "consumer.ts", paths);
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