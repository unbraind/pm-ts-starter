// pm-ts-starter — TypeScript reference extension for pm-cli
// Demonstrates all 9 SDK capability types in one file (commands, schema,
// hooks, importers/exporters, renderers, search, parser, preflight, services).
//
// This reference is aligned to the pm-cli 2026.7.6 SDK:
//   - `defineExtension` typed identity helper (zero-runtime-coupling pattern)
//   - `createPmCliExpectedError`-shaped errors for better failure messaging
//   - `failure_hints` + typed positional `arguments` on every command definition
//   - demo commands that integrate with the newer pm surfaces: plan workflow,
//     context, search, and history-compact (each shells out to the live `pm`
//     binary, exactly like the existing search provider does, so the demo
//     never depends on a runtime import of `@unbrained/pm-cli`)
//   - a guided `ts-starter setup --interactive` command for first-run onboarding

// ---------------------------------------------------------------------------
// `defineExtension` — typed identity helper + zero-runtime-coupling pattern
//
// `defineExtension` is the SDK's typed identity helper: it returns its argument
// unchanged but constrains it to the `ExtensionModule` shape so TypeScript can
// type-check `activate(api)` and the metadata fields against the real SDK.
//
// We import it as a TYPE ONLY (`import type`). A standalone-installed extension
// loads only its own `dist/` at runtime, so `@unbrained/pm-cli` is NOT
// resolvable as a runtime value — importing the real function would crash at
// activation. Instead we provide a trivial identity implementation and let the
// type import give us full compile-time checking with ZERO runtime coupling to
// the CLI package. The real CLI supplies the live `api` object when it calls
// `activate(api)`.
//
// The same zero-runtime-coupling rule applies to the expected-error helper: we
// type against the SDK's `PmCliExpectedError` shape but build the error locally
// so a standalone install never needs to resolve `@unbrained/pm-cli` at runtime.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type {
  defineExtension as defineExtensionType,
  PmCliExpectedError,
} from "@unbrained/pm-cli/sdk";

const defineExtension: typeof defineExtensionType = ((extension: any) => extension) as any;

// Resolve the extension version from manifest.json (one directory above the
// compiled dist/) instead of a hardcoded literal: the Daily Release workflow
// auto-bumps manifest.json but cannot rewrite a bare constant, so a literal
// here silently drifts — the published 2026.6.10 build still reported 2026.6.4.
const VERSION = (() => {
  try {
    const manifestPath = join(dirname(fileURLToPath(import.meta.url)), "..", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    return typeof manifest.version === "string" ? manifest.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

// Opt-in verbose logging so the reference extension is silent by default.
const VERBOSE = !!process.env.PM_TS_STARTER_VERBOSE;

// ---------------------------------------------------------------------------
// Expected-error helper — build a `PmCliExpectedError`-shaped error without a
// runtime import of `@unbrained/pm-cli`. The CLI's top-level handler recognises
// expected errors by `name === "PmCliError"` (not `instanceof`), so a locally
// constructed error with that name, an `exitCode`, and a secret-free `context`
// is treated exactly like one thrown by the CLI itself: it exits with the
// given code and is excluded from crash reporting. This is the package-safe way
// for an extension to fail loudly with an actionable message instead of a
// generic stack trace.
// ---------------------------------------------------------------------------

const PM_CLI_EXPECTED_ERROR_NAME = "PmCliError" as const;
const DEFAULT_USAGE_EXIT_CODE = 2;

// A relaxed author-facing context shape: callers pass terse keys (feature,
// command, why, hint, attempted_command, suggested_retry) and we normalize to
// the SDK's strict `PmCliErrorContext`. Keeping this loose at the call site is
// what lets the reference extension stay ergonomic while the underlying
// contract stays exact.
interface TsStarterErrorContextInput {
  feature?: string;
  command?: string;
  attempted_command?: string;
  why?: string;
  hint?: string;
  suggested_retry?: string;
  examples?: string[];
  nextSteps?: string[];
  code?: string;
  [key: string]: unknown;
}

interface TsStarterErrorOptions {
  exitCode?: number;
  context?: TsStarterErrorContextInput;
  cause?: unknown;
}

function pmExpectedError(
  message: string,
  options?: TsStarterErrorOptions,
): PmCliExpectedError {
  const exitCode =
    options?.exitCode && Number.isFinite(options.exitCode) && options.exitCode > 0
      ? options.exitCode
      : DEFAULT_USAGE_EXIT_CODE;
  // The SDK's PmCliErrorContext carries structured recovery guidance (code,
  // why, examples, nextSteps, recovery.*). We normalize a plain author map
  // into that shape so callers can pass terse keys (feature/command/why/hint)
  // without coupling to the full contract.
  const raw = (options?.context ?? {}) as TsStarterErrorContextInput;
  const recovery =
    raw.attempted_command || raw.feature || raw.command
      ? {
          attempted_command: raw.attempted_command ?? raw.feature ?? raw.command,
          suggested_retry: raw.suggested_retry,
        }
      : undefined;
  // Normalize to the SDK's PmCliErrorContext shape (code/why/examples/
  // nextSteps/recovery.*). Keys not in the contract are dropped.
  const context = {
    code: raw.code ?? raw.feature ?? raw.command,
    why: raw.why,
    examples: raw.examples,
    nextSteps: raw.nextSteps ?? (raw.hint ? [String(raw.hint)] : undefined),
    recovery,
  };
  const cause = options?.cause;
  const err = new Error(message) as PmCliExpectedError;
  err.name = PM_CLI_EXPECTED_ERROR_NAME;
  err.exitCode = exitCode;
  err.context = context;
  if (cause !== undefined) {
    Object.defineProperty(err, "cause", { value: cause, enumerable: false });
  }
  return err;
}

function isPmCliExpectedError(error: unknown): error is PmCliExpectedError {
  return (
    error instanceof Error &&
    (error as PmCliExpectedError).name === PM_CLI_EXPECTED_ERROR_NAME
  );
}

// ---------------------------------------------------------------------------
// pm shell-out helper — the reference extension never imports the CLI at
// runtime (zero-runtime-coupling). Demo commands that illustrate integration
// with newer pm surfaces (plan, context, search, history-compact) shell out to
// the live `pm` binary, mirroring the pattern the search provider already uses.
// This keeps the demo honest: it exercises the real CLI, returns real JSON,
// and surfaces a typed expected error when the CLI is missing or fails.
// ---------------------------------------------------------------------------

interface PmRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
}

function runPm(pmRoot: string, args: string[]): PmRunResult {
  const result = spawnSync("pm", ["--path", pmRoot, ...args], {
    encoding: "utf-8",
  });
  const stderr = (result.stderr ?? "").trim() || result.error?.message || "";
  return {
    ok: result.status === 0 && !result.error,
    stdout: result.stdout ?? "",
    stderr,
    status: result.status,
  };
}

// Parse the JSON stdout of a pm shell-out, throwing a typed expected error with
// a `failure_hints`-friendly message when the call fails or the body is not
// valid JSON. The `feature` label flows into the error context so callers (and
// the CLI's error-guidance layer) can disambiguate which demo surface failed.
function pmJson<T = unknown>(pmRoot: string, args: string[], feature: string): T {
  const run = runPm(pmRoot, args);
  if (!run.ok) {
    const detail = run.stderr.trim();
    throw pmExpectedError(
      `pm-ts-starter: \`${feature}\` demo failed (pm exited ${run.status})${detail ? `: ${detail}` : "."}`,
      {
        exitCode: 1,
        context: { feature, attempted_command: "pm", why: detail || undefined },
        cause: run.stderr ? new Error(run.stderr) : undefined,
      },
    );
  }
  try {
    return JSON.parse(run.stdout) as T;
  } catch (cause) {
    throw pmExpectedError(
      `pm-ts-starter: \`${feature}\` demo returned non-JSON output from pm.`,
      { exitCode: 1, context: { feature, why: `stdout head: ${run.stdout.slice(0, 200)}` }, cause },
    );
  }
}

// ---------------------------------------------------------------------------
// 1. COMMANDS — register custom CLI commands
// ---------------------------------------------------------------------------

function registerDemoCommands(api: any): void {
  api.registerCommand({
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
    async run(ctx: any) {
      // Typed argument resolution: prefer the explicit --name flag, then a
      // positional argument, then the default. A clearly-named expected error
      // is thrown when the name is empty after trimming.
      const rawName =
        (ctx.options["name"] as string | undefined) ??
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

  api.registerCommand({
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
        sdk_target: "2026.7.6",
        capabilities: [
          "commands", "schema", "hooks", "importers",
          "renderers", "search", "parser", "preflight", "services",
        ],
      };
      console.error(JSON.stringify(info, null, 2));
      return info;
    },
  });

  // ---------------------------------------------------------------------
  // New pm-feature integration demos (all covered by the "commands"
  // capability — they registerCommand, exactly like `hello`). Each shells
  // out to the live `pm` binary and returns parsed JSON so an author can
  // copy the wiring into a real extension that augments these surfaces.
  // ---------------------------------------------------------------------

  api.registerCommand({
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
    async run(ctx: any) {
      const pmRoot = ctx.pm_root ?? ".";
      const id =
        (ctx.options["id"] as string | undefined) ??
        (Array.isArray(ctx.args) && ctx.args.length > 0 ? String(ctx.args[0]) : undefined);
      const depth = (ctx.options["depth"] as string | undefined) ?? "standard";
      const args = ["plan", "show"];
      if (id) args.push(id);
      args.push("--depth", depth, "--json");
      return pmJson<{ plan?: unknown }>(pmRoot, args, "plan");
    },
  });

  api.registerCommand({
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
    async run(ctx: any) {
      const pmRoot = ctx.pm_root ?? ".";
      const format = (ctx.options["format"] as string | undefined) ?? "json";
      const depth = (ctx.options["depth"] as string | undefined);
      const args = ["context", "--format", format];
      if (depth) args.push("--depth", depth);
      // `pm context` emits JSON only when --format json; for other formats we
      // return the raw text so the caller still sees a structured payload.
      if (format === "json") {
        args.push("--json");
        return pmJson(pmRoot, args, "context");
      }
      const run = runPm(pmRoot, args);
      if (!run.ok) {
        throw pmExpectedError(
          `pm-ts-starter: \`${format}\` context demo failed (pm exited ${run.status}).`,
          { exitCode: 1, context: { feature: "context", why: run.stderr.trim() || undefined } },
        );
      }
      return { format, context: run.stdout };
    },
  });

  api.registerCommand({
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
    async run(ctx: any) {
      const pmRoot = ctx.pm_root ?? ".";
      const rawQuery =
        (ctx.options["query"] as string | undefined) ??
        (Array.isArray(ctx.args) && ctx.args.length > 0 ? String(ctx.args[0]) : undefined);
      const query = (rawQuery ?? "").trim();
      if (!query) {
        throw pmExpectedError(
          "pm-ts-starter: search-demo requires a --query (or positional query) argument.",
          { context: { command: "ts-starter search-demo", why: "Pass --query <text> or a positional query." } },
        );
      }
      const limit = String(ctx.options["limit"] ?? 10);
      return pmJson<{ hits?: unknown[] }>(pmRoot, ["search", query, "--limit", limit, "--json"], "search");
    },
  });

  api.registerCommand({
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
    async run(ctx: any) {
      const pmRoot = ctx.pm_root ?? ".";
      const rawId =
        (ctx.options["id"] as string | undefined) ??
        (Array.isArray(ctx.args) && ctx.args.length > 0 ? String(ctx.args[0]) : undefined);
      const id = (rawId ?? "").trim();
      if (!id) {
        throw pmExpectedError(
          "pm-ts-starter: history-compact-demo requires an --id (or positional id) argument.",
          { context: { command: "ts-starter history-compact-demo", why: "Pass --id <item-id> or a positional id." } },
        );
      }
      return pmJson<{ id?: string; dry_run?: boolean }>(
        pmRoot,
        ["history-compact", id, "--dry-run", "--json"],
        "history-compact",
      );
    },
  });

  // ---------------------------------------------------------------------
  // Guided setup — `ts-starter setup --interactive` walks a new user
  // through onboarding (manifest name, capabilities, verbose logging) and
  // prints a checklist. Without --interactive it prints a non-interactive
  // summary so the command is safe to run in CI and tests.
  // ---------------------------------------------------------------------

  api.registerCommand({
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
    async run(ctx: any) {
      const interactive = Boolean(ctx.options["interactive"]);
      const isTty = typeof process.stdin?.isTTY === "boolean" ? process.stdin.isTTY : false;
      const runInteractive = interactive && isTty;

      const summary = {
        extension: "pm-ts-starter",
        version: VERSION,
        sdk_target: "2026.7.6",
        capabilities: [
          "commands", "schema", "hooks", "importers",
          "renderers", "search", "parser", "preflight", "services",
        ],
        verbose_env: "PM_TS_STARTER_VERBOSE=1",
        interactive_requested: interactive,
        interactive_run: runInteractive,
      };

      if (runInteractive) {
        const readline = await import("node:readline/promises");
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        try {
          const name = (await rl.question("Extension name [pm-ts-starter]: ")).trim() || "pm-ts-starter";
          const wantVerbose = /^y/i.test((await rl.question("Enable verbose logging? [y/N]: ")).trim());
          console.error(`\n[ts-starter] Guided setup complete for "${name}".`);
          if (wantVerbose) console.error("[ts-starter] Set PM_TS_STARTER_VERBOSE=1 to see activation logs.");
          console.error("[ts-starter] Next: edit index.ts to keep only the capabilities you need, then `npm run build`.");
        } finally {
          rl.close();
        }
      } else {
        console.error(JSON.stringify(summary, null, 2));
        if (interactive && !isTty) {
          console.error("[ts-starter] stdin is not a TTY; interactive mode skipped. Re-run in a terminal.");
        }
      }
      return summary;
    },
  });
}

// ---------------------------------------------------------------------------
// 2. SCHEMA — provide custom JSON schemas for item validation
// ---------------------------------------------------------------------------

function registerSchema(api: any): void {
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

function registerHooks(api: any): void {
  // The real ExtensionApi exposes ALL FIVE lifecycle hooks under `api.hooks.*`
  // (beforeCommand/afterCommand/onWrite/onRead/onIndex) — there is no
  // `registerHook`. All hooks here are observe-only and log only when
  // PM_TS_STARTER_VERBOSE is set, so installing this reference extension never
  // adds noise to an unrelated workspace.
  if (!api.hooks) return;

  // beforeCommand — runs before any command handler.
  api.hooks.beforeCommand((ctx: any) => {
    if (VERBOSE) console.error(`[ts-starter] beforeCommand: ${ctx.command}`);
  });
  // afterCommand — runs after a command, with { command, ok, error, ... }.
  api.hooks.afterCommand((ctx: any) => {
    if (VERBOSE) console.error(`[ts-starter] afterCommand: ${ctx.command} (ok=${ctx.ok})`);
    // Surface a concise hint when a command fails with an expected error so an
    // operator scanning stderr gets an actionable next step, not just a stack.
    if (VERBOSE && ctx.ok === false && ctx.error && isPmCliExpectedError(ctx.error)) {
      console.error(`[ts-starter] hint: ${ctx.error.message}`);
    }
  });
  // onWrite — fires when pm writes an item file to disk.
  api.hooks.onWrite((ctx: any) => {
    if (VERBOSE) console.error(`[ts-starter] onWrite: ${ctx?.op ?? ""} ${ctx?.path ?? ""}`.trimEnd());
  });
  // onRead — fires when pm reads an item file.
  api.hooks.onRead((ctx: any) => {
    if (VERBOSE) console.error(`[ts-starter] onRead: ${ctx?.path ?? "(item)"}`);
  });
  // onIndex — fires when pm (re)indexes items for search.
  api.hooks.onIndex((ctx: any) => {
    if (VERBOSE) console.error(`[ts-starter] onIndex: ${(ctx && (ctx.count ?? ctx.path)) ?? "(index event)"}`);
  });
}

// ---------------------------------------------------------------------------
// 4. IMPORTERS — programmatic data import
// ---------------------------------------------------------------------------

function registerImporters(api: any): void {
  // registerImporter("ts-starter-demo") auto-creates `pm ts-starter-demo import`
  // and registerExporter the matching `pm ts-starter-demo export`. Both are
  // covered by the "importers" capability. The 2026.7.6 SDK accepts an optional
  // third `options` argument that adds a full command definition (description,
  // flags, intent, examples, failure_hints, positional arguments) to the
  // auto-created command path — surfaced in help exactly like registerCommand.
  if (typeof api.registerImporter === "function") {
    api.registerImporter(
      "ts-starter-demo",
      async (ctx: any) => {
        if (VERBOSE) console.error("[ts-starter] Demo importer invoked:", JSON.stringify(ctx.options));
        // Demo no-op importer — extend with real import logic.
        return { imported: 0 };
      },
      {
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
    );
  }
  if (typeof api.registerExporter === "function") {
    api.registerExporter(
      "ts-starter-demo",
      async (ctx: any) => {
        if (VERBOSE) console.error("[ts-starter] Demo exporter invoked:", JSON.stringify(ctx.options));
        // Demo exporter — echoes a tagged payload so the renderer demo can pick
        // it up (`ts_starter` marker) without affecting any other command.
        return { ts_starter: true, exported: 0 };
      },
      {
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
    );
  }
}

// ---------------------------------------------------------------------------
// 5. RENDERERS — custom output formatting
// ---------------------------------------------------------------------------

function registerRenderers(api: any): void {
  if (typeof api.registerRenderer === "function") {
    // A renderer override is registered per-format and runs for EVERY command
    // using that format. To avoid hijacking other commands' output, transform
    // ONLY our own payload (tagged with `ts_starter`) and return null for
    // everything else so pm falls through to its native renderer.
    api.registerRenderer("json", (ctx: any) => {
      const result = ctx?.result;
      if (result && typeof result === "object" && (result as any).ts_starter) {
        return JSON.stringify({ rendered_by: "pm-ts-starter", ...result }, null, 2);
      }
      return null; // not ours → native rendering
    });
  }
}

// ---------------------------------------------------------------------------
// 6. SEARCH — custom search provider
// ---------------------------------------------------------------------------

function registerSearch(api: any): void {
  if (typeof api.registerSearchProvider === "function") {
    api.registerSearchProvider({
      name: "ts-starter-prefix",
      async query(ctx: any) {
        const query = ctx.query ?? "";
        const result = spawnSync("pm", ["--path", ctx.pm_root ?? ".", "list-all", "--json"], {
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

  // registerVectorStoreAdapter — the second half of the "search" capability.
  // This is an in-memory, deterministic adapter so authors can see the
  // vector-store contract (upsert + query) without an external service. It
  // produces a tiny hashed pseudo-embedding (NOT a real model) and keeps vectors
  // in a Map for the lifetime of the process.
  if (typeof api.registerVectorStoreAdapter === "function") {
    const store = new Map<string, number[]>();
    const pseudoEmbed = (text: string, dims = 8): number[] => {
      const vec = new Array(dims).fill(0);
      for (let i = 0; i < text.length; i++) vec[i % dims] += text.charCodeAt(i) % 17;
      return vec;
    };
    api.registerVectorStoreAdapter({
      name: "ts-starter-memory",
      async upsert(ctx: any) {
        const id = String(ctx?.id ?? "");
        const text = String(ctx?.text ?? ctx?.title ?? "");
        if (id) store.set(id, pseudoEmbed(text));
        return { upserted: id ? 1 : 0 };
      },
      async query(ctx: any) {
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

function registerParser(api: any): void {
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

function registerPreflight(api: any): void {
  if (typeof api.registerPreflight === "function") {
    // Preflight override — can modify preflight decisions before a command runs
    api.registerPreflight(async (ctx: any) => {
      if (VERBOSE) console.error(`[ts-starter] Preflight check for workspace: ${ctx.pm_root ?? "unknown"}`);
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

function registerServices(api: any): void {
  if (typeof api.registerService === "function") {
    // A service override REPLACES a core service for the whole CLI. The only
    // safe demonstration is a true pass-through that returns the incoming
    // payload UNCHANGED — returning a fabricated value (e.g. `{ format }`) would
    // corrupt every command's output. Do real work here only if you intend to
    // override the service globally.
    api.registerService("output_format", async (ctx: any) => {
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

function registerExtraFlags(api: any): void {
  // registerFlags adds extra flags to an existing native command (here, `list`).
  // The flag is observe-only: native `list` ignores unknown options, so this
  // exists purely to show the wiring. registerFlags is covered by the
  // "commands" capability and needs no separate manifest entry.
  if (typeof api.registerFlags === "function") {
    api.registerFlags("list", [
      {
        long: "--ts-starter-tag",
        value_name: "tag",
        value_type: "string",
        description: "DEMO flag added by pm-ts-starter (inert; illustrates registerFlags).",
      },
    ]);
  }
}

// Re-export the expected-error helpers so downstream authors copying this
// reference can import them without re-deriving the zero-runtime-coupling shim.
export { pmExpectedError, isPmCliExpectedError };

export default defineExtension({
  name: "pm-ts-starter",
  version: VERSION,

  activate(api: any) {
    // Incidental logging is opt-in (PM_TS_STARTER_VERBOSE) so installing this
    // reference extension never pollutes other commands' stderr.
    if (VERBOSE) console.error("[pm-ts-starter] Activating…");

    registerDemoCommands(api);  // registerCommand (with typed flags + failure_hints)
    registerExtraFlags(api);    // registerFlags (augments native `list`)
    registerSchema(api);        // registerItemFields/registerItemTypes/registerMigration
    registerHooks(api);         // hooks.before/after/onWrite/onRead/onIndex
    registerImporters(api);     // registerImporter/registerExporter (with command-definition options)
    registerRenderers(api);     // registerRenderer
    registerSearch(api);        // registerSearchProvider/registerVectorStoreAdapter
    registerParser(api);        // registerParser
    registerPreflight(api);     // registerPreflight
    registerServices(api);      // registerService

    if (VERBOSE) console.error("[pm-ts-starter] All capabilities registered.");
  },
});
