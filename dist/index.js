// pm-ts-starter — TypeScript reference extension for pm-cli
// Demonstrates all 8 SDK capability types in one file.
const defineExtension = ((extension) => extension);
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
                version: "0.1.0",
                capabilities: [
                    "commands", "schema", "hooks", "importers",
                    "renderers", "preflight", "search", "services",
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
    // Register a custom schema that validates items have a title > 3 chars
    if (typeof api.registerSchema === "function") {
        api.registerSchema({
            name: "ts-starter-title-length",
            description: "Validates item titles are at least 4 characters",
            validate(item) {
                const errors = [];
                if (item.title && item.title.length < 4) {
                    errors.push("Title must be at least 4 characters long");
                }
                return { valid: errors.length === 0, errors };
            },
        });
    }
}
// ---------------------------------------------------------------------------
// 3. HOOKS — react to lifecycle events
// ---------------------------------------------------------------------------
function registerHooks(api) {
    if (typeof api.registerHook === "function") {
        api.registerHook("afterCreate", (ctx) => {
            console.error(`[ts-starter] Hook: item "${ctx.item?.title}" created (${ctx.item?.id})`);
        });
        api.registerHook("afterClose", (ctx) => {
            console.error(`[ts-starter] Hook: item "${ctx.item?.title}" closed`);
        });
    }
}
// ---------------------------------------------------------------------------
// 4. IMPORTERS — programmatic data import
// ---------------------------------------------------------------------------
function registerImporters(api) {
    if (typeof api.registerImporter === "function") {
        api.registerImporter("ts-starter-demo", async (ctx) => {
            console.error("[ts-starter] Demo importer invoked with options:", JSON.stringify(ctx.options));
            // This is a no-op demo importer — extend with real import logic
        });
    }
}
// ---------------------------------------------------------------------------
// 5. RENDERERS — custom output formatting
// ---------------------------------------------------------------------------
function registerRenderers(api) {
    if (typeof api.registerRenderer === "function") {
        api.registerRenderer("json", (items) => {
            return items.map((item) => `${item.id}\t${item.status}\t${item.title}`).join("\n");
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
function registerPreflight(api) {
    if (typeof api.registerPreflight === "function") {
        // Preflight override — can modify preflight decisions before a command runs
        api.registerPreflight(async (ctx) => {
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
        // Override the output_format service to add custom formatting
        api.registerService("output_format", async (ctx) => {
            console.error("[ts-starter] output_format service override active");
            return { format: "toon" };
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
        console.error("[pm-ts-starter] Activating…");
        registerDemoCommands(api);
        registerSchema(api);
        registerHooks(api);
        registerImporters(api);
        registerRenderers(api);
        registerSearch(api);
        registerPreflight(api);
        registerServices(api);
        console.error("[pm-ts-starter] All capabilities registered.");
    },
});
//# sourceMappingURL=index.js.map