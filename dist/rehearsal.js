/** Isolated, resumable rehearsals around the authoritative SDK migration engine. */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { PmClient, acquireLock, certifyCompleteListResult, deriveSchemaEvolutionMigrationId, isPmCliExpectedError, readHistorySnapshot, readLocatedItem, readSettingsWithMetadata, resolveItemTypeRegistry, resolveRuntimeFieldRegistry, resolveRuntimeStatusRegistry, verifyHistoryEntries, writeFileAtomic, } from "@unbrained/pm-cli/sdk";
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
    if (Object.keys(plan).some(key => !["version", "steps"].includes(key)) || plan.version !== 1 || !Array.isArray(plan.steps) || plan.steps.length < 1 || plan.steps.length > 32)
        throw new RehearsalRefusal("invalid_plan", "Provide a version 1 plan with 1 to 32 ordered core schema steps.");
    for (const step of plan.steps) {
        if (!step || typeof step !== "object" || !["rename-field", "rename-type", "remap-status"].includes(step.kind) ||
            typeof step.from !== "string" || typeof step.to !== "string" || !/^[a-zA-Z][\w-]{0,63}$/.test(step.from) ||
            !/^[a-zA-Z][\w-]{0,63}$/.test(step.to) || step.from.toLowerCase() === step.to.toLowerCase() ||
            ("type" in step && (step.kind !== "rename-field" || typeof step.type !== "string" || !/^[a-zA-Z][\w-]{0,63}$/.test(step.type))) ||
            Object.keys(step).some(key => !["kind", "from", "to", "type"].includes(key))) {
            throw new RehearsalRefusal("invalid_plan", "Use distinct schema names and a core rename-field, rename-type or remap-status operation.");
        }
    }
    return { version: 1, steps: structuredClone(plan.steps) };
}
/** Read a bounded regular plan file without accepting filesystem aliases. */
export function readRehearsalPlan(file) {
    try {
        const target = resolve(file);
        safePath(dirname(target));
        const stat = lstatSync(target);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 64 * 1024)
            throw new RehearsalRefusal("invalid_plan", "Use a regular, unlinked JSON plan file no larger than 64 KiB.");
        return parseRehearsalPlan(JSON.parse(readFileSync(target, "utf8")));
    }
    catch (error) {
        if (error instanceof RehearsalRefusal)
            throw error;
        throw new RehearsalRefusal("invalid_plan", "Provide a readable version 1 JSON plan.");
    }
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
function snapshot(root, skipDerived = true) {
    const files = new Map();
    let bytes = 0, entries = 0;
    /** Walk one tracker-relative directory without following links. */
    function walk(folder) {
        for (const name of readdirSync(join(root, folder)).sort()) {
            if (skipDerived && folder === "" && excluded.has(name))
                continue;
            const file = join(folder, name);
            if (++entries > 20000 || file.split(sep).length > 64)
                throw new RehearsalRefusal("unsafe_storage", "Reduce the tracker snapshot below 20000 entries and 64 directory levels.");
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
                if (bytes > 256 * 1024 * 1024)
                    throw new RehearsalRefusal("unsafe_storage", "Reduce the tracker snapshot below 256 MiB.");
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
        // Core's filePathForSchemaSection trims before resolving. Check that exact
        // spelling before any SDK read can scaffold or mutate a schema document.
        if (typeof file !== "string" || !file.trim() || isAbsolute(file.trim()) || !inside(root, resolve(root, file.trim())))
            throw new RehearsalRefusal("unsafe_storage", "Keep schema files inside the tracker before rehearsing.");
    }
}
/** Check supplied schema properties survive normalization; defaults may add properties. */
function preserved(raw, normalized) {
    if (Array.isArray(raw))
        return Array.isArray(normalized) && raw.length === normalized.length && raw.every(value => normalized.some(candidate => preserved(value, candidate)));
    if (raw !== null && typeof raw === "object")
        return normalized !== null && typeof normalized === "object" && Object.entries(raw).every(([key, value]) => preserved(value, normalized[key]));
    return Object.is(raw, normalized);
}
/** Refuse schema definitions silently dropped or coerced by permissive SDK normalizers. */
function assertDefinitions(root, files, settings) {
    const raw = JSON.parse(files.get("settings.json").toString());
    if (raw.version !== 1 || Object.keys(raw).some(key => !Object.hasOwn(settings, key)))
        throw new RehearsalRefusal("invalid_data", "Use supported version 1 tracker settings before rehearsing.");
    if (Object.keys(raw.schema ?? {}).some(key => !["version", "files", "fields", "statuses", "workflow", "type_workflows", "unknown_field_policy"].includes(key)) ||
        Object.keys(raw.schema?.files ?? {}).some(key => !["fields", "statuses", "types", "workflows"].includes(key)))
        throw new RehearsalRefusal("invalid_data", "Use supported schema sections and file mappings before rehearsing.");
    const sections = ["fields", "statuses", "types", "workflows"];
    for (const section of sections) {
        const file = settings.schema.files[section].trim();
        const data = files.get(relative(root, resolve(root, file)));
        if (!data)
            throw new RehearsalRefusal("invalid_data", "Persist every schema section before rehearsing; missing files cannot certify a complete schema.");
        const parsed = JSON.parse(data.toString());
        let valid;
        if (section === "workflows") {
            const statuses = resolveRuntimeStatusRegistry(settings.schema);
            /** Validate each overlay independently so valid file overrides remain supported. */
            const workflow = (value) => value !== null && typeof value === "object" && !Array.isArray(value) &&
                Object.entries(value).every(([key, status]) => Object.hasOwn(settings.schema.workflow, key) && typeof status === "string" && statuses.by_id.has(status));
            /** Require each declared type workflow to survive the SDK's merge. */
            const typeWorkflows = (value) => Array.isArray(value) && value.every((entry) => entry !== null && typeof entry === "object" &&
                preserved(entry, settings.schema.type_workflows?.find(candidate => candidate.type === entry.type)));
            valid = workflow(raw.schema?.workflow ?? {}) && typeWorkflows(raw.schema?.type_workflows ?? []) &&
                workflow(parsed.workflow ?? parsed.workflows ?? parsed) && typeWorkflows(parsed.type_workflows ?? []);
        }
        else {
            const definitions = Array.isArray(parsed) ? parsed : parsed[section === "types" ? "definitions" : section] ?? parsed.definitions ?? parsed.item_types?.definitions;
            const inline = section === "types" ? raw.item_types?.definitions : raw.schema?.[section];
            valid = Array.isArray(definitions) && [...inline ?? [], ...definitions].every((definition) => {
                if (!definition || typeof definition !== "object")
                    return false;
                const entry = definition;
                const resolved = section === "fields" ? resolveRuntimeFieldRegistry({ ...settings.schema, fields: [definition] }).by_key.get(String(entry.key)) :
                    section === "statuses" ? resolveRuntimeStatusRegistry({ ...settings.schema, statuses: [definition] }).by_id.get(String(entry.id)) :
                        resolveItemTypeRegistry({ ...settings, item_types: { definitions: [definition] } }).by_type[String(entry.name)];
                // Status aliases conventionally accept hyphens as underscores.
                const supplied = section === "statuses" && Array.isArray(entry.aliases) ? { ...entry, aliases: entry.aliases.map((alias) => typeof alias === "string" ? alias.replaceAll("-", "_") : alias) } : entry;
                return (section !== "fields" || typeof entry.type === "string") && preserved(supplied, section === "fields" && resolved ? { ...resolved, front_matter_key: resolved.metadata_key } : resolved);
            });
        }
        if (!valid)
            throw new RehearsalRefusal("invalid_data", "Repair incomplete, unsupported or lossy schema definitions before rehearsing.");
    }
    if (raw.schema?.version !== undefined && raw.schema.version !== 1)
        throw new RehearsalRefusal("invalid_data", "Use version 1 schema definitions before rehearsing.");
    const statuses = resolveRuntimeStatusRegistry(settings.schema), types = resolveItemTypeRegistry(settings);
    if (Object.values(settings.schema.workflow).some(status => !statuses.by_id.has(status)) ||
        settings.schema.type_workflows?.some(workflow => !Object.hasOwn(types.by_type, workflow.type) || workflow.allowed_transitions.some(pair => pair.some(status => !statuses.by_id.has(status)))) ||
        Object.values(types.by_type).some(type => type.default_status !== undefined && !statuses.by_id.has(type.default_status)))
        throw new RehearsalRefusal("invalid_data", "Reference declared types and statuses in workflow definitions before rehearsing.");
}
/** Verify completed checkpoints against core's durable committed migration evidence. */
function assertProgress(tracker, state, expected) {
    let affected = 0;
    for (let index = 0; index < state.completed; index++) {
        const id = `rehearsal-${state.identity.slice(0, 24)}-${index}`;
        const plan = JSON.parse(readFileSync(join(tracker, "transactions", "schema", `${id}-plan.json`), "utf8"));
        const journal = JSON.parse(readFileSync(join(tracker, "transactions", "sdk", `schema-${id}.json`), "utf8"));
        if (plan.schema_version !== 1 || plan.plan.migration_id !== id ||
            deriveSchemaEvolutionMigrationId(plan.plan.request, state.identity) !== deriveSchemaEvolutionMigrationId(expected.steps[index], state.identity) ||
            journal.transactionId !== `schema-${id}` || journal.status !== "committed" || !Array.isArray(journal.stepIds) ||
            !journal.stepIds.includes("retire-source") || !preserved(journal.stepIds, journal.completedStepIds) ||
            !Number.isSafeInteger(plan.plan.affected_item_count) || plan.plan.affected_item_count < 0)
            throw new RehearsalRefusal("invalid_data", "Restore committed core migration evidence before resuming.");
        affected += plan.plan.affected_item_count;
    }
    if (affected !== state.affected || fingerprint(snapshot(tracker)) !== state.tracker_fingerprint)
        throw new RehearsalRefusal("invalid_data", "Restore the checkpointed scratch bytes and counts, or start a new rehearsal.");
}
/** Validate every physical item with the SDK before accepting a certified corpus. */
async function inspect(root) {
    const files = snapshot(root);
    assertLocalSchema(root, files);
    const { settings, warnings } = await readSettingsWithMetadata(root);
    if (warnings.some(warning => !warning.startsWith("runtime_schema_bootstrap_created:") && warning !== "settings_item_format_legacy_json_markdown_coerced_to_toon")) {
        throw new RehearsalRefusal("invalid_data", "Repair invalid tracker settings or schema files before rehearsing; SDK fallback settings cannot certify a corpus.");
    }
    assertDefinitions(root, files, settings);
    const registry = resolveItemTypeRegistry(settings);
    if (registry.folders.some(folder => folder !== basename(folder) || excluded.has(folder) || ["history", "schema"].includes(folder)))
        throw new RehearsalRefusal("unsafe_storage", "Use flat, tracker-local item folders outside schema, history and runtime storage.");
    const diagnostics = [];
    const physical = [...files.keys()].filter(file => /\.(toon|md)$/.test(file) && !["history", "schema"].includes(file.split(sep)[0]));
    if (physical.some(file => !registry.folders.includes(dirname(file))))
        throw new RehearsalRefusal("invalid_data", "Register every physical item folder and use flat item directories before rehearsing.");
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
    for (const file of files.keys()) {
        if (!file.startsWith(`history${sep}`) || !file.endsWith(".jsonl"))
            continue;
        const history = await readHistorySnapshot(join(root, file), basename(file, ".jsonl"));
        if (!verifyHistoryEntries(history.entries).ok)
            throw new RehearsalRefusal("invalid_data", "Repair invalid history chains in a separate reviewed copy before rehearsing.");
    }
    const count = certifyCompleteListResult(await new PmClient({ pmRoot: root, noExtensions: true }).listAllComplete()).items.length;
    if (count !== physical.length)
        throw new RehearsalRefusal("invalid_data", "Repair the physical item corpus; SDK enumeration must include every item document.");
    return count;
}
/** Run actual SDK migrations exclusively on a private copy and resume stable core operation IDs. */
async function executeRehearsal(options) {
    if (![options.source, options.workDir].every(value => typeof value === "string" && value.trim().length > 0) ||
        (options.afterStep !== undefined && typeof options.afterStep !== "function"))
        throw new RehearsalRefusal("invalid_plan", "Provide nonempty source and scratch directory names and a synchronous observer when supplied.");
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
    if (resumed) {
        snapshot(work, false);
        if (!existsSync(join(work, "rehearsal.json")))
            throw new RehearsalRefusal("unavailable", "Wait for the initial rehearsal checkpoint before retrying; use a new scratch directory if initialization was interrupted.");
    }
    else
        mkdirSync(work, { mode: 0o700 });
    const release = await acquireLock(work, "rehearsal", 300, "schema-rehearsal", false, false, 0);
    try {
        const checkpointPath = join(work, "rehearsal.json"), tracker = join(work, "tracker");
        let state;
        if (resumed) {
            assertLocalSchema(tracker, snapshot(tracker));
            state = JSON.parse(readFileSync(checkpointPath, "utf8"));
            if (state.version !== 1 || state.identity !== identity || state.fingerprint !== sourceFingerprint ||
                !Number.isSafeInteger(state.completed) || state.completed < 0 || state.completed > plan.steps.length ||
                !Number.isSafeInteger(state.affected) || state.affected < 0 || !Number.isSafeInteger(state.items) || state.items < 0) {
                throw new RehearsalRefusal("source_changed", "Use the original source and plan, or choose a new rehearsal directory.");
            }
            if (await inspect(tracker) !== state.items)
                throw new RehearsalRefusal("invalid_data", "Restore the complete scratch corpus before resuming.");
            assertProgress(tracker, state, plan);
        }
        else {
            mkdirSync(tracker, { mode: 0o700 });
            for (const [file, data] of input) {
                mkdirSync(dirname(join(tracker, file)), { recursive: true });
                writeFileSync(join(tracker, file), data, { flag: "wx", mode: 0o600 });
            }
            state = { version: 1, identity, fingerprint: sourceFingerprint, completed: 0, affected: 0, items: await inspect(tracker), tracker_fingerprint: fingerprint(snapshot(tracker)) };
            await writeFileAtomic(checkpointPath, JSON.stringify(state));
        }
        const client = new PmClient({ pmRoot: tracker, noExtensions: true, author: "schema-rehearsal" });
        for (let index = state.completed; index < plan.steps.length; index++) {
            const step = plan.steps[index];
            const controls = { migrationId: `rehearsal-${identity.slice(0, 24)}-${index}`, author: "schema-rehearsal" };
            const result = step.kind === "rename-field" ? await client.schemaRenameField(step.from, step.to, controls, step.type) :
                step.kind === "rename-type" ? await client.schemaRenameType(step.from, step.to, controls) : await client.schemaRemapStatus(step.from, step.to, controls);
            state.tracker_fingerprint = fingerprint(snapshot(tracker));
            // Persist the observed core commit while keeping wrapper progress behind it.
            // An observer interruption can replay core's stable ID, but changed bytes
            // or fabricated wrapper counts must never certify a partial migration.
            await writeFileAtomic(checkpointPath, JSON.stringify(state));
            options.afterStep?.(index);
            state.completed = index + 1;
            state.affected += result.affected_item_count;
            await writeFileAtomic(checkpointPath, JSON.stringify(state));
        }
        if (await inspect(tracker) !== state.items)
            throw new RehearsalRefusal("invalid_data", "Inspect scratch item identities; the migration changed the corpus size.");
        assertProgress(tracker, state, plan);
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