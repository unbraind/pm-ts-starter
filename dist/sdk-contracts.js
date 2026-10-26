/** Compile author-owned consumer examples against exact installed SDK declarations. */
import { classifiedCompilerOptions, escapingCompilerOutputs, enforcedCompilerOptions, refusedCompilerOptions } from "./sdk-compiler-policy.js";
import { spawnSync } from "node:child_process";
import { cpSync, constants, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
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
function copyConsumer(source, destination, projectOnly = false) {
    cpSync(source, destination, { recursive: true, dereference: true, mode: constants.COPYFILE_FICLONE,
        filter: file => {
            const path = relative(source, file).replaceAll("\\", "/");
            return path !== ".git" && !(projectOnly && /(^|\/)node_modules(?:\/|$)/.test(path));
        } });
}
/** Locate an installed npm CLI without requiring Git or executable search paths. */
function npmInvocation() {
    const configured = process.env.npm_node_execpath;
    const runtime = configured && existsSync(configured) ? configured : process.execPath;
    const candidates = [process.env.npm_execpath, join(dirname(runtime), "npm"),
        join(dirname(runtime), "node_modules/npm/bin/npm-cli.js"), join(dirname(runtime), "../lib/node_modules/npm/bin/npm-cli.js")];
    for (const candidate of candidates) {
        if (!candidate || !existsSync(candidate))
            continue;
        const cli = realpathSync(candidate);
        if (basename(cli) === "npm-cli.js")
            return { command: runtime, args: [cli] };
    }
    return { command: process.platform === "win32" ? "npm.cmd" : "npm", args: [] };
}
/** Disable npm 10's unconditional directory prepare in a disposable install artifact. */
function installationArtifact(source, destination, nativeInstalled) {
    const original = readFileSync(join(source, "package.json"));
    let metadata;
    try {
        metadata = JSON.parse(original.toString());
        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
            throw new Error("invalid package metadata");
    }
    catch {
        throw new SdkContractRefusal("sdk_unavailable", "Provide installable dependency artifacts with valid package metadata before retrying.");
    }
    if (!metadata.scripts?.prepare && !(metadata.name === "typescript" && metadata.optionalDependencies && nativeInstalled))
        return undefined;
    copyConsumer(source, destination);
    if (metadata.scripts)
        delete metadata.scripts.prepare;
    // All available native companions are explicit artifacts; do not resolve unrelated platforms.
    if (metadata.name === "typescript" && nativeInstalled)
        delete metadata.optionalDependencies;
    writeFileSync(join(destination, "package.json"), JSON.stringify(metadata));
    return original;
}
/** Give every child private homes, caches and temporary storage with no inherited npm execution settings. */
function subprocessEnvironment(project) {
    const home = join(project, ".sdk-process"), cache = join(home, "cache"), temporary = join(home, "tmp");
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
    writeFileSync(file, allowed.join("\n") + "\n");
}
/** Install package artifacts separately; never carry the consumer node_modules tree into a project copy. */
function installDependencies(project, modules, names) {
    if (!existsSync(modules))
        return;
    const packages = names ?? readdirSync(modules).filter(name => !name.startsWith(".")).flatMap(name => name.startsWith("@")
        ? readdirSync(join(modules, name)).map(child => name + "/" + child) : [name]);
    const available = packages.filter(name => name !== "@unbrained/pm-cli" && existsSync(join(modules, name, "package.json")));
    const locations = new Map(available.map(name => [name, join(modules, name)]));
    if (locations.has("typescript")) {
        const nativeRoot = join(dirname(realpathSync(locations.get("typescript"))), "@typescript");
        if (existsSync(nativeRoot))
            for (const name of readdirSync(nativeRoot)) {
                const key = "@typescript/" + name;
                if (/^typescript-[a-z0-9-]+$/.test(name) && !locations.has(key)) {
                    available.push(key);
                    locations.set(key, join(nativeRoot, name));
                }
            }
    }
    const artifacts = mkdtempSync(join(dirname(project), "artifacts-")), originals = new Map();
    const sources = available.map(name => {
        const source = locations.get(name);
        const artifact = join(artifacts, name), original = installationArtifact(source, artifact, available.some(key => /^@typescript\/typescript-[a-z0-9-]+$/.test(key)));
        if (!original)
            return source;
        originals.set(name, original);
        return artifact;
    });
    if (sources.length === 0)
        return;
    const metadata = join(project, "package.json"), original = existsSync(metadata) ? readFileSync(metadata) : undefined;
    // Install only explicitly provisioned artifacts; peer SDK auto-installation would select an unrelated bound.
    writeFileSync(metadata, JSON.stringify({ private: true }));
    const env = subprocessEnvironment(project), home = env.HOME;
    registryConfiguration(project);
    const userconfig = join(home, "user.npmrc"), globalconfig = join(home, "global.npmrc");
    writeFileSync(userconfig, "");
    writeFileSync(globalconfig, "");
    const npm = npmInvocation();
    const result = spawnSync(npm.command, [...npm.args, "install", "--prefix", project, "--global=false", "--location=project",
        "--userconfig", userconfig, "--globalconfig", globalconfig, "--cache", join(home, "cache"),
        "--workspaces=false", "--include-workspace-root=false", "--install-strategy=hoisted", "--global-style=false",
        "--bin-links=false", "--script-shell", process.execPath, "--node-options=", "--foreground-scripts=false", "--link=false",
        "--tmp=" + join(home, "tmp"), "--tmpdir=" + join(home, "tmp"),
        "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", "--install-links", "--prefer-offline", "--legacy-peer-deps", ...sources], { cwd: project, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024, env });
    if (original)
        writeFileSync(metadata, original);
    else
        rmSync(metadata, { force: true });
    if (result.status !== 0)
        throw new SdkContractRefusal("sdk_unavailable", "Provision installable consumer dependencies and a working npm installer; sandbox dependency installation must complete without lifecycle scripts.");
    for (const [name, original] of originals)
        writeFileSync(join(project, "node_modules", name, "package.json"), original);
    for (const name of available.filter(name => name === "typescript" || /^@typescript\/typescript-[a-z0-9-]+$/.test(name))) {
        const source = locations.get(name);
        for (const path of readdirSync(source, { recursive: true }).map(String)) {
            const file = join(source, path), installed = join(project, "node_modules", name, path);
            if (statSync(file).isFile() && (!existsSync(installed) || !readFileSync(file).equals(readFileSync(installed)))) {
                throw new SdkContractRefusal("compiler_unavailable", "Provision installable compiler artifacts whose sandbox bytes match the original toolchain; the checker must use the same compiler and standard libraries.");
            }
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
    throw new SdkContractRefusal("isolation_refused", "Provide a self-contained consumer and a compiler with a nonempty structured resolved-file list; use the selected SDK package import instead of an external SDK path.");
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
    const rawStdout = result.stdout ?? "";
    result.stdout = stripVTControlCharacters(rawStdout)
        .replace(/^((?:.+\(\d+,\d+\): )?)\p{L}+ (TS\d+:)/gmu, "$1error $2")
        .replace(/^(.+):(\d+):(\d+) - \p{L}+ (TS\d+:)/gmu, "$1($2,$3): error $4");
    if (result.error || result.signal || result.status === null || ![0, 1, 2].includes(result.status) || (args.includes("--help") && result.status !== 0))
        throw new SdkContractRefusal("compiler_unavailable", "Provide the consumer's working TypeScript compiler; each invocation must finish within 30 seconds and 8 MiB of private output.");
    return { ...result, rawStdout };
}
/** Read one compiler-produced file path per line, refusing empty or unstructured provenance. */
function compilerFiles(project, compiler, config, options, empty, structured) {
    const output = runCompiler(project, compiler, ["--project", config, "--listFilesOnly"]).rawStdout.trimEnd();
    if (!output && empty)
        return [];
    if (structured.some(file => /[\r\n\u001b]/.test(file))) {
        if (structured.some(file => !output.includes(file) && !(options.explainFiles === true && output.includes(relative(project, file)))))
            isolationRefusal();
        return structured.map(file => realpathSync(file));
    }
    const files = [];
    let diagnostic = false;
    const explain = options.explainFiles === true, statistics = options.diagnostics === true || options.extendedDiagnostics === true;
    const lines = output.split("\n");
    for (let index = 0; index < lines.length; index++) {
        const raw = lines[index];
        const line = raw.replace(/\r$/, "");
        const file = existsSync(raw) && isAbsolute(raw) ? raw : isAbsolute(line) ? line : explain && !/^\s/.test(line) && existsSync(resolve(project, line)) && statSync(resolve(project, line)).isFile() ? resolve(project, line) : undefined;
        if (file !== undefined)
            files.push(file);
        else if (/^(?:.+\(\d+,\d+\): )?\p{L}+ TS\d+:/u.test(stripVTControlCharacters(line)))
            diagnostic = true;
        else if (!(diagnostic && /^(?:$| {2,}|\d+ |Found \d+ errors?\b)/.test(line)) &&
            !(options.traceResolution === true && files.length === 0) &&
            !(statistics && /^(?:$|[\p{L}][\p{L} /()-]*:\s+\d+(?:\.\d+)?[A-Za-z]*)$/u.test(line)) &&
            !(explain && files.length > 0 && /^(?:$| {2,}\p{L})/u.test(line)))
            isolationRefusal();
    }
    if (files.length === 0 || files.some(file => !existsSync(file)))
        isolationRefusal();
    return files.map(file => realpathSync(file));
}
/** Inspect effective output paths and checking bypasses without altering configuration. */
function isolatedConfig(project, compiler, policy) {
    let config;
    try {
        config = JSON.parse(runCompiler(project, compiler, ["--project", "tsconfig.json", "--showConfig"]).stdout);
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
    const escaping = escapingCompilerOutputs(policy, options, project);
    if (escaping.length)
        throw new SdkContractRefusal("isolation_refused", `Use project-relative output/cache paths contained in the project root (${escaping.join(", ")}); absolute and escaping destinations cannot be isolated without changing compiler behavior.`);
    return { options: enforcedCompilerOptions(options), empty: !config.files?.length && !!config.references?.length };
}
/** Verify only compiler-resolved inputs after compilation; source strings are never scanned. */
function verifyCompilation(project, compiler, installed, options, empty, observed) {
    const files = observed.some(file => /[\r\n\u001b]/.test(file)) ? structuredDiagnostics(project).files : observed;
    for (const file of compilerFiles(project, compiler, "tsconfig.json", options, empty, files)) {
        const contained = inside(project, file), owner = contained ? owningPackage(file) : { root: "", name: "" };
        if (!contained || (owner.name === "@unbrained/pm-cli" && owner.root !== installed)) {
            const name = contained ? relative(project, file).replaceAll("\\", "/") : basename(file);
            throw new SdkContractRefusal("isolation_refused", `Resolved file ${JSON.stringify(name)} is outside the isolated project or selected SDK bound; move that dependency inside the consumer project and retry.`);
        }
    }
}
/** Refuse implicit escaping emits before tsc can write beside an external resolved source. */
function guardImplicitOutputs(project, compiler, options, empty, observed) {
    if (options.noEmit === true || options.outFile !== undefined)
        return;
    const root = typeof options.rootDir === "string" ? resolve(project, options.rootDir) : options.composite === true ? project : undefined;
    for (const file of compilerFiles(project, compiler, "tsconfig.json", options, empty, observed)) {
        if (!inside(project, file) && !/\.d\.[cm]?ts$/.test(file) &&
            (options.outDir === undefined || (root !== undefined && !inside(root, file)))) {
            throw new SdkContractRefusal("isolation_refused", `Resolved source ${JSON.stringify(basename(file))} has an implicit output outside the project copy; move the source inside the project and use contained output/cache paths before retrying.`);
        }
    }
}
/** Read diagnostics through the installed package API; all presentation output has a separate discarded channel. */
function structuredDiagnostics(project) {
    const root = join(project, "node_modules", "typescript");
    const native = existsSync(join(root, "dist/api/sync/api.js"));
    const prelude = `import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const output = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);
const config = resolve('tsconfig.json');
let diagnostics, files;
`;
    const runner = native ? `import {API} from ${JSON.stringify(pathToFileURL(join(root, "dist/api/sync/api.js")).href)};
const api = new API({cwd:process.cwd()});
try {
  const snapshot = api.updateSnapshot({openProjects:[config]});
  const project = snapshot.getProject(config);
  if (!project) throw new Error('Compiler API did not open the original configuration');
  const program = project.program;
  files = program.getSourceFileNames();
  diagnostics = [...program.getConfigFileParsingDiagnostics(), ...program.getProgramDiagnostics(),
    ...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics(), ...program.getDeclarationDiagnostics()]
    .map(d => ({code:d.code,category:d.category,file:d.fileName,start:d.pos}));
  snapshot.dispose();
} finally { api.close(); }
` : `import ts from ${JSON.stringify(pathToFileURL(join(root, "lib/typescript.js")).href)};
const host = {...ts.sys, write:process.stderr.write.bind(process.stderr)};
const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, {...host,onUnRecoverableConfigFileDiagnostic:d => {throw new Error('Invalid compiler configuration');}});
const compilerHost = ts.createIncrementalCompilerHost(parsed.options);
compilerHost.trace = host.write;
const program = ts.createProgram({rootNames:parsed.fileNames, options:parsed.options, projectReferences:parsed.projectReferences, host:compilerHost, configFileParsingDiagnostics:parsed.errors});
files = program.getSourceFiles().map(file => file.fileName);
const emitted = program.emit(undefined, () => {});
diagnostics = [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics]
  .map(d => ({code:d.code,category:d.category,file:d.file?.fileName,start:d.start ?? -1}));
`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", prelude + runner + `
const seen = new Set();
const rows = diagnostics.filter(d => {const key=JSON.stringify(d); if(seen.has(key)) return false; seen.add(key); return true;});
output(JSON.stringify({files, diagnostics:rows.map(d => {
  let line=0, column=0;
  if (d.file && d.start >= 0) {
    const prefix=readFileSync(d.file,'utf8').slice(0,d.start).split(/\\r\\n|[\\r\\n\\u2028\\u2029]/);
    line=prefix.length; column=prefix[prefix.length-1].length+1;
  }
  return {...d,line,column};
})}));`], { cwd: project, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024, env: subprocessEnvironment(project) });
    try {
        if (result.error || result.signal || result.status !== 0)
            throw new Error("API runner failed");
        const data = JSON.parse(result.stdout);
        if (!Array.isArray(data.files) || data.files.some(file => typeof file !== "string"))
            throw new Error("Invalid API file list");
        const rows = data.diagnostics;
        if (!Array.isArray(rows) || rows.some(row => !Number.isInteger(row.code) || !Number.isInteger(row.category) ||
            (row.file !== undefined && typeof row.file !== "string") || !Number.isInteger(row.line) || !Number.isInteger(row.column)))
            throw new Error("Invalid API diagnostics");
        return { files: data.files, diagnostics: rows.filter(row => row.category === 1).map(row => {
                const file = row.file === undefined ? "<config>" : relative(project, resolve(project, row.file));
                return { code: "TS" + row.code, file: isAbsolute(file) || file.startsWith("..") ? "<external>" : file.replaceAll("\\", "/"), line: row.line, column: row.column };
            }) };
    }
    catch {
        throw new SdkContractRefusal("compiler_unavailable", "Provide the same installed TypeScript package with a working structured diagnostics API; compiler output is never interpreted as diagnostics.");
    }
}
/** Preserve the original compiler invocation and post-compile provenance, accepting only API diagnostics. */
function compileConsumer(project, compiler, installed, policy) {
    const { options, empty } = isolatedConfig(project, compiler, policy);
    const { diagnostics, files } = structuredDiagnostics(project);
    guardImplicitOutputs(project, compiler, options, empty, files);
    const result = runCompiler(project, compiler, ["--project", "tsconfig.json"]);
    verifyCompilation(project, compiler, installed, options, empty, files);
    if ((result.status === 0) !== (diagnostics.length === 0))
        throw new SdkContractRefusal("compiler_unavailable", "Use the consumer's matching compiler and diagnostics API; their success and error verdicts must agree.");
    return diagnostics;
}
/** Prepare strict inline sources and install matching compiler and ambient artifacts. */
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
    installDependencies(project, modules, ["typescript", "undici-types", ...ambient, ...native]);
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
            copyConsumer(resolve(options.consumer), template, true);
            installDependencies(template, resolve(options.consumer, "node_modules"));
            preparedCompiler = join(template, "node_modules", "typescript", "bin", "tsc");
        }
        for (const target of ["minimum", "current"]) {
            const project = join(scratch, target);
            // Clone only our freshly installed artifacts, never the consumer's node_modules tree.
            copyConsumer(template, project);
            const entry = inside(template, preparedCompiler) ? resolve(project, relative(template, preparedCompiler)) : preparedCompiler;
            const installed = join(project, "node_modules", "@unbrained", "pm-cli");
            rmSync(installed, { recursive: true, force: true });
            copyConsumer(targets[target].root, installed);
            targetRoot({ root: installed, version: targets[target].version });
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
                const diagnostics = compileConsumer(project, entry, installed, policy);
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