// pm-ts-starter — TypeScript reference extension for pm-cli
//
// The CANONICAL teaching artifact for the pm-cli SDK authoring surface.
// Demonstrates EVERY capability type the SDK supports, each via its typed
// `define*` builder (not raw object literals), assembled through the
// declarative `composeExtension` / `composeExtensionPackage` capstone.
//
// Builders demonstrated (24 total):
//   defineCommand, defineCommandOverride, defineFlag, defineExporter,
//   defineImporter, defineItemType, defineItemField, defineMigration,
//   defineSearchProvider, defineRendererOverride, defineParserOverride,
//   definePreflightOverride, defineServiceOverride, defineVectorStoreAdapter,
//   defineProjectProfile, defineOnReadHook, defineOnWriteHook,
//   defineOnIndexHook, defineBeforeCommandHook, defineAfterCommandHook,
//   defineExtensionManifest, defineExtensionBlueprint, composeExtension,
//   composeExtensionPackage
//
// Capabilities covered (all 9): commands, renderers, hooks, schema,
// importers, search, parser, preflight, services.
//
// This is a PACKAGE-BACKED extension: it declares @unbrained/pm-cli as a
// peer dependency and imports the SDK's runtime helpers (the `define*`
// builders and `composeExtension`) as real runtime values. When installed
// via `pm install`, the host CLI satisfies that import — no nested copy of
// the CLI is downloaded. The `define*` builders are zero-cost identity
// functions: they return their argument unchanged, so the runtime behavior
// is identical to hand-written object literals, but TypeScript contract-
// checks every definition at the authoring site.
// ---------------------------------------------------------------------------
// SDK imports — runtime values (builders) + type-only imports (contracts)
// ---------------------------------------------------------------------------
import { 
// Object-definition builders (generic, preserve literal types)
defineCommand, defineFlag, defineItemType, defineItemField, defineMigration, defineSearchProvider, defineVectorStoreAdapter, defineProjectProfile, defineExtensionManifest, defineExtensionBlueprint, 
// Function-definition builders (non-generic, contextually type the param)
defineCommandOverride, defineImporter, defineExporter, defineRendererOverride, defineParserOverride, definePreflightOverride, defineServiceOverride, declineServiceOverride, defineBeforeCommandHook, defineAfterCommandHook, defineOnWriteHook, defineOnReadHook, defineOnIndexHook, 
// Declarative assembly capstone
composeExtension, composeExtensionPackage, mergeExtensionBlueprints, deriveExtensionCapabilities, } from "@unbrained/pm-cli/sdk/authoring";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as readline from "node:readline/promises";
// ---------------------------------------------------------------------------
// Root-file resolution — manifest.json and package.json both live at the
// repository root. When this module is compiled into dist/ they sit one
// directory up (../<file>); when it runs as a source .ts from the repository
// root they sit in the module's own directory (./<file>). Try the parent first
// (the published artifact's location) and fall back to the current directory
// so the version and SDK-target reads resolve identically either way.
// ---------------------------------------------------------------------------
/**
 * Reads a JSON file that sits at the package root, from either module layout.
 *
 * Same directory first, then the parent. Published, this module sits in `dist/`
 * and the file is one level up, so the same-directory candidate simply misses
 * there and the parent still wins — `dist/` contains neither `package.json` nor
 * `manifest.json`. Run as source from the package root, the same-directory
 * candidate is the correct one, and trying the parent first would read whatever
 * package happens to enclose the checkout.
 *
 * Only a *missing* same-directory file advances to the parent. If that file
 * exists but is unreadable or malformed, falling through would answer the
 * question with a different package's data and report nothing wrong — the same
 * silent-wrong-package failure the candidate order exists to prevent, reached
 * by a different route.
 *
 * @param fileName - Bare file name to look for, e.g. `package.json`.
 * @param base - Directory to resolve from. Defaults to this module's own
 *   directory; tests pass an explicit base to exercise both layouts.
 * @returns The parsed JSON, or `undefined` when no candidate yields usable data.
 */
export function readRootJson(fileName, base = dirname(fileURLToPath(import.meta.url))) {
    const candidates = [join(base, fileName), join(base, "..", fileName)];
    for (const [index, candidate] of candidates.entries()) {
        try {
            return JSON.parse(readFileSync(candidate, "utf-8"));
        }
        catch (error) {
            const missing = error.code === "ENOENT";
            if (index === 0 && !missing)
                return undefined;
        }
    }
    return undefined;
}
// ---------------------------------------------------------------------------
// Version resolution — read from manifest.json so the Daily Release workflow's
// auto-bump is reflected without a source literal that silently drifts.
// ---------------------------------------------------------------------------
/**
 * Resolves the extension version from a parsed `manifest.json` value.
 *
 * Falls back to `"0.0.0"` when the manifest is missing or its `version` field
 * is not a string, so a corrupt or partial manifest never crashes the host —
 * the extension loads with a sentinel that surfaces in `ts-starter info`.
 *
 * @param manifest - The parsed contents of `manifest.json` (or `undefined`).
 * @returns The version string, or `"0.0.0"` as a fallback.
 */
