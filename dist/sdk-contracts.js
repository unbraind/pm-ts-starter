/** Compile author-owned consumer examples against exact installed SDK declarations. */
import { spawnSync } from "node:child_process";
import { cpSync, constants, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
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
            const toolchain = /(^|\/)node_modules\/(typescript(?:\/|$)|@typescript\/typescript-[^/]+(?:\/|$))/.test(path);
            return !(omitSdk && path === "node_modules/@unbrained/pm-cli") && path !== ".git" && !/(^|\/)node_modules\/\.bin$/.test(path) &&
                (!toolchain || statSync(file).isDirectory() || /(?:\.d\.(?:ts|mts|cts)|\.json)$/.test(path));
        } });
}
/** Refuse unsafe resolution without exposing source text or machine paths. */
function isolationRefusal() {
    throw new SdkContractRefusal("isolation_refused", "Keep all imports, reference paths, config references, paths and typeRoots inside a self-contained consumer; inline absolute declarations must be self-contained. Use the selected SDK package import instead of an external SDK path.");
}
/** Compare complete path components, including canonical symlink destinations. */
function inside(root, file) {
    const path = relative(root, file);
    return !isAbsolute(path) && path !== ".." && !path.startsWith("../") && !path.startsWith("..\\");
}
/** Locate package ownership using metadata, never substring matches on diagnostic text. */
function owningPackage(file) {
    let root = dirname(file);
    while (!existsSync(join(root, "package.json")) && dirname(root) !== root)
        root = dirname(root);
    try {
        const metadata = existsSync(join(root, "package.json")) ? JSON.parse(readFileSync(join(root, "package.json"), "utf8")) : {};
        return { root, name: metadata.name ?? "", type: metadata.type };
    }
    catch {
        isolationRefusal();
    }
}
/** Invoke JavaScript compiler entries in their original module context with clean resolution state. */
function runCompiler(project, compiler, args) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(NODE_PATH$|NODE_OPTIONS$|TS)/i.test(key)));
    let shellShim;
    try {
        shellShim = existsSync(compiler) && /^#![^\n]*\b(?:sh|bash)\b/.test(readFileSync(compiler, "utf8").slice(0, 256));
    }
    catch {
        throw new SdkContractRefusal("compiler_unavailable", "Provide a readable JavaScript compiler entry or an executable shell shim with its original dependencies.");
    }
    const result = spawnSync(shellShim ? compiler : process.execPath, shellShim ? args : [compiler, ...args], {
        cwd: project, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024,
        env: { ...env, GIT_CEILING_DIRECTORIES: dirname(project) },
    });
    if (result.error || result.signal || result.status === null || (result.status !== 0 && !/error TS\d+:/.test(result.stdout)))
        throw new SdkContractRefusal("compiler_unavailable", "Provide the consumer's working TypeScript compiler; each invocation must finish within 30 seconds and 8 MiB of private output.");
    return result;
}
/** Read one compiler-produced file path per line, refusing empty or unstructured provenance. */
function compilerFiles(project, compiler, config) {
    const output = runCompiler(project, compiler, ["--project", config, "--listFilesOnly", "--pretty", "false"]).stdout.trim();
    const files = [];
    let diagnostic = false;
    for (const line of output.split(/\r?\n/)) {
        if (isAbsolute(line)) {
            files.push(line);
            diagnostic = false;
        }
        else if (/^(?:.+\(\d+,\d+\): )?error TS\d+:/.test(line))
            diagnostic = true;
        else if (!diagnostic || !/^ {2,}/.test(line))
            isolationRefusal();
    }
    if (files.length === 0 || files.some(file => !existsSync(file)))
        isolationRefusal();
    return files.map(file => realpathSync(file));
}
/** Reject explicit escaping references even when their target is missing or not selected by resolution. */
function guardReferences(project, file) {
    const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|(?<!\/)\/\/(?!\/\s*<reference)[^\n]*/g, "");
    const references = /(?:\b(?:from|import|require)\s*(?:\(\s*)?|<reference\s+(?:path|types)\s*=\s*|["'](?:extends|path)["']\s*:\s*)(["'])([^'"\r\n]*)\1/g;
    for (const match of source.matchAll(references)) {
        const value = match[2];
        if (value.startsWith("\\") || ((isAbsolute(value) || value.startsWith(".")) && !inside(project, resolve(dirname(file), value))))
            isolationRefusal();
    }
}
/** Validate effective JSON configuration paths before any type checking, including unused aliases. */
function isolatedConfig(project, compiler) {
    guardReferences(project, join(project, "tsconfig.json"));
    let config;
    try {
        config = JSON.parse(runCompiler(project, compiler, ["--project", "tsconfig.json", "--showConfig"]).stdout);
    }
    catch (error) {
        if (error instanceof SdkContractRefusal)
            throw error;
        isolationRefusal();
    }
    const options = config.compilerOptions ?? {};
    const paths = [options.baseUrl ?? ".", options.rootDir ?? ".", ...Object.values(options.paths ?? {}).flat(),
        ...(options.typeRoots ?? []), ...(options.rootDirs ?? []), ...(options.types ?? []).filter(value => isAbsolute(value) || value.startsWith(".")),
        ...(config.files ?? []), ...(config.references ?? []).map(entry => entry.path)];
    if (paths.some(path => typeof path !== "string" || !inside(project, resolve(project, path))) || !config.files?.length)
        isolationRefusal();
    return { ...config, compilerOptions: options, files: config.files };
}
/** Relocate simple absolute inline declaration imports; complex external graphs receive a typed remedy. */
function isolateInline(source, project, copied = new Map(), base = project) {
    return source.replace(/((?:\b(?:from|import|require)\s*(?:\(\s*)?|<reference\s+(?:path|types)\s*=\s*))(['"])([^'"\r\n\\]*)\2/g, (literal, prefix, _quote, value) => {
        if (!isAbsolute(value))
            return literal;
        const declaration = value.replace(/\.(mjs|cjs|js)$/, (_suffix, kind) => kind === "mjs" ? ".d.mts" : kind === "cjs" ? ".d.cts" : ".d.ts");
        if (!/\.d\.(ts|mts|cts)$/.test(declaration) || !existsSync(declaration) || owningPackage(declaration).name === "@unbrained/pm-cli" || copied.size >= 64)
            isolationRefusal();
        let destination = copied.get(declaration);
        if (!destination) {
            const suffix = declaration.endsWith(".d.ts") ? owningPackage(declaration).type === "module" ? ".d.mts" : ".d.cts" : declaration.slice(declaration.lastIndexOf(".d."));
            destination = join(project, ".sdk-contract-inputs", `${copied.size}${suffix}`);
            copied.set(declaration, destination);
            const content = readFileSync(declaration, "utf8");
            // Relative dependencies need an explicitly provisioned project, not a guessed module resolver.
            if (/(?:['"]\.\.?[\\/]|<reference\s+path\s*=)/.test(content) || Buffer.byteLength(content) > 65536)
                isolationRefusal();
            mkdirSync(dirname(destination), { recursive: true });
            writeFileSync(destination, isolateInline(content, project, copied, dirname(destination)));
        }
        const path = "./" + relative(base, destination).replaceAll("\\", "/");
        return prefix + JSON.stringify(prefix.startsWith("<reference") ? path : path.replace(/\.d\.mts$/, ".mjs").replace(/\.d\.cts$/, ".cjs").replace(/\.d\.ts$/, ".js"));
    });
}
/** Stage only compiler library declarations; executable compiler files are never copied or renamed. */
function prepareCompilation(project, compiler, installed) {
    const config = isolatedConfig(project, compiler);
    const libraries = [];
    for (const file of config.files)
        if (existsSync(resolve(project, file)))
            guardReferences(project, resolve(project, file));
    for (const file of compilerFiles(project, compiler, "tsconfig.json")) {
        if (inside(project, file)) {
            libraries.push(relative(project, file));
            continue;
        }
        const owner = owningPackage(file);
        if (!/^(typescript|@typescript\/typescript-[a-z0-9-]+)$/.test(owner.name) || dirname(file) !== join(owner.root, "lib") || !/^lib\..*\.d\.ts$/.test(basename(file)))
            isolationRefusal();
        const destination = join(project, ".sdk-contract-libs", basename(file));
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, readFileSync(file));
        libraries.push(relative(project, destination));
    }
    // Explicit roots retain the compiler's exact library set while noLib prevents fallback to its installation.
    delete config.compilerOptions.lib;
    config.compilerOptions.noLib = true;
    config.files.push(...libraries);
    writeFileSync(join(project, ".sdk-contract.json"), JSON.stringify(config));
    verifyCompilation(project, compiler, installed);
    return ".sdk-contract.json";
}
/** Fail closed before and after compilation if any file or SDK package escapes the selected installation. */
function verifyCompilation(project, compiler, installed) {
    for (const file of compilerFiles(project, compiler, ".sdk-contract.json")) {
        const owner = owningPackage(file);
        const path = file.replaceAll("\\", "/"), selected = installed.replaceAll("\\", "/");
        const sdk = "/node_modules/@unbrained/pm-cli/", offset = path.lastIndexOf(sdk);
        if (!inside(project, file) || (owner.name === "@unbrained/pm-cli" && owner.root !== installed) ||
            (offset >= 0 && path.slice(0, offset + sdk.length - 1) !== selected))
            isolationRefusal();
        guardReferences(project, file);
    }
}
/** Run only the consumer compiler; every error contributes to drift without filtering codes. */
function compileConsumer(project, compiler, installed) {
    const config = prepareCompilation(project, compiler, installed);
    const result = runCompiler(project, compiler, ["--project", config, "--noEmit", "--skipLibCheck", "false", "--pretty", "false"]);
    verifyCompilation(project, compiler, installed);
    const diagnostics = [...result.stdout.matchAll(/^(?:(.+)\((\d+),(\d+)\): |)error (TS\d+):/gm)].map(match => {
        const file = match[1] === undefined ? "<config>" : relative(project, resolve(project, match[1]));
        return { code: match[4], file: isAbsolute(file) || file.startsWith("..") ? "<external>" : file.replaceAll("\\", "/"),
            line: Number(match[2] ?? 0), column: Number(match[3] ?? 0) };
    });
    if (result.status !== 0 && diagnostics.length === 0)
        throw new SdkContractRefusal("compiler_unavailable", "Use a working compiler that reports structured TypeScript diagnostics for every failing compilation.");
    return diagnostics;
}
/** Prepare strict inline sources and ambient dependencies without copying the compiler. */
function inlineConsumer(project, compiler) {
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: {
            strict: true, noEmit: true, skipLibCheck: false, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: ["node"],
        }, files: ["consumer.ts"] }));
    const entry = resolve(compiler);
    const parts = entry.split(/[/\\]node_modules[/\\]/);
    const modules = parts.length > 1 ? join(parts.slice(0, -1).join("/node_modules/"), "node_modules") : dirname(dirname(dirname(resolveSdkContractCompiler())));
    for (const name of ["@types", "undici-types"]) {
        const source = join(modules, name);
        if (existsSync(source))
            copyConsumer(source, join(project, "node_modules", name));
    }
    return entry;
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
                entry = resolve(options.consumer, "node_modules", "typescript", "bin", "tsc");
            }
            const installed = join(project, "node_modules", "@unbrained", "pm-cli");
            rmSync(installed, { recursive: true, force: true });
            copyConsumer(targets[target].root, installed);
            targetRoot({ root: installed, version: targets[target].version });
            options.onProgress?.("linked");
            for (const example of examples) {
                if (options.consumer === undefined)
                    writeFileSync(join(project, "consumer.ts"), isolateInline(example.source, project));
                const diagnostics = compileConsumer(project, entry, installed);
                targetRoot({ root: installed, version: targets[target].version });
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