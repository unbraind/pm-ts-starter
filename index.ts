// pm-ext-ts-starter — TypeScript reference extension for pm-cli
// Demonstrates all 9 SDK capability types in one file.
// Inline defineExtension to avoid SDK import at runtime.

function defineExtension(ext: any) {
  return Object.assign({ activate() {} }, ext, {
    activate(api: any) { ext.activate?.(api); },
  });
}

// ---------------------------------------------------------------------------
// 1. COMMANDS — register custom CLI commands
// ---------------------------------------------------------------------------

function registerDemoCommands(api: any): void {
  api.registerCommand({
    name: "hello",
    description: "Say hello from the TypeScript starter extension.",
    intent: "demonstrate a simple command",
    examples: ["pm hello", "pm hello --name World"],
    flags: [
      { long: "--name", value_name: "name", description: "Name to greet (default: pm-cli)" },
      { long: "--loud", description: "Uppercase the greeting" },
    ],
    async run(ctx: any) {
      const name = (ctx.options["name"] as string) || "pm-cli";
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
        name: "pm-ext-ts-starter",
        version: "0.1.0",
        capabilities: [
          "commands", "schema", "hooks", "importers",
          "renderers", "search", "services",
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

function registerSchema(api: any): void {
  // Register a custom schema that validates items have a title > 3 chars
  if (typeof api.registerSchema === "function") {
    api.registerSchema({
      name: "ts-starter-title-length",
      description: "Validates item titles are at least 4 characters",
      validate(item: any) {
        const errors: string[] = [];
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

function registerHooks(api: any): void {
  if (typeof api.registerHook === "function") {
    api.registerHook("afterCreate", (ctx: any) => {
      console.error(`[ts-starter] Hook: item "${ctx.item?.title}" created (${ctx.item?.id})`);
    });

    api.registerHook("afterClose", (ctx: any) => {
      console.error(`[ts-starter] Hook: item "${ctx.item?.title}" closed`);
    });
  }
}

// ---------------------------------------------------------------------------
// 4. IMPORTERS — programmatic data import
// ---------------------------------------------------------------------------

function registerImporters(api: any): void {
  if (typeof api.registerImporter === "function") {
    api.registerImporter("ts-starter-demo", async (ctx: any) => {
      console.error("[ts-starter] Demo importer invoked with options:", JSON.stringify(ctx.options));
      // This is a no-op demo importer — extend with real import logic
    });
  }
}

// ---------------------------------------------------------------------------
// 5. RENDERERS — custom output formatting
// ---------------------------------------------------------------------------

function registerRenderers(api: any): void {
  if (typeof api.registerRenderer === "function") {
    api.registerRenderer("ts-starter-compact", (items: any[]) => {
      return items.map((item: any) => `${item.id}\t${item.status}\t${item.title}`).join("\n");
    });
  }
}

// ---------------------------------------------------------------------------
// 6. SEARCH — custom search provider
// ---------------------------------------------------------------------------

function registerSearch(api: any): void {
  if (typeof api.registerSearchProvider === "function") {
    api.registerSearchProvider("ts-starter-prefix", {
      description: "Search items by ID prefix",
      async search(query: string, ctx: any) {
        // Simple prefix search — delegates to pm list
        const { spawnSync } = await import("node:child_process");
        const result = spawnSync("pm", ["--path", ctx.pm_root, "list-all", "--json"], {
          encoding: "utf-8",
        });
        if (result.status !== 0) return { results: [] };
        const data = JSON.parse(result.stdout);
        const items = (data.items || []).filter((item: any) =>
          item.id.startsWith(query)
        );
        return { results: items };
      },
    });
  }
}

// ---------------------------------------------------------------------------
// 7. SERVICES — background services / config providers
// ---------------------------------------------------------------------------

function registerServices(api: any): void {
  if (typeof api.registerService === "function") {
    api.registerService("ts-starter-health", {
      description: "Reports ts-starter extension health",
      async getStatus() {
        return {
          healthy: true,
          extension: "pm-ext-ts-starter",
          version: "0.1.0",
          uptime: process.uptime(),
        };
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default defineExtension({
  name: "pm-ext-ts-starter",
  version: "0.1.0",

  activate(api: any) {
    console.error("[pm-ext-ts-starter] Activating…");

    // Register all capability types
    registerDemoCommands(api);
    registerSchema(api);
    registerHooks(api);
    registerImporters(api);
    registerRenderers(api);
    registerSearch(api);
    registerServices(api);

    console.error("[pm-ext-ts-starter] All capabilities registered.");
  },
});