export function resolveVersion(manifest) {
    return typeof manifest?.version === "string"
        ? manifest.version
        : "0.0.0";
}
const VERSION = resolveVersion(readRootJson("manifest.json"));
/**
 * The pm-cli SDK release this reference is written against, reported by
 * `ts-starter info` and `ts-starter setup`.
 *
 * Derived from the declared `@unbrained/pm-cli` peer-dependency range rather
 * than a source literal, for the same reason {@link VERSION} reads
 * `manifest.json`: a hardcoded target silently drifts. This one had already
 * drifted 20 releases (`2026.7.6`) behind the declared peer range, so both
 * commands misreported the SDK contract this extension actually demonstrates.
 */
/**
 * Resolves the pm-cli SDK target from a parsed `package.json` value.
 *
 * Reads the `@unbrained/pm-cli` peer-dependency range and strips the leading
 * comparator (`>=`, `^`, etc.) so the bare version is what `ts-starter info`
 * reports. Falls back to `"unknown"` when the range is missing or not a string.
 *
 * @param pkg - The parsed contents of `package.json` (or `undefined`).
 * @returns The SDK target version, or `"unknown"` as a fallback.
 */
export function resolveSdkTarget(pkg) {
    const range = pkg?.peerDependencies?.["@unbrained/pm-cli"];
    return typeof range === "string" ? range.replace(/^[^0-9]*/, "") : "unknown";
}
const SDK_TARGET = resolveSdkTarget(readRootJson("package.json"));
/**
 * Whether verbose activation logging is on.
 *
 * Re-read from the environment at each call rather than captured once at module
 * load, so a test (or a hot-reload) can toggle the flag without restarting the
 * process. Every hook and override that logs conditionally calls this instead
 * of reading a frozen constant.
 */
function isVerboseLogging() {
    return !!process.env.PM_TS_STARTER_VERBOSE;
}
// ---------------------------------------------------------------------------
// Expected-error helper — build a PmCliExpectedError-shaped error without a
// runtime import of the full CLI error class. The CLI's top-level handler
// recognises expected errors by `name === "PmCliError"` (not `instanceof`),
// so a locally constructed error with that name, an `exitCode`, and a
// secret-free `context` is treated exactly like one thrown by the CLI itself.
// ---------------------------------------------------------------------------
const PM_CLI_EXPECTED_ERROR_NAME = "PmCliError";
const DEFAULT_USAGE_EXIT_CODE = 2;
/**
 * Construct a {@link PmCliExpectedError}-shaped error without importing the
 * CLI's runtime class.
 *
 * The CLI's top-level handler matches expected errors by `name === "PmCliError"`
 * rather than `instanceof`, so a locally built Error with that name is treated
 * like one the CLI itself threw. The exit code falls back to
 * {@link DEFAULT_USAGE_EXIT_CODE} when the caller omits it or passes a value
 * that is not a positive finite number, so a malformed option can never select
 * exit code 0. The loose `context` input is reshaped into a structured recovery
 * record (promoting the first present command/feature name, folding a bare
 * `hint` into `nextSteps`), and `cause` is attached non-enumerably so it does
 * not leak into serialized error output.
 *
 * @param message - Human-readable summary shown to the operator.
 * @param options - Optional exit code, recovery context, and cause.
 * @returns An Error carrying the expected-error name, exit code, and context.
 */
function pmExpectedError(message, options) {
    const exitCode = options?.exitCode && Number.isFinite(options.exitCode) && options.exitCode > 0
        ? options.exitCode
        : DEFAULT_USAGE_EXIT_CODE;
    const raw = (options?.context ?? {});
    const recovery = raw.attempted_command || raw.feature || raw.command
        ? {
            attempted_command: raw.attempted_command ?? raw.feature ?? raw.command,
            suggested_retry: raw.suggested_retry,
        }
        : undefined;
    const context = {
        code: raw.code ?? raw.feature ?? raw.command,
        why: raw.why,
        examples: raw.examples,
        nextSteps: raw.nextSteps ?? (raw.hint ? [String(raw.hint)] : undefined),
        recovery,
    };
    const cause = options?.cause;
    const err = new Error(message);
    err.name = PM_CLI_EXPECTED_ERROR_NAME;
    err.exitCode = exitCode;
    err.context = context;
    if (cause !== undefined) {
        Object.defineProperty(err, "cause", { value: cause, enumerable: false });
    }
    return err;
}
/**
 * Type guard identifying an error the CLI treats as expected.
 *
 * Matches on the `name` tag rather than `instanceof`, mirroring exactly how the
 * CLI's own handler recognizes these errors, so a locally constructed error is
 * indistinguishable from one thrown inside the CLI. The `instanceof Error`
 * precondition keeps a plain object that merely sets `name` from narrowing the
 * type.
 *
 * @param error - Any caught value, typically from a `try`/`catch` boundary.
 * @returns True when `error` is an Error whose name is the expected-error tag.
 */
function isPmCliExpectedError(error) {
    return (error instanceof Error &&
        error.name === PM_CLI_EXPECTED_ERROR_NAME);
}
function pmJsonMaxBuffer() {
    const raw = Number(process.env.PM_JSON_MAX_BUFFER);
    return Number.isSafeInteger(raw) && raw > 0 ? raw : 64 * 1024 * 1024;
}
/**
 * Render a pm spawn read error as an actionable operator message.
 *
 * Distinguishes the one errno the buffer cap can produce (`ENOBUFS`) from every
 * other failure, because only that case has a remedy the operator can apply
 * (raise `PM_JSON_MAX_BUFFER`); the rest are surfaced verbatim so the original
 * message is not buried behind a generic label.
 *
 * @param error - The `error` field Node attached to a failed `spawnSync`.
 * @param limitBytes - The maxBuffer in force when the read failed, echoed back
 *   so the operator knows the value to raise.
 * @returns A single-line message naming the cause and, for `ENOBUFS`, the fix.
 */
function describePmReadFailure(error, limitBytes) {
    const code = error.code;
    if (code === "ENOBUFS") {
        return `pm output exceeded the ${limitBytes} byte read buffer. `
            + "Raise PM_JSON_MAX_BUFFER (in bytes) to increase the read limit for this workspace.";
    }
    return `pm read failed: ${error.message}`;
}
/**
 * Run the live `pm` binary against a workspace and capture its result.
 *
 * Spawns `pm --path <pmRoot> <args>` synchronously with a JSON-sized read buffer
 * (see {@link pmJsonMaxBuffer}), then normalizes the outcome into the
 * {@link PmRunResult} shape every caller shares. `ok` is true only when the
 * process exited zero AND Node reported no spawn error, so a crash and a clean
 * failure are both reported as not-ok. `stderr` falls back to a translated
 * read-failure message when the spawn itself errored before producing output,
 * so the field is never empty on a failure.
 *
 * @param pmRoot - Workspace root forwarded to pm as `--path`.
 * @param args - Additional pm arguments after the path flag.
 * @returns The captured exit status, streams, and derived `ok` flag.
 */
export function runPm(pmRoot, args) {
    const maxBuffer = pmJsonMaxBuffer();
    const result = spawnSync("pm", ["--path", pmRoot, ...args], {
        encoding: "utf-8",
        maxBuffer,
    });
    const stderr = (result.stderr ?? "").trim()
        || (result.error ? describePmReadFailure(result.error, maxBuffer) : "");
    return {
        ok: result.status === 0 && !result.error,
        stdout: result.stdout ?? "",
        stderr,
        status: result.status,
    };
}
/**
 * Run pm expecting JSON on stdout, throwing an expected error otherwise.
 *
 * Wraps {@link runPm}: a non-zero exit (or spawn error) becomes a
 * {@link pmExpectedError} whose message names the feature and the failing exit
 * status, and stdout that does not parse as JSON becomes one quoting the output
 * head. On success the parsed value is returned unchecked, so the caller is
 * responsible for validating the shape against its expectation of `T`.
 *
 * @param pmRoot - Workspace root forwarded to pm as `--path`.
 * @param args - pm arguments that select the JSON-producing command.
 * @param feature - Short label interpolated into failure messages for context.
 * @returns The parsed JSON value; its runtime shape is not validated here.
 * @throws {PmCliExpectedError} When pm exits non-zero or returns non-JSON.
 */
function pmJson(pmRoot, args, feature) {
    const run = runPm(pmRoot, args);
    if (!run.ok) {
        const detail = run.stderr.trim();
        throw pmExpectedError(`pm-ts-starter: \`${feature}\` demo failed (pm exited ${run.status})${detail ? `: ${detail}` : "."}`, {
            exitCode: 1,
            context: { feature, attempted_command: "pm", why: detail || undefined },
            cause: run.stderr ? new Error(run.stderr) : undefined,
        });
    }
    try {
        return JSON.parse(run.stdout);
    }
    catch (cause) {
        throw pmExpectedError(`pm-ts-starter: \`${feature}\` demo returned non-JSON output from pm.`, { exitCode: 1, context: { feature, why: `stdout head: ${run.stdout.slice(0, 200)}` }, cause });
    }
}
// ===========================================================================
// 1. COMMANDS — defineCommand (capability: "commands")
// ===========================================================================
const helloCommand = defineCommand({
    name: "hello",
    description: "Say hello from the TypeScript starter extension.",
    intent: "demonstrate a simple command",
    examples: ["pm hello", "pm hello --name World", "pm hello World --loud"],
    failure_hints: [
        "Use --name <value> to set the greeting name.",
        "--loud uppercases the greeting; it takes no value.",
    ],
    arguments: [
        { name: "name", description: "Positional name to greet (overridden by --name)." },
    ],
    flags: [
        { long: "--name", value_name: "name", value_type: "string", description: "Name to greet (default: pm-cli)" },
        { long: "--loud", value_type: "boolean", description: "Uppercase the greeting" },
    ],
    async run(ctx) {
        const rawName = ctx.options["name"] ??
            (Array.isArray(ctx.args) && ctx.args.length > 0 ? String(ctx.args[0]) : undefined);
        const name = (rawName ?? "pm-cli").trim();
        if (!name) {
            throw pmExpectedError("pm-ts-starter: --name must not be empty.", {
                context: { command: "hello", why: "A non-empty name is required to greet." },
            });
        }
        const loud = Boolean(ctx.options["loud"]);
        const greeting = loud ? `HELLO, ${name.toUpperCase()}!` : `Hello, ${name}!`;
        console.error(greeting);
        return { greeting };
    },
});
const infoCommand = defineCommand({
    name: "ts-starter info",
    description: "Show TypeScript starter extension info and registered capabilities.",
    intent: "show extension metadata",
    examples: ["pm ts-starter info"],
    failure_hints: [
        "This command only reads extension metadata; it has no side effects.",
        "If it errors, the extension failed to activate — check `pm extension doctor`.",
    ],
    arguments: [],
    flags: [],
    async run() {
        const info = {
            name: "pm-ts-starter",
            version: VERSION,
            sdk_target: SDK_TARGET,
            capabilities: derivedCapabilities,
        };
        console.error(JSON.stringify(info, null, 2));
        return info;
    },
});
const planDemoCommand = defineCommand({
    name: "ts-starter plan-demo",
    description: "Demonstrate integration with the pm plan workflow (shells out to `pm plan show`).",
    intent: "show how an extension can read plan workflow state",
    examples: ["pm ts-starter plan-demo", "pm ts-starter plan-demo --id my-plan --depth standard"],
    failure_hints: [
        "Requires a pm workspace with a plan item; create one with `pm plan create`.",
        "Pass --id <plan-id> to select a plan other than the active one.",
        "--depth is one of: brief | standard | deep.",
    ],
    arguments: [
        { name: "id", required: false, description: "Plan item id to show (optional; defaults to active)." },
    ],
    flags: [
        { long: "--id", value_name: "id", value_type: "string", description: "Plan item id to show." },
        { long: "--depth", value_name: "depth", value_type: "string", description: "Show depth: brief|standard|deep (default: standard)." },
    ],
    async run(ctx) {
        const pmRoot = ctx.pm_root ?? ".";
        const id = ctx.options["id"] ??
            (Array.isArray(ctx.args) && ctx.args.length > 0 ? String(ctx.args[0]) : undefined);
        const depth = ctx.options["depth"] ?? "standard";
        const args = ["plan", "show"];
        if (id)
            args.push(id);
        args.push("--depth", depth, "--json");
        return pmJson(pmRoot, args, "plan");
    },
});
const contextDemoCommand = defineCommand({
    name: "ts-starter context-demo",
    description: "Demonstrate integration with pm context (shells out to `pm context`).",
    intent: "show how an extension can surface the current work context",
    examples: ["pm ts-starter context-demo", "pm ts-starter context-demo --format json --depth brief"],
    failure_hints: [
        "Requires a pm workspace; run inside a directory with `.agents/pm`.",
        "--format is one of: markdown | toon | json (default: json).",
        "--depth is one of: brief | standard | deep.",
    ],
    arguments: [],
    flags: [
        { long: "--format", value_name: "format", value_type: "string", description: "Output format: markdown|toon|json (default: json)." },
        { long: "--depth", value_name: "depth", value_type: "string", description: "Context depth: brief|standard|deep." },
    ],
    async run(ctx) {
        const pmRoot = ctx.pm_root ?? ".";
        const format = ctx.options["format"] ?? "json";
        const depth = ctx.options["depth"];
        const args = ["context", "--format", format];
        if (depth)
            args.push("--depth", depth);
        if (format === "json") {
            args.push("--json");
            return pmJson(pmRoot, args, "context");
        }
        const run = runPm(pmRoot, args);
        if (!run.ok) {
            throw pmExpectedError(`pm-ts-starter: \`${format}\` context demo failed (pm exited ${run.status}).`, { exitCode: 1, context: { feature: "context", why: run.stderr.trim() || undefined } });
        }
        return { format, context: run.stdout };
    },
});
const searchDemoCommand = defineCommand({
    name: "ts-starter search-demo",
    description: "Demonstrate integration with pm search (shells out to `pm search`).",
    intent: "show how an extension can run a workspace search",
    examples: ["pm ts-starter search-demo --query release", "pm ts-starter search-demo release --limit 10"],
    failure_hints: [
        "Pass a --query <text> (or a positional argument) with at least one term.",
        "--limit caps the number of hits (default: 10).",
        "Use `pm reindex` first if search returns nothing after a fresh import.",
    ],
    arguments: [
        { name: "query", required: false, variadic: false, description: "Search query (overridden by --query)." },
    ],
    flags: [
        { long: "--query", value_name: "query", value_type: "string", description: "Search query text." },
        { long: "--limit", value_name: "n", value_type: "number", description: "Maximum hits to return (default: 10)." },
    ],
    async run(ctx) {
        const pmRoot = ctx.pm_root ?? ".";
        const rawQuery = ctx.options["query"] ??
            (Array.isArray(ctx.args) && ctx.args.length > 0 ? String(ctx.args[0]) : undefined);
        const query = (rawQuery ?? "").trim();
        if (!query) {
            throw pmExpectedError("pm-ts-starter: search-demo requires a --query (or positional query) argument.", { context: { command: "ts-starter search-demo", why: "Pass --query <text> or a positional query." } });
        }
        const limit = String(ctx.options["limit"] ?? 10);
        return pmJson(pmRoot, ["search", query, "--limit", limit, "--json"], "search");
    },
});
const historyCompactDemoCommand = defineCommand({
    name: "ts-starter history-compact-demo",
    description: "Demonstrate integration with pm history-compact (dry-run only; shells out to `pm history-compact`).",
    intent: "show how an extension can preview history compaction safely",
    examples: ["pm ts-starter history-compact-demo --id my-task", "pm ts-starter history-compact-demo my-task"],
    failure_hints: [
        "Pass --id <item-id> (or a positional id) to select the item whose history to compact.",
        "This demo always runs with --dry-run; it never mutates history.",
        "If pm is not on PATH, the command exits 1 with a clear message.",
    ],
    arguments: [
        { name: "id", required: false, description: "Item id whose history to preview-compact (required unless --id is used)." },
    ],
    flags: [
        { long: "--id", value_name: "id", value_type: "string", description: "Item id to compact (overrides a positional id)." },
    ],
    async run(ctx) {
        const pmRoot = ctx.pm_root ?? ".";
        const rawId = ctx.options["id"] ??
            (Array.isArray(ctx.args) && ctx.args.length > 0 ? String(ctx.args[0]) : undefined);
        const id = (rawId ?? "").trim();
        if (!id) {
            throw pmExpectedError("pm-ts-starter: history-compact-demo requires an --id (or positional id) argument.", { context: { command: "ts-starter history-compact-demo", why: "Pass --id <item-id> or a positional id." } });
        }
        return pmJson(pmRoot, ["history-compact", id, "--dry-run", "--json"], "history-compact");
    },
});
const setupCommand = defineCommand({
    name: "ts-starter setup",
    description: "Guided first-run setup for the TypeScript starter extension.",
    intent: "onboard a new extension author",
    examples: ["pm ts-starter setup", "pm ts-starter setup --interactive"],
    failure_hints: [
        "--interactive enables prompted input; without it the command prints a summary only.",
        "Interactive mode is skipped automatically when stdin is not a TTY.",
    ],
    arguments: [],
    flags: [
        { long: "--interactive", value_type: "boolean", description: "Run an interactive guided setup wizard." },
    ],
    async run(ctx) {
        const interactive = Boolean(ctx.options["interactive"]);
        const isTty = typeof process.stdin?.isTTY === "boolean" ? process.stdin.isTTY : false;
        const runInteractive = interactive && isTty;
        const summary = {
            extension: "pm-ts-starter",
            version: VERSION,
            sdk_target: SDK_TARGET,
            capabilities: derivedCapabilities,
            verbose_env: "PM_TS_STARTER_VERBOSE=1",
            interactive_requested: interactive,
            interactive_run: runInteractive,
        };
        if (runInteractive) {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            try {
                const name = (await rl.question("Extension name [pm-ts-starter]: ")).trim() || "pm-ts-starter";
                const wantVerbose = /^y/i.test((await rl.question("Enable verbose logging? [y/N]: ")).trim());
                console.error(`\n[ts-starter] Guided setup complete for "${name}".`);
                if (wantVerbose)
                    console.error("[ts-starter] Set PM_TS_STARTER_VERBOSE=1 to see activation logs.");
                console.error("[ts-starter] Next: edit index.ts to keep only the capabilities you need, then `npm run build`.");
            }
            finally {
                rl.close();
            }
        }
        else {
            console.error(JSON.stringify(summary, null, 2));
            if (interactive && !isTty) {
                console.error("[ts-starter] stdin is not a TTY; interactive mode skipped. Re-run in a terminal.");
            }
        }
        return summary;
    },
});
// ===========================================================================
// 1b. COMMAND OVERRIDE — defineCommandOverride (capability: "commands")
// ===========================================================================
// A command override receives the original command's result and can modify
// it. This pass-through returns the result unchanged, demonstrating the
// wiring without altering behavior. Command overrides are a single-winner
// surface — only one extension can override a given command path.
const listCommandOverride = defineCommandOverride((ctx) => {
    if (isVerboseLogging())
        console.error(`[ts-starter] command override for: ${ctx.command}`);
    return ctx.result;
});
// ===========================================================================
// 1c. FLAGS — defineFlag (capability: "schema" — flag metadata is schema-governed)
// ===========================================================================
const listFlags = [
    defineFlag({
        long: "--ts-starter-tag",
        value_name: "tag",
        value_type: "string",
        description: "DEMO flag added by pm-ts-starter (inert; illustrates registerFlags).",
    }),
];
// ===========================================================================
// 2. SCHEMA — defineItemField, defineItemType, defineMigration (capability: "schema")
// ===========================================================================
const refField = defineItemField({
    name: "ts_starter_ref",
    type: "string",
    optional: true,
});
const spikeType = defineItemType({
    name: "Spike",
    aliases: ["spike"],
});
const noopMigration = defineMigration({
    id: "ts-starter-noop",
    description: "Demo migration (no-op).",
    run() {
        // A real migration would transform items here.
    },
});
// ===========================================================================
// 2b. PROJECT PROFILE — defineProjectProfile (capability: "schema")
// ===========================================================================
// A project profile bundles item types, statuses, fields, workflows, config
// knobs, create templates, and package recommendations into one declarative
// archetype that `pm profile apply` stages idempotently. This demo profile
// is a minimal but complete example an author can copy and extend.
const demoProfile = defineProjectProfile({
    // Profile names are folded to lowercase with hyphens as underscores during
    // resolution, so declare the canonical form directly — `lintProjectProfile`
    // warns (profile_name_not_normalized) on anything that would be rewritten.
    name: "ts_starter_demo",
    title: "TS Starter Demo Profile",
    summary: "A minimal demonstration profile with one custom type, one status, one field, and one template.",
    types: [
        { name: "Spike", description: "A time-boxed research or exploration task.", folder: "spikes", aliases: ["spike"] },
    ],
    statuses: [
        // `roles` are drawn from a fixed set (draft, active, blocked, terminal,
        // terminal_done, terminal_canceled, default_open, default_close,
        // default_cancel) — an unrecognized role is an error-severity lint finding,
        // and the rejected status then makes every workflow referencing it
        // unreachable. A spike with findings recorded is finished, so it is a
        // terminal state that counts as done.
        { id: "explored", description: "Spike has been explored and findings recorded.", roles: ["terminal", "terminal_done"] },
    ],
    fields: [
        { key: "ts_starter_ref", type: "string", description: "Cross-reference marker for the TS starter demo." },
    ],
    workflows: [
        { type: "Spike", allowed_transitions: [["open", "explored"]] },
    ],
    config: [
        { key: "search_provider", value: "bm25", summary: "Use the built-in BM25 keyword search provider." },
    ],
    templates: [
        { name: "spike", options: { type: "Spike", title: "Investigate ..." } },
    ],
    packages: [
        { spec: "npm:@unbrained/pm-todos", reason: "Provides a todo import/export package compatible with this profile." },
    ],
});
// ===========================================================================
// 3. HOOKS — all five lifecycle hooks (capability: "hooks")
// ===========================================================================
const beforeCommandHook = defineBeforeCommandHook((ctx) => {
    if (isVerboseLogging())
        console.error(`[ts-starter] beforeCommand: ${ctx.command}`);
});
const afterCommandHook = defineAfterCommandHook((ctx) => {
    if (isVerboseLogging()) {
        console.error(`[ts-starter] afterCommand: ${ctx.command} (ok=${ctx.ok})`);
        // `ctx.error` is the runtime's error *message string* (not an Error
        // object), so a truthiness check is the correct guard — the earlier
        // `isPmCliExpectedError(ctx.error)` could never return true on a string
        // and left this branch permanently unreachable.
        if (ctx.ok === false && ctx.error) {
            console.error(`[ts-starter] hint: ${ctx.error}`);
        }
    }
});
const onWriteHook = defineOnWriteHook((ctx) => {
    if (isVerboseLogging())
        console.error(`[ts-starter] onWrite: ${ctx?.op ?? ""} ${ctx?.path ?? ""}`.trimEnd());
});
const onReadHook = defineOnReadHook((ctx) => {
    if (isVerboseLogging())
        console.error(`[ts-starter] onRead: ${ctx?.path ?? "(item)"}`);
});
const onIndexHook = defineOnIndexHook((ctx) => {
    if (isVerboseLogging())
        console.error(`[ts-starter] onIndex: mode=${ctx.mode} total_items=${ctx.total_items ?? "(unreported)"}`);
});
// ===========================================================================
// 4. IMPORTERS / EXPORTERS — defineImporter, defineExporter (capability: "importers")
// ===========================================================================
const demoImporter = defineImporter(async (ctx) => {
    if (isVerboseLogging())
        console.error("[ts-starter] Demo importer invoked:", JSON.stringify(ctx.options));
    return { imported: 0 };
});
const demoExporter = defineExporter(async (ctx) => {
    if (isVerboseLogging())
        console.error("[ts-starter] Demo exporter invoked:", JSON.stringify(ctx.options));
    return { ts_starter: true, exported: 0 };
});
// ===========================================================================
// 5. RENDERERS — defineRendererOverride (capability: "renderers")
// ===========================================================================
/**
 * Command paths whose `--json` output this extension's renderer owns.
 *
 * Ownership is what keeps a renderer override a good citizen in a workspace
 * that has several extensions installed: the host refuses to invoke the
 * callback for a command outside this list, and its collision check suppresses
 * a warning only when two renderers for the same format declare non-empty,
 * statically disjoint command sets. An override registered without it is
 * treated as claiming every command, which both warns forever and puts all
 * `--json` output one bug away from corruption.
 *
 * This is exactly one command because exactly one handler emits a payload the
 * renderer reshapes: {@link demoExporter} returns `{ ts_starter: true, ... }`.
 * Every other surface here returns something else — {@link demoImporter}
 * returns `{ imported: 0 }`, and {@link listCommandOverride} passes
 * `ctx.result` through untouched — so claiming their command paths would assert
 * an ownership this extension does not actually exercise. Scope a renderer to
 * the commands whose results it truly produces, not to the whole namespace it
 * happens to register under.
 */
const RENDERER_OWNED_COMMANDS = ["ts-starter-demo export"];
/**
 * Narrows a rendered result to this extension's own payload shape.
 *
 * Serves double duty: the host evaluates it as the renderer's
 * `resultDiscriminator` before invoking the callback, and the callback reuses
 * it so the spread below is type-safe without a cast.
 */
const isTsStarterResult = (result) => typeof result === "object" && result !== null && "ts_starter" in result;
const jsonRenderer = defineRendererOverride({
    commands: RENDERER_OWNED_COMMANDS,
    resultDiscriminator: isTsStarterResult,
    run: (ctx) => {
        // The host evaluates resultDiscriminator before calling this, so the guard
        // is defence in depth rather than the primary filter: it keeps the callback
        // correct if it is ever invoked directly, and it narrows the type so the
        // spread below needs no cast.
        const result = ctx.result;
        return isTsStarterResult(result)
            ? JSON.stringify({ rendered_by: "pm-ts-starter", ...result }, null, 2)
            : null;
    },
});
// ===========================================================================
// 6. SEARCH — defineSearchProvider, defineVectorStoreAdapter (capability: "search")
// ===========================================================================
const prefixSearchProvider = defineSearchProvider({
    name: "ts-starter-prefix",
    query(ctx) {
        const query = ctx.query ?? "";
        const hits = ctx.documents.flatMap((document) => document.metadata.id.startsWith(query)
            ? [{ id: document.metadata.id, score: 1, matched_fields: ["id"] }]
            : []);
        return { hits };
    },
});
/**
 * In-memory vector index backing {@link memoryVectorStoreAdapter}, keyed by
 * point id. A real adapter would delegate to Qdrant/LanceDB/pgvector here; the
 * storage medium is the only part that differs from a production adapter.
 */
const store = new Map();
/**
 * Cosine-free dot-product similarity between two equal-length vectors.
 *
 * Missing components are treated as zero so a query vector of a different
 * dimensionality than a stored point degrades to a partial score rather than
 * throwing — the host does not guarantee that every registered adapter and
 * every embedder agree on dimensionality.
 */
const dotProduct = (left, right) => left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
// The host owns embedding: it hands `upsert` points that ALREADY carry their
// `vector`, and hands `query` a pre-embedded `vector` — never raw text. An
// adapter that reads `ctx.text`/`ctx.query` compiles (both contexts carry an
// `[key: string]: unknown` index signature) but silently stores and matches
// nothing against the real host. Read only the contract fields.
const memoryVectorStoreAdapter = defineVectorStoreAdapter({
    name: "ts-starter-memory",
    async upsert(ctx) {
        for (const point of ctx.points) {
            store.set(point.id, { vector: point.vector, payload: point.payload });
        }
        return { upserted: ctx.points.length };
    },
    async query(ctx) {
        return [...store.entries()]
            .map(([id, entry]) => ({ id, score: dotProduct(entry.vector, ctx.vector), payload: entry.payload }))
            .sort((left, right) => right.score - left.score)
            .slice(0, ctx.limit);
    },
    async delete(ctx) {
        const deleted = ctx.ids.filter((id) => store.delete(id)).length;
        return { deleted };
    },
});
// ===========================================================================
// 7. PARSER — defineParserOverride (capability: "parser")
// ===========================================================================
const listParserOverride = defineParserOverride(() => {
    return {};
});
// ===========================================================================
// 8. PREFLIGHT — definePreflightOverride (capability: "preflight")
// ===========================================================================
const preflightOverride = definePreflightOverride(async (ctx) => {
    if (isVerboseLogging())
        console.error(`[ts-starter] Preflight check for workspace: ${ctx.pm_root ?? "unknown"}`);
    return {
        enforce_item_format_gate: ctx.decision?.enforce_item_format_gate ?? true,
        run_preflight_item_format_sync: ctx.decision?.run_preflight_item_format_sync ?? false,
        run_extension_migrations: ctx.decision?.run_extension_migrations ?? true,
        enforce_mandatory_migration_gate: ctx.decision?.enforce_mandatory_migration_gate ?? false,
    };
});
// ===========================================================================
// 9. SERVICES — defineServiceOverride (capability: "services")
// ===========================================================================
// For the `output_format` service, `ctx.payload` is the host's INTERNAL output
// envelope — the `{ global, format, options, result }` record the CLI assembles
// before printing — NOT the command's result in isolation. Whatever an override
// CLAIMS here REPLACES the entirety of the printed output, verbatim, so a
// pass-through that claims the envelope prints the envelope itself: every `pm`
// command in the workspace renders as `global` / `format` / `options` /
// `result`, with the real payload buried under `.result`. That is the bug this
// package once shipped (unbraind/pm-cli#794).
//
// Claiming and declining are now both EXPLICIT, which is why this reads as a
// one-liner rather than a lecture about reference identity:
//
//   declineServiceOverride()      -> `{ handled: false }`, host formats natively
//   handleServiceOverride(result) -> `{ handled: true, result }`, we own the output
//
// The older protocol inferred the same decision from reference identity —
// returning `ctx.payload` unchanged declined, returning a copy claimed
// (unbraind/pm-cli#741). The host still honours that for compatibility, but it
// now emits `extension_output_format_payload_echo_deprecated` when it does, and
// a rule that turns `{ ...payload }` into a workspace-wide outage is a bad rule
// to keep depending on. A reference demonstration that contributes nothing to
// formatting declines, and now says so.
const outputFormatServiceOverride = defineServiceOverride(() => declineServiceOverride());
// ===========================================================================
// BLUEPRINT ASSEMBLY — defineExtensionBlueprint + mergeExtensionBlueprints
// ===========================================================================
// Each surface is authored as a modular blueprint fragment, typed at its
// definition site by defineExtensionBlueprint. mergeExtensionBlueprints
// combines them into one blueprint for composeExtension.
const commandsBlueprint = defineExtensionBlueprint({
    commands: [
        helloCommand,
        infoCommand,
        planDemoCommand,
        contextDemoCommand,
        searchDemoCommand,
        historyCompactDemoCommand,
        setupCommand,
    ],
    commandOverrides: { list: listCommandOverride },
    flags: { list: listFlags },
});
const schemaBlueprint = defineExtensionBlueprint({
    itemTypes: [spikeType],
    itemFields: [refField],
    migrations: [noopMigration],
    profiles: [demoProfile],
});
const hooksBlueprint = defineExtensionBlueprint({
    hooks: {
        beforeCommand: [beforeCommandHook],
        afterCommand: [afterCommandHook],
        onWrite: [onWriteHook],
        onRead: [onReadHook],
        onIndex: [onIndexHook],
    },
});
const importExportBlueprint = defineExtensionBlueprint({
    importers: [
        {
            name: "ts-starter-demo",
            importer: demoImporter,
            options: {
                description: "Demo importer for the TypeScript starter extension.",
                intent: "import demo data into a pm workspace",
                examples: ["pm ts-starter-demo import", "pm ts-starter-demo import --source file.json"],
                failure_hints: [
                    "The demo importer is a no-op; wire real parsing into the handler.",
                    "Pass --source <path> to point at an import file.",
                ],
                arguments: [{ name: "source", required: false, description: "Path to import source." }],
                flags: [
                    { long: "--source", value_name: "path", value_type: "string", description: "Import source path." },
                ],
            },
        },
    ],
    exporters: [
        {
            name: "ts-starter-demo",
            exporter: demoExporter,
            options: {
                description: "Demo exporter for the TypeScript starter extension.",
                intent: "export demo data from a pm workspace",
                examples: ["pm ts-starter-demo export", "pm ts-starter-demo export --format json"],
                failure_hints: [
                    "The demo exporter is a no-op; wire real serialization into the handler.",
                    "--format selects the export shape (default: json).",
                ],
                flags: [
                    { long: "--format", value_name: "format", value_type: "string", description: "Export format (default: json)." },
                ],
            },
        },
    ],
});
const renderingBlueprint = defineExtensionBlueprint({
    renderers: { json: jsonRenderer },
});
const searchBlueprint = defineExtensionBlueprint({
    searchProviders: [prefixSearchProvider],
    vectorStoreAdapters: [memoryVectorStoreAdapter],
});
const overridesBlueprint = defineExtensionBlueprint({
    parsers: { list: listParserOverride },
    preflights: [preflightOverride],
    services: { output_format: outputFormatServiceOverride },
});
// Merge all fragments into the complete blueprint.
const blueprint = mergeExtensionBlueprints(commandsBlueprint, schemaBlueprint, hooksBlueprint, importExportBlueprint, renderingBlueprint, searchBlueprint, overridesBlueprint);
// ===========================================================================
// CAPABILITY DERIVATION + MANIFEST TYPING
// ===========================================================================
// deriveExtensionCapabilities computes the exact least-privilege capability
// set the blueprint exercises. This is the author-time inverse of the runtime
// reconcileExtensionCapabilityUsage reconciliation.
const derivedCapabilities = deriveExtensionCapabilities(blueprint);
// defineExtensionManifest contract-checks the on-disk manifest mirror at the
// definition site. Pair with assertExtensionManifestMatchesBlueprint in tests
// to guard against capability drift.
const manifestMirror = defineExtensionManifest({
    name: "pm-ts-starter",
    version: VERSION,
    entry: "./dist/index.js",
    priority: 90,
    capabilities: derivedCapabilities,
});
// ===========================================================================
// MODULE ASSEMBLY — composeExtension + composeExtensionPackage
// ===========================================================================
// composeExtension generates the ExtensionModule whose activate wires every
// surface through the matching api.register* call in deterministic order.
const composedModule = composeExtension(blueprint);
// composeExtensionPackage assembles BOTH halves of a shippable package from
// one blueprint + identity: the runtime module (with manifest mirror set)
// and the complete least-privilege manifest (with capabilities derived from
// the blueprint). Export the module as the package entry's default export.
const { module: packagedModule, manifest: synthesizedManifest } = composeExtensionPackage(blueprint, {
    name: "pm-ts-starter",
    version: VERSION,
    entry: "./dist/index.js",
    priority: 90,
});
// ===========================================================================
// EXPORTS
// ===========================================================================
export default packagedModule;
// Re-export the expected-error helpers so downstream authors copying this
// reference can import them without re-deriving the zero-runtime-coupling shim.
export { pmExpectedError, isPmCliExpectedError };
// Export the blueprint, derived capabilities, and manifest mirror so tests
// can verify capability reconciliation and blueprint integrity.
export { blueprint, derivedCapabilities, manifestMirror, synthesizedManifest, composedModule, demoProfile, };
//# sourceMappingURL=index.js.map