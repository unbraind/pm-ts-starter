// pm-ts-starter — TypeScript reference extension for pm-cli
// Demonstrates all 9 SDK capability types in one file (commands, schema,
// hooks, importers/exporters, renderers, search, parser, preflight, services).
const defineExtension = ((extension) => extension);
const VERSION = "2026.6.4";
// Opt-in verbose logging so the reference extension is silent by default.
const VERBOSE = !!process.env.PM_TS_STARTER_VERBOSE;
// ---------------------------------------------------------------------------
// 1. COMMANDS — register custom CLI commands
// ---------------------------------------------------------------------------
function registerDemoCommands(api) {
    api.registerCommand({
        name: "hello",
        description: "Say hello from the TypeScript starter extension.",
        intent: "demonstrate a simple command",
        examples: ["pm hello", "pm hello --name World"],
        flags: [
            { long: "--name", value_name: "name", description: "Name to greet (default: pm-cli)" },
            { long: "--loud", description: "Uppercase the greeting" },
        ],
        async run(ctx) {
            const name = ctx.options["name"] || "pm-cli";
            const loud = Boolean(ctx.options["loud"]);
            const greeting = loud ? `HELLO, ${name.toUpperCase()}!` : `Hello, ${name}!`;
            console.error(greeting);
            return { greeting };
        },
    });
    api.registerCommand({
        name: "ts-starter info",
        description: "Show TypeScript starter extension info and registered capabilities.",
        intent: "show extension metadata",
        examples: ["pm ts-starter info"],
        flags: [],
        async run() {
            const info = {
                name: "pm-ts-starter",
                version: VERSION,
                capabilities: [
                    "commands", "schema", "hooks", "importers",
                    "renderers", "search", "parser", "preflight", "services",
                ],
            };
            console.error(JSON.stringify(info, null, 2));
            return info;
        },
    });
}
// ---------------------------------------------------------------------------
// 2. SCHEMA — provide custom JSON schemas for item validation
// ---------------------------------------------------------------------------
function registerSchema(api) {
    // The real schema API is registerItemFields / registerItemTypes /
    // registerMigration (there is no `registerSchema`). Here we add an optional
    // custom field, a custom item type, and a no-op migration to demonstrate all
    // three. All require the "schema" capability in manifest.json.
    if (typeof api.registerItemFields === "function") {
        api.registerItemFields([
            { name: "ts_starter_ref", type: "string", optional: true },
        ]);
    }
    if (typeof api.registerItemTypes === "function") {
        api.registerItemTypes([
            { name: "Spike", aliases: ["spike"] },
        ]);
    }
    if (typeof api.registerMigration === "function") {
        api.registerMigration({
            id: "ts-starter-noop",
            description: "Demo migration (no-op).",
            run() {
                // A real migration would transform items here.
            },
        });
    }
}
// ---------------------------------------------------------------------------
// 3. HOOKS — react to lifecycle events
// ---------------------------------------------------------------------------
function registerHooks(api) {
    // The real ExtensionApi exposes ALL FIVE lifecycle hooks under `api.hooks.*`
    // (beforeCommand/afterCommand/onWrite/onRead/onIndex) — there is no
    // `registerHook`. All hooks here are observe-only and log only when
    // PM_TS_STARTER_VERBOSE is set, so installing this reference extension never
    // adds noise to an unrelated workspace.
    if (!api.hooks)
        return;
    // beforeCommand — runs before any command handler.
    api.hooks.beforeCommand((ctx) => {
        if (VERBOSE)
            console.error(`[ts-starter] beforeCommand: ${ctx.command}`);
    });
    // afterCommand — runs after a command, with { command, ok, error, ... }.
    api.hooks.afterCommand((ctx) => {
        if (VERBOSE)
            console.error(`[ts-starter] afterCommand: ${ctx.command} (ok=${ctx.ok})`);
    });
    // onWrite — fires when pm writes an item file to disk.
    api.hooks.onWrite((ctx) => {
        if (VERBOSE)
            console.error(`[ts-starter] onWrite: ${ctx?.op ?? ""} ${ctx?.path ?? ""}`.trimEnd());
    });
    // onRead — fires when pm reads an item file.
    api.hooks.onRead((ctx) => {
        if (VERBOSE)
            console.error(`[ts-starter] onRead: ${ctx?.path ?? "(item)"}`);
    });
    // onIndex — fires when pm (re)indexes items for search.
    api.hooks.onIndex((ctx) => {
        if (VERBOSE)
            console.error(`[ts-starter] onIndex: ${(ctx && (ctx.count ?? ctx.path)) ?? "(index event)"}`);
    });
}
// ---------------------------------------------------------------------------
// 4. IMPORTERS — programmatic data import
// ---------------------------------------------------------------------------
function registerImporters(api) {
    // registerImporter("ts-starter-demo") auto-creates `pm ts-starter-demo import`
    // and registerExporter the matching `pm ts-starter-demo export`. Both are
    // covered by the "importers" capability.
    if (typeof api.registerImporter === "function") {
        api.registerImporter("ts-starter-demo", async (ctx) => {
            if (VERBOSE)
                console.error("[ts-starter] Demo importer invoked:", JSON.stringify(ctx.options));
            // Demo no-op importer — extend with real import logic.
            return { imported: 0 };
        });
    }
    if (typeof api.registerExporter === "function") {
        api.registerExporter("ts-starter-demo", async (ctx) => {
            if (VERBOSE)
                console.error("[ts-starter] Demo exporter invoked:", JSON.stringify(ctx.options));
            // Demo exporter — echoes a tagged payload so the renderer demo can pick
            // it up (`ts_starter` marker) without affecting any other command.
            return { ts_starter: true, exported: 0 };
        });
    }
}
// ---------------------------------------------------------------------------
// 5. RENDERERS — custom output formatting
// ---------------------------------------------------------------------------
function registerRenderers(api) {
    if (typeof api.registerRenderer === "function") {
        // A renderer override is registered per-format and runs for EVERY command
        // using that format. To avoid hijacking other commands' output, transform
        // ONLY our own payload (tagged with `ts_starter`) and return null for
        // everything else so pm falls through to its native renderer.
        api.registerRenderer("json", (ctx) => {
            const result = ctx?.result;
            if (result && typeof result === "object" && result.ts_starter) {
                return JSON.stringify({ rendered_by: "pm-ts-starter", ...result }, null, 2);
            }
            return null; // not ours → native rendering
        });
    }
}
// ---------------------------------------------------------------------------
// 6. SEARCH — custom search provider
// ---------------------------------------------------------------------------
function registerSearch(api) {
    if (typeof api.registerSearchProvider === "function") {
        api.registerSearchProvider({
            name: "ts-starter-prefix",
            async query(ctx) {
                const query = ctx.query ?? "";
                const { spawnSync } = await import("node:child_process");
                const result = spawnSync("pm", ["--path", ctx.pm_root ?? ".", "list-all", "--json"], {
                    encoding: "utf-8",
                });
                if (result.status !== 0)
                    return { results: [] };
                const data = JSON.parse(result.stdout);
                const items = (data.items || []).filter((item) => item.id.startsWith(query));
                return { results: items };
            },
        });
    }
    // registerVectorStoreAdapter — the second half of the "search" capability.
    // This is an in-memory, deterministic adapter so authors can see the
    // vector-store contract (upsert + query) without an external service. It
    // produces a tiny hashed pseudo-embedding (NOT a real model) and keeps vectors
    // in a Map for the lifetime of the process.
    if (typeof api.registerVectorStoreAdapter === "function") {
        const store = new Map();
        const pseudoEmbed = (text, dims = 8) => {
            const vec = new Array(dims).fill(0);
            for (let i = 0; i < text.length; i++)
                vec[i % dims] += text.charCodeAt(i) % 17;
            return vec;
        };
        api.registerVectorStoreAdapter({
            name: "ts-starter-memory",
            async upsert(ctx) {
                const id = String(ctx?.id ?? "");
                const text = String(ctx?.text ?? ctx?.title ?? "");
                if (id)
                    store.set(id, pseudoEmbed(text));
                return { upserted: id ? 1 : 0 };
            },
            async query(ctx) {
                const qVec = pseudoEmbed(String(ctx?.query ?? ""));
                const scored = [...store.entries()].map(([id, v]) => ({
                    id,
                    score: v.reduce((s, x, i) => s + x * (qVec[i] ?? 0), 0),
                }));
                scored.sort((a, b) => b.score - a.score);
                return { results: scored.slice(0, ctx?.limit ?? 5) };
            },
        });
    }
}
// ---------------------------------------------------------------------------
// 7. PARSER — pre-normalize a command's args/options before its handler runs
// ---------------------------------------------------------------------------
function registerParser(api) {
    // A parser override can adjust how a specific command's args/options are
    // parsed. Here it's a pass-through (returns no delta) for the `list` command,
    // shown purely to wire the capability. Requires the "parser" capability.
    if (typeof api.registerParser === "function") {
        api.registerParser("list", () => {
            return {}; // no changes to parsing
        });
    }
}
// ---------------------------------------------------------------------------
// 8. PREFLIGHT — adjust gate decisions the CLI makes before a command runs
// ---------------------------------------------------------------------------
function registerPreflight(api) {
    if (typeof api.registerPreflight === "function") {
        // Preflight override — can modify preflight decisions before a command runs
        api.registerPreflight(async (ctx) => {
            if (VERBOSE)
                console.error(`[ts-starter] Preflight check for workspace: ${ctx.pm_root ?? "unknown"}`);
            // Return the current decision unchanged (pass-through)
            return {
                enforce_item_format_gate: ctx.decision?.enforce_item_format_gate ?? true,
                run_preflight_item_format_sync: ctx.decision?.run_preflight_item_format_sync ?? false,
                run_extension_migrations: ctx.decision?.run_extension_migrations ?? true,
                enforce_mandatory_migration_gate: ctx.decision?.enforce_mandatory_migration_gate ?? false,
            };
        });
    }
}
// ---------------------------------------------------------------------------
// 9. SERVICES — override a named core service for the whole CLI
// ---------------------------------------------------------------------------
function registerServices(api) {
    if (typeof api.registerService === "function") {
        // A service override REPLACES a core service for the whole CLI. The only
        // safe demonstration is a true pass-through that returns the incoming
        // payload UNCHANGED — returning a fabricated value (e.g. `{ format }`) would
        // corrupt every command's output. Do real work here only if you intend to
        // override the service globally.
        api.registerService("output_format", async (ctx) => {
            return ctx?.payload;
        });
    }
}
// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// FLAGS — augment an EXISTING native command (part of the "commands" capability)
// ---------------------------------------------------------------------------
function registerExtraFlags(api) {
    // registerFlags adds extra flags to an existing native command (here, `list`).
    // The flag is observe-only: native `list` ignores unknown options, so this
    // exists purely to show the wiring. registerFlags is covered by the
    // "commands" capability and needs no separate manifest entry.
    if (typeof api.registerFlags === "function") {
        api.registerFlags("list", [
            {
                long: "--ts-starter-tag",
                value_name: "tag",
                description: "DEMO flag added by pm-ts-starter (inert; illustrates registerFlags).",
                type: "string",
            },
        ]);
    }
}
export default defineExtension({
    name: "pm-ts-starter",
    version: VERSION,
    activate(api) {
        // Incidental logging is opt-in (PM_TS_STARTER_VERBOSE) so installing this
        // reference extension never pollutes other commands' stderr.
        if (VERBOSE)
            console.error("[pm-ts-starter] Activating…");
        registerDemoCommands(api); // registerCommand (with typed flags)
        registerExtraFlags(api); // registerFlags (augments native `list`)
        registerSchema(api); // registerItemFields/registerItemTypes/registerMigration
        registerHooks(api); // hooks.before/after/onWrite/onRead/onIndex
        registerImporters(api); // registerImporter/registerExporter
        registerRenderers(api); // registerRenderer
        registerSearch(api); // registerSearchProvider/registerVectorStoreAdapter
        registerParser(api); // registerParser
        registerPreflight(api); // registerPreflight
        registerServices(api); // registerService
        if (VERBOSE)
            console.error("[pm-ts-starter] All capabilities registered.");
    },
});
//# sourceMappingURL=index.js.map