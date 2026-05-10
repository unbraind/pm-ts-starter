# pm-ext-ts-starter

TypeScript reference extension for [pm-cli](https://github.com/unbraind/pm-cli) covering all 8 SDK capability types.

---

## Installation

```bash
pm extension install github.com/unbraind/pm-ext-ts-starter --global
```

## Capabilities Demonstrated

| Capability | What it does |
|---|---|
| **Commands** | `pm hello` and `pm ts-starter info` commands |
| **Schema** | Custom validation: title must be ≥ 4 chars |
| **Hooks** | `afterCreate` and `afterClose` lifecycle hooks |
| **Importers** | Demo `ts-starter-demo` importer (no-op) |
| **Renderers** | `ts-starter-compact` renderer: tab-separated output |
| **Search** | `ts-starter-prefix` search: search by ID prefix |
| **Preflight** | `ts-starter-preflight`: workspace health checks |
| **Services** | `ts-starter-health` service: reports extension health |

## Commands

### `pm hello`
```bash
pm hello
pm hello --name World --loud
```

### `pm ts-starter info`
```bash
pm ts-starter info
```

## Using as a Template

1. Clone this repo
2. Edit `index.ts` — remove capabilities you don't need
3. Update `manifest.json` name and capabilities
4. `npm install && npm run build`
5. `pm extension install ./path/to/dir`

## License

MIT
