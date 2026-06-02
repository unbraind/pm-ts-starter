// pm-ts-starter — TypeScript reference extension for pm-cli
// Demonstrates all 9 SDK capability types in one file (commands, schema,
// hooks, importers/exporters, renderers, search, parser, preflight, services).
const defineExtension = ((extension) => extension);
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
                version: "2026.5.31",
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
    // The real ExtensionApi exposes lifecycle hooks under `api.hooks.*`
    // (beforeCommand/afterCommand/onWrite/onRead/onIndex) — there is no
    // `registerHook`. afterCommand fires after every command with { command,
    // ok, error, ... }; logging is opt-in (PM_TS_STARTER_VERBOSE).
    if (api.hooks && typeof api.hooks.afterCommand === "function") {
        api.hooks.afterCommand((ctx) => {
            if (VERBOSE) {
                console.error(`[ts-starter] afterCommand: ${ctx.command} (ok=${ctx.ok})`);
            }
        });
        api.hooks.beforeCommand((ctx) => {
            if (VERBOSE)
                console.error(`[ts-starter] beforeCommand: ${ctx.command}`);
        });
    }
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
}
// ---------------------------------------------------------------------------
// 7. PREFLIGHT — Pre-flight checks before commands run
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
// 8. SERVICES — background services / config providers
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
export default defineExtension({
    name: "pm-ts-starter",
    version: "0.1.0",
    activate(api) {
        // Incidental logging is opt-in (PM_TS_STARTER_VERBOSE) so installing this
        // reference extension never pollutes other commands' stderr.
        if (VERBOSE)
            console.error("[pm-ts-starter] Activating…");
        registerDemoCommands(api);
        registerSchema(api);
        registerHooks(api);
        registerImporters(api);
        registerRenderers(api);
        registerSearch(api);
        registerParser(api);
        registerPreflight(api);
        registerServices(api);
        if (VERBOSE)
            console.error("[pm-ts-starter] All capabilities registered.");
    },
});
//# sourceMappingURL=index.js.map