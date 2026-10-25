/** Choose a nondefault, type-shaped value for every declaration in the real help table. */
export function optionValue(help: string, name: string): unknown {
  const section = help.split(new RegExp(`^--${name}(?=[,\\s])`, "m"))[1]!.split(/^--/m)[0]!;
  if (section.includes("type: boolean")) return !/default: [`"]?true/.test(section);
  const overrides: Record<string, unknown> = {paths: {fixture: ["./fixture"]}, plugins: [{name: "fixture"}], lib: ["es2022"], types: [], rootDirs: ["."],
    typeRoots: ["node_modules/@types"], customConditions: ["fixture"], moduleSuffixes: [".fixture", ""], excludeDirectories: ["fixture"], excludeFiles: ["fixture"],
    all: true, help: true, ignoreConfig: true, listFilesOnly: true, quiet: true, showConfig: true, singleThreaded: true, version: true,
    build: true, init: true, clean: true, force: true, dry: true, verbose: true, stopBuildOnErrors: true, builders: 1,
    maxNodeModuleJsDepth: 1, watchInterval: 100, checkers: 1, rootDir: ".", baseUrl: ".", jsx: "preserve", newLine: "crlf", moduleDetection: "legacy", watchDirectory: "fixedpollinginterval", locale: "de", module: "CommonJS",
    target: "ESNext", watch: true, noCheck: true, noResolve: true, skipLibCheck: true, skipDefaultLibCheck: true};
  if (Object.hasOwn(overrides, name)) return overrides[name];
  const choice = section.match(/one of: (.*)/)?.[1]?.split(", ")[0];
  return choice ?? "fixture";
}
