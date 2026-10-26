/** Compile author-owned consumer examples against exact installed SDK declarations. */
import { classifiedCompilerOptions, escapingCompilerOutputs, refusedCompilerOptions } from "./sdk-compiler-policy.js";
import { spawnSync } from "node:child_process";
import { cpSync, constants, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, readlinkSync, lstatSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
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
/** Copy installed names and bytes without writes to caller files; rebase internal links into the copy. */
function copyConsumer(source, destination) {
    source = realpathSync(source);
    cpSync(source, destination, { recursive: true, mode: constants.COPYFILE_FICLONE,
        filter: (file, copied) => {
            if (relative(source, file) === ".git")
                return false;
            if (!lstatSync(file).isSymbolicLink())
                return true;
            const linked = existsSync(file) ? realpathSync(file) : resolve(dirname(file), readlinkSync(file));
            mkdirSync(dirname(copied), { recursive: true });
            if (inside(source, linked))
                symlinkSync(resolve(destination, relative(source, linked)), copied);
            else
                symlinkSync(linked, copied);
            return false;
        } });
}
/** Detach writable containers while retaining their other entries as read-only installed links. */
function privateDirectory(project, path) {
    const info = lstatSync(path, { throwIfNoEntry: false });
    if (!info) {
        mkdirSync(path, { recursive: true });
        return;
    }
    if (!info.isSymbolicLink())
        return;
    const source = existsSync(path) ? realpathSync(path) : undefined;
    if (source && inside(project, source))
        return;
    unlinkSync(path);
    mkdirSync(path, { recursive: true });
    if (source)
        for (const name of readdirSync(source)) {
            const entry = join(source, name);
            symlinkSync(entry, join(path, name), existsSync(entry) && statSync(entry).isDirectory() ? "junction" : "file");
        }
}
/** Give every child private homes, caches and temporary storage with no inherited npm execution settings. */
function subprocessEnvironment(project) {
    const home = mkdtempSync(join(project, ".sdk-process-")), cache = join(home, "cache"), temporary = join(home, "tmp");
    mkdirSync(cache, { recursive: true });
    mkdirSync(temporary, { recursive: true });
    return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(npm_config_|NODE_PATH$|NODE_OPTIONS$|NODE_V8_COVERAGE$|TS)/i.test(key))),
        HOME: home, USERPROFILE: home, XDG_CACHE_HOME: cache, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home,
        TMPDIR: temporary, TMP: temporary, TEMP: temporary, NODE_V8_COVERAGE: "", GIT_CEILING_DIRECTORIES: dirname(project) };
}
/** Retain only registry connection and scoped credentials; installation policy belongs to the checker. */
function registryConfiguration(project) {
    const file = join(project, ".npmrc");
    if (!existsSync(file))
        return;
    const allowed = readFileSync(file, "utf8").split(/\r?\n/).filter(line => {
        const key = line.match(/^\s*([^=;#]+?)\s*=/)?.[1];
        return key !== undefined && /^(?:registry|@[a-z0-9_.-]+:registry|strict-ssl|ca(?:\[\])?|cafile|\/\/[^\s=]+\/:(?:_authToken|_auth|username|_password|email|always-auth))$/i.test(key);
    });
    rmSync(file, { force: true });
    writeFileSync(file, allowed.join("\n") + "\n");
}
/** Materialize existing entries by installed directory name; never ask a package manager to resolve them again. */
function materializeDependencies(project, modules, names) {
    if (!existsSync(modules))
        return;
    const destination = join(project, "node_modules");
    privateDirectory(project, destination);
    for (const name of names)
        if (existsSync(join(modules, name))) {
            privateDirectory(project, dirname(join(destination, name)));
            copyConsumer(join(modules, name), join(destination, name));
        }
    // A linked compiler can own native companions beside its canonical package root.
    const typescript = join(modules, "typescript");
    if (existsSync(typescript)) {
        const nativeRoot = join(dirname(realpathSync(typescript)), "@typescript");
        if (existsSync(nativeRoot))
            for (const name of readdirSync(nativeRoot)) {
                const installed = join(destination, "@typescript", name);
                if (/^typescript-[a-z0-9-]+$/.test(name) && !existsSync(installed)) {
                    privateDirectory(project, dirname(installed));
                    rmSync(installed, { recursive: true, force: true });
                    copyConsumer(join(nativeRoot, name), installed);
                }
            }
    }
}
/** Enumerate installed directory names without dereferencing absent scoped links. */
function installedNames(modules) {
    return readdirSync(modules).flatMap(name => name.startsWith("@")
        ? existsSync(join(modules, name)) ? readdirSync(join(modules, name)).map(child => name + "/" + child) : [] : [name]);
}
/** Retain typed malformed installed-package refusals without using metadata to choose installation names. */
function validateDependencies(project) {
    const modules = join(project, "node_modules");
    if (!existsSync(modules))
        return;
    const names = installedNames(modules).filter(name => !name.startsWith("."));
    for (const name of names) {
        const file = join(modules, name, "package.json");
        if (!existsSync(file))
            continue;
        try {
            const metadata = JSON.parse(readFileSync(file, "utf8"));
            if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
                throw new Error("invalid metadata");
        }
        catch {
            throw new SdkContractRefusal("sdk_unavailable", "Provide installed dependency packages with valid package metadata before retrying; installed directory names are preserved.");
        }
    }
}
/** Execute the identical installed compiler artifact inside the copy so its libraries are isolated too. */
function installedCompiler(project, entry) {
    if (!existsSync(entry))
        return entry;
    const canonical = realpathSync(entry), owner = owningPackage(canonical);
    return owner.name === "typescript" ? join(project, "node_modules", "typescript", relative(owner.root, canonical)) : entry;
}
/** Refuse unsafe resolution without exposing source text or machine paths. */
function isolationRefusal() {
    throw new SdkContractRefusal("isolation_refused", "Provide a self-contained consumer and a compiler with a nonempty resolved-file list; use the selected SDK package import instead of an external SDK path.");
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
        return { root, name: metadata.name ?? "" };
    }
    catch {
        return { root, name: "" };
    }
}
/** Invoke JavaScript compiler entries in their original module context with clean resolution state. */
function runCompiler(project, compiler, args) {
    const env = subprocessEnvironment(project);
    let shellShim;
    try {
        shellShim = existsSync(compiler) && /^#![^\n]*\b(?:sh|bash)\b/.test(readFileSync(compiler, "utf8").slice(0, 256));
    }
    catch {
        throw new SdkContractRefusal("compiler_unavailable", "Provide a readable JavaScript compiler entry or an executable shell shim with its original dependencies.");
    }
    const result = spawnSync(shellShim ? compiler : process.execPath, shellShim ? args : [compiler, ...args], {
        cwd: project, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024,
        env,
    });
    const stdout = result.stdout ?? "";
    if (result.error || result.signal || result.status === null || (args.includes("--help") && result.status !== 0))
        throw new SdkContractRefusal("compiler_unavailable", "Provide the consumer's working TypeScript compiler; each invocation must finish within 30 seconds and 8 MiB of private output.");
    return { ...result, stdout, status: result.status };
}
/** Keep the compiler output channel limited to diagnostics; these flags do not change checking. */
const diagnosticPresentation = ["pretty", "traceResolution", "explainFiles", "diagnostics", "extendedDiagnostics", "listFiles", "listEmittedFiles"].flatMap(name => ["--" + name, "false"]);
/** Read resolved paths from the real compiler, including fatal-error projects with no file list. */
function compilerFiles(project, compiler, empty, config) {
    const result = runCompiler(project, compiler, ["--project", config, "--listFilesOnly", ...diagnosticPresentation, "--locale", "en"]);
    const files = result.stdout.split(/\r?\n/).map(file => existsSync(resolve(project, file)) ? file : file.trim()).filter(file => file && existsSync(resolve(project, file)) && statSync(resolve(project, file)).isFile()).map(file => realpathSync(resolve(project, file)));
    if (!files.length && !empty && result.status === 0)
        isolationRefusal();
    return files;
}
/** Resolve package links once per real path, including mutually linked external dependencies. */
function dependencyRoots(project, context, compiler) {
    const visited = new Set();
    const visit = (modules) => {
        if (!existsSync(modules))
            return;
        const names = installedNames(modules);
        for (const name of names) {
            const path = join(modules, name);
            if (!existsSync(path) || !statSync(path).isDirectory())
                continue;
            const root = realpathSync(path);
            if (visited.has(root))
                continue;
            visited.add(root);
            visit(join(root, "node_modules"));
        }
    };
    visit(join(project, "node_modules"));
    if (context !== project)
        visit(join(context, "node_modules"));
    const typescript = join(project, "node_modules/typescript"), owner = owningPackage(realpathSync(compiler));
    const compilers = new Set();
    if (existsSync(typescript))
        compilers.add(realpathSync(typescript));
    if (owner.name && owner.root !== dirname(owner.root))
        compilers.add(owner.root);
    for (const root of compilers) {
        visited.add(root);
        visit(join(dirname(root), "@typescript"));
    }
    return visited;
}
/** Inspect effective output paths and checking bypasses without altering configuration. */
function isolatedConfig(project, compiler, policy, file, build = false) {
    let config;
    try {
        const inspected = runCompiler(project, compiler, ["--project", file, "--showConfig"]);
        if (inspected.status !== 0) {
            if (compilerDiagnostics(project, inspected.stdout).length)
                return { empty: false, references: [] };
            throw new SdkContractRefusal("compiler_unavailable", "Provide a compiler that can inspect this project configuration before invoking the isolated typecheck.");
        }
        config = JSON.parse(inspected.stdout);
    }
    catch (error) {
        if (error instanceof SdkContractRefusal)
            throw error;
        isolationRefusal();
    }
    if (!config.compilerOptions)
        isolationRefusal();
    const options = config.compilerOptions;
    const refused = refusedCompilerOptions(policy, options);
    if (refused.length)
        throw new SdkContractRefusal("isolation_refused", `Disable checking bypasses or command modes (${refused.join(", ")}) in the consumer configuration before retrying; the checker preserves option values.`);
    const empty = !config.files?.length && !!config.references?.length;
    const escaping = escapingCompilerOutputs(policy, build || empty ? { ...options, incremental: true } : options, project, file);
    if (escaping.length)
        throw new SdkContractRefusal("isolation_refused", `Use project-relative output/cache paths contained in the project root (${escaping.join(", ")}); absolute and escaping destinations cannot be isolated without changing compiler behavior.`);
    return { empty, references: (config.references ?? []).map(reference => resolve(dirname(file), reference.path)) };
}
/** Check actual compiler-resolved inputs; installed external packages stay linked and read-only. */
function verifyCompilation(project, compiler, installed, empty, config) {
    const roots = dependencyRoots(project, dirname(config), compiler);
    for (const file of compilerFiles(project, compiler, empty, config)) {
        const contained = inside(project, file), owner = owningPackage(file);
        if ((!contained && ![...roots].some(root => inside(root, file))) || (owner.name === "@unbrained/pm-cli" && owner.root !== installed)) {
            const name = contained ? relative(project, file).replaceAll("\\", "/") : basename(file);
            throw new SdkContractRefusal("isolation_refused", `Resolved file ${JSON.stringify(name)} is outside the isolated project or selected SDK bound; move that dependency inside the consumer project and retry.`);
        }
    }
}
/** Parse the compiler's pretty-false diagnostic headers without recreating compiler semantics. */
function compilerDiagnostics(project, output) {
    const diagnostics = [];
    let previous;
    for (const line of output.split(/\r?\n/)) {
        const match = /^(?:([^\n]+)\((\d+),(\d+)\): )?error (TS\d+): ([\s\S]*)$/.exec(line);
        if (!match) {
            if (previous)
                previous.message += "\n" + line.replaceAll(project, ".");
            continue;
        }
        const path = match[1] === undefined ? undefined : relative(project, resolve(project, match[1]));
        diagnostics.push({ code: match[4], file: path === undefined ? "<config>" : inside(project, resolve(project, match[1])) ? path.replaceAll("\\", "/") : "<external>",
            line: Number(match[2] ?? 0), column: Number(match[3] ?? 0), message: match[5].replaceAll(project, ".") });
        previous = diagnostics.at(-1);
    }
    return diagnostics.map(row => ({ ...row, message: row.message.trimEnd() }));
}
/** Delegate verdict, fatal-error ordering, global diagnostics and references to the actual tsc. */
function compileConsumer(project, compiler, installed, policy) {
    const config = join(project, "tsconfig.json"), root = isolatedConfig(project, compiler, policy, config);
    const projects = new Map([[config, root]]), seen = new Set([realpathSync(config)]);
    // Build can write incremental metadata: inspect its self-contained reference graph first.
    const visit = (path) => {
        const file = existsSync(path) && statSync(path).isDirectory() ? join(path, "tsconfig.json") : path;
        if (!inside(project, file) || (existsSync(file) && !inside(project, realpathSync(file))))
            isolationRefusal();
        if (!existsSync(file) || seen.has(realpathSync(file)))
            return;
        seen.add(realpathSync(file));
        const settings = isolatedConfig(project, compiler, policy, file, true);
        projects.set(file, settings);
        for (const reference of settings.references)
            visit(reference);
    };
    if (root.empty)
        for (const reference of root.references)
            visit(reference);
    const empty = root.empty;
    const args = [empty ? "--build" : "--project", "tsconfig.json", "--noEmit", ...diagnosticPresentation, ...empty ? [] : ["--locale", "en"]];
    const result = runCompiler(project, compiler, args);
    const diagnostics = result.status === 0 ? [] : compilerDiagnostics(project, result.stdout);
    if (result.status !== 0 && !diagnostics.length)
        throw new SdkContractRefusal("compiler_unavailable", "Provide the consumer's real tsc executable with pretty-false error diagnostics; the compiler exited unsuccessfully without a diagnostic header.");
    for (const [file, settings] of projects)
        verifyCompilation(project, compiler, installed, settings.empty, file);
    return { ok: result.status === 0, exit_code: result.status, diagnostics };
}
/** Prepare strict inline sources and copy matching compiler and ambient artifacts. */
function inlineConsumer(project, compiler) {
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: {
            strict: true, noEmit: true, skipLibCheck: false, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: ["node"],
        }, files: ["consumer.ts"] }));
    const entry = resolve(compiler);
    const parts = entry.split(/[/\\]node_modules[/\\]/);
    const modules = parts.length > 1 ? join(parts.slice(0, -1).join("/node_modules/"), "node_modules") : dirname(dirname(dirname(resolveSdkContractCompiler())));
    const ambient = existsSync(join(modules, "@types")) ? readdirSync(join(modules, "@types")).map(name => "@types/" + name) : [];
    const native = existsSync(join(modules, "@typescript")) ? readdirSync(join(modules, "@typescript")).map(name => "@typescript/" + name) : [];
    materializeDependencies(project, modules, ["typescript", "undici-types", ...ambient, ...native]);
    return installedCompiler(project, entry);
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
/** Compile real declarations with original option values and disposable output/cache storage. */
export async function checkSdkContracts(options) {
    if (options.consumer !== undefined && (typeof options.consumer !== "string" || !options.consumer.trim() || options.examples !== undefined || options.compiler !== undefined))
        throw new SdkContractRefusal("invalid_input", "Provide either a self-contained consumer directory or inline examples and an optional compiler.");
    const examples = options.consumer === undefined ? parseSdkConsumerExamples(options.examples ?? SDK_CONSUMER_EXAMPLES) : [{ id: "consumer", source: "" }];
    const targets = { minimum: { ...options.minimum, root: targetRoot(options.minimum) }, current: { ...options.current, root: targetRoot(options.current) } };
    const compiler = options.compiler ?? (options.consumer === undefined ? resolveSdkContractCompiler() : "");
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), "pm-sdk-contract-")));
    const rows = [];
    const policies = new Map();
    try {
        options.onProgress?.("allocated");
        const template = join(scratch, "template");
        let preparedCompiler;
        if (options.consumer === undefined)
            preparedCompiler = inlineConsumer(template, compiler);
        else {
            copyConsumer(resolve(options.consumer), template);
            materializeDependencies(template, resolve(options.consumer, "node_modules"), []);
            const bin = join(template, "node_modules/.bin/tsc");
            preparedCompiler = existsSync(bin) ? bin : join(template, "node_modules/typescript/bin/tsc");
        }
        validateDependencies(template);
        registryConfiguration(template);
        for (const target of ["minimum", "current"]) {
            const project = join(scratch, target);
            // Clone the consumer-owned resolution unchanged, then replace only the selected SDK.
            copyConsumer(template, project);
            const entry = inside(template, preparedCompiler) ? resolve(project, relative(template, preparedCompiler)) : preparedCompiler;
            const installed = join(project, "node_modules", "@unbrained", "pm-cli");
            privateDirectory(project, dirname(installed));
            rmSync(installed, { recursive: true, force: true });
            copyConsumer(targets[target].root, installed);
            targetRoot({ root: installed, version: targets[target].version });
            const installedRoot = realpathSync(installed);
            options.onProgress?.("linked");
            for (const example of examples) {
                if (options.consumer === undefined)
                    writeFileSync(join(project, "consumer.ts"), example.source);
                const compilerKey = options.consumer ?? compiler;
                let policy = policies.get(compilerKey);
                if (!policy) {
                    const help = runCompiler(project, entry, ["--help", "--all", "--locale", "en"]).stdout;
                    try {
                        policy = classifiedCompilerOptions(help);
                    }
                    catch {
                        throw new SdkContractRefusal("isolation_refused", "Classify every option in this compiler's complete help-all table in the SDK compiler policy before retrying; provide a supported compiler with English help output.");
                    }
                    policies.set(compilerKey, policy);
                }
                const { ok, exit_code, diagnostics } = compileConsumer(project, entry, installedRoot, policy);
                targetRoot({ root: installed, version: targets[target].version });
                rows.push({ target, sdk: targets[target].version, example: example.id, ok, exit_code, diagnostic_count: diagnostics.length,
                    codes: diagnostics.slice(0, 3).map(diagnostic => diagnostic.code), diagnostics });
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