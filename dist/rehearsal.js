/** Isolated, resumable rehearsals around the authoritative SDK migration engine. */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { PmClient, acquireLock, certifyCompleteListResult, isPmCliExpectedError, readLocatedItem, readSettings, resolveItemTypeRegistry, writeFileAtomic, } from "@unbrained/pm-cli/sdk";
/** Stable refusal with a remedy, free of source values or machine paths. */
export class RehearsalRefusal extends Error {
    /** Machine-readable failure class. */
    code;
    /** Action needed before retry. */
    remedy;
    /** Bounded sample, with the full count retained separately. */
    diagnostics;
    /** Total invalid documents, including omitted diagnostic rows. */
    diagnostic_count;
    /** Construct a path-free refusal from a trusted wrapper boundary. */
    constructor(code, remedy, diagnostics = []) {
        super(remedy);
        this.code = code;
        this.remedy = remedy;
        this.diagnostics = diagnostics.slice(0, 20);
        this.diagnostic_count = diagnostics.length;
    }
}
/** Names excluded from snapshots because they are executable or derived runtime state. */
const excluded = new Set(["extensions", "runtime", "locks", "search", "transactions", ".git"]);
/** Hash exact bytes with deterministic file ordering. */
function digest(value) {
    return createHash("sha256").update(value).digest("hex");
}
/** Refuse unsupported plans before creating scratch artifacts. */
export function parseRehearsalPlan(value) {
    if (typeof value !== "object" || value === null)
        throw new RehearsalRefusal("invalid_plan", "Provide a version 1 plan with 1 to 32 ordered core schema steps.");
    const plan = value;
    if (plan.version !== 1 || !Array.isArray(plan.steps) || plan.steps.length < 1 || plan.steps.length > 32)
        throw new RehearsalRefusal("invalid_plan", "Provide a version 1 plan with 1 to 32 ordered core schema steps.");
    for (const step of plan.steps) {
        if (!step || !["rename-field", "rename-type", "remap-status"].includes(step.kind) ||
            typeof step.from !== "string" || typeof step.to !== "string" || !/^[a-zA-Z][\w-]{0,63}$/.test(step.from) ||
            !/^[a-zA-Z][\w-]{0,63}$/.test(step.to) || step.from.toLowerCase() === step.to.toLowerCase() ||
            ("type" in step && (step.kind !== "rename-field" || typeof step.type !== "string"))) {
            throw new RehearsalRefusal("invalid_plan", "Use distinct schema names and a core rename-field, rename-type or remap-status operation.");
        }
    }
    return structuredClone(plan);
}
/** Reject containment, traversal and symlinks rather than guessing ownership. */
function inside(root, target) {
    const rel = relative(root, target);
    return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
/** Require real directories throughout a caller-supplied path. */
function safePath(target) {
    for (let current = resolve(target);; current = dirname(current)) {
        if (existsSync(current) && !lstatSync(current).isDirectory())
            throw new RehearsalRefusal("unsafe_storage", "Use regular directories without symbolic links.");
        if (dirname(current) === current)
            break;
    }
}
/** Read authoritative bytes only; refuse links, special files and excessive snapshots. */
function snapshot(root) {
    const files = new Map();
    let bytes = 0;
    /** Walk one tracker-relative directory without following links. */
    function walk(folder) {
        for (const name of readdirSync(join(root, folder)).sort()) {
            if (folder === "" && excluded.has(name))
                continue;
            const file = join(folder, name);
            const stat = lstatSync(join(root, file));
            if (stat.isDirectory()) {
                if (/\.(toon|md)$/.test(name))
                    throw new RehearsalRefusal("unsafe_storage", "Replace item-shaped directories with valid regular item files before rehearsing.");
                walk(file);
            }
            else {
                if (!stat.isFile() || stat.nlink !== 1)
                    throw new RehearsalRefusal("unsafe_storage", "Use a snapshot with regular, unlinked files only.");
                bytes += stat.size;
                if (bytes > 256 * 1024 * 1024 || files.size >= 20000)
                    throw new RehearsalRefusal("unsafe_storage", "Reduce the tracker snapshot below 256 MiB and 20000 files.");
                files.set(file, readFileSync(join(root, file)));
            }
        }
    }
    walk("");
    return files;
}
/** Fingerprint names and bytes independently, avoiding ambiguous concatenation. */
function fingerprint(files) {
    return digest(JSON.stringify([...files].map(([name, data]) => [name, digest(data)])));
}
/** Refuse schema definitions that could send a scratch SDK operation outside its tracker. */
function assertLocalSchema(root, files) {
    const settings = JSON.parse(files.get("settings.json").toString());
    for (const file of Object.values(settings.schema?.files ?? {})) {
        if (isAbsolute(file) || !inside(root, resolve(root, file)))
            throw new RehearsalRefusal("unsafe_storage", "Keep schema files inside the tracker before rehearsing.");
    }
}
/** Validate every physical item with the SDK before accepting a certified corpus. */
async function inspect(root) {
    const settings = await readSettings(root);
    const registry = resolveItemTypeRegistry(settings);
    const diagnostics = [];
    for (const folder of registry.folders) {
        if (!existsSync(join(root, folder)))
            continue;
        for (const name of readdirSync(join(root, folder)).sort()) {
            if (!/\.(toon|md)$/.test(name))
                continue;
            const file = join(folder, name);
            try {
                await readLocatedItem({ id: name.replace(/\.(toon|md)$/, ""), type: "Task", itemPath: join(root, file), item_format: name.endsWith(".toon") ? "toon" : "json_markdown" }, { schema: settings.schema });
            }
            catch (error) {
                if (!isPmCliExpectedError(error))
                    throw error;
                const field = String(error.context?.why).match(/metadata field "([\w.]+)"|missing required schema field: ([\w.]+)/)?.slice(1).find(Boolean) ?? error.context?.field;
                diagnostics.push({ file, field: typeof field === "string" ? field : "document" });
            }
        }
    }
    if (diagnostics.length)
        throw new RehearsalRefusal("invalid_data", "Repair the reported fields in a separate reviewed tracker copy, then start a new rehearsal.", diagnostics);
    return certifyCompleteListResult(await new PmClient({ pmRoot: root, noExtensions: true }).listAllComplete()).items.length;
}
/** Run actual SDK migrations exclusively on a private copy and resume stable core operation IDs. */
async function executeRehearsal(options) {
    const plan = parseRehearsalPlan(options.plan);
    const source = resolve(options.source), work = resolve(options.workDir);
    safePath(source);
    safePath(work);
    if (inside(source, work) || inside(work, source))
        throw new RehearsalRefusal("unsafe_storage", "Choose disjoint source and rehearsal directories.");
    for (let current = work;; current = dirname(current)) {
        if (existsSync(join(current, ".git")))
            throw new RehearsalRefusal("unsafe_storage", "Choose a rehearsal directory outside a Git repository.");
        if (dirname(current) === current)
            break;
    }
    const input = snapshot(source), sourceFingerprint = fingerprint(input);
    assertLocalSchema(source, input);
    const identity = digest(JSON.stringify([realpathSync(source), plan]));
    const resumed = existsSync(work);
    if (!resumed)
        mkdirSync(work, { mode: 0o700 });
    const release = await acquireLock(work, "rehearsal", 300, "schema-rehearsal", false, false, 0);
    try {
        const checkpointPath = join(work, "rehearsal.json"), tracker = join(work, "tracker");
        let state;
        if (resumed) {
            snapshot(work);
            assertLocalSchema(tracker, snapshot(tracker));
            state = JSON.parse(readFileSync(checkpointPath, "utf8"));
            if (state.version !== 1 || state.identity !== identity || state.fingerprint !== sourceFingerprint ||
                !Number.isInteger(state.completed) || state.completed < 0 || state.completed > plan.steps.length ||
                !Number.isInteger(state.affected) || state.affected < 0 || !Number.isInteger(state.items) || state.items < 0) {
                throw new RehearsalRefusal("source_changed", "Use the original source and plan, or choose a new rehearsal directory.");
            }
        }
        else {
            mkdirSync(tracker, { mode: 0o700 });
            for (const [file, data] of input) {
                mkdirSync(dirname(join(tracker, file)), { recursive: true });
                writeFileSync(join(tracker, file), data, { flag: "wx", mode: 0o600 });
            }
            state = { version: 1, identity, fingerprint: sourceFingerprint, completed: 0, affected: 0, items: await inspect(tracker) };
            await writeFileAtomic(checkpointPath, JSON.stringify(state));
        }
        const client = new PmClient({ pmRoot: tracker, noExtensions: true, author: "schema-rehearsal" });
        for (let index = state.completed; index < plan.steps.length; index++) {
            const step = plan.steps[index];
            const controls = { migrationId: `rehearsal-${identity.slice(0, 24)}-${index}`, author: "schema-rehearsal" };
            const result = step.kind === "rename-field" ? await client.schemaRenameField(step.from, step.to, controls, step.type) :
                step.kind === "rename-type" ? await client.schemaRenameType(step.from, step.to, controls) : await client.schemaRemapStatus(step.from, step.to, controls);
            options.afterStep?.(index);
            state.completed = index + 1;
            state.affected += result.affected_item_count;
            await writeFileAtomic(checkpointPath, JSON.stringify(state));
        }
        if (await inspect(tracker) !== state.items)
            throw new RehearsalRefusal("invalid_data", "Inspect scratch item identities; the migration changed the corpus size.");
        if (fingerprint(snapshot(source)) !== sourceFingerprint)
            throw new RehearsalRefusal("source_changed", "The source changed during rehearsal; repeat from a stable snapshot.");
        return { ok: true, version: 1, items: state.items, steps: state.completed, affected: state.affected, resumed, source_fingerprint: sourceFingerprint, source_unchanged: true };
    }
    finally {
        await release();
    }
}
/** Sanitize storage and SDK failures into stable, actionable public refusals. */
export async function rehearseSchemaMigration(options) {
    try {
        return await executeRehearsal(options);
    }
    catch (error) {
        if (error instanceof RehearsalRefusal)
            throw error;
        throw new RehearsalRefusal("unavailable", "Check tracker initialization, custom definitions, scratch permissions and lock ownership; retry the same rehearsal, or use a new scratch directory after correcting invalid input.");
    }
}
//# sourceMappingURL=rehearsal.js.map