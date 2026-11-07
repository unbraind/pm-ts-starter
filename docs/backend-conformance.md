# Backend conformance example

Generate and build `pm-my-backend` using the README commands, then import its typed SDK:

```ts
import {
  createDirectoryAdapter,
  createRemoteAdapter,
  type RemoteReader,
} from "pm-my-backend";

const directory = createDirectoryAdapter("./tracker");
const proof = await directory.execute("inspect");
if (proof.ok) console.log(proof.item_count, proof.complete_list.no_omissions);

// Supply a transport implementation with authentication, cancellation and timeout.
// Its response must be the entire unmodified listAllComplete envelope.
export async function inspectRemote(transport: RemoteReader) {
  const backend = createRemoteAdapter(transport);
  const receipt = await backend.execute("inspect");
  if (!receipt.ok) console.error(receipt.code, receipt.remedy);
  return receipt;
}

const refusal = await directory.execute("delete");
if (!refusal.ok) console.error(refusal.code, refusal.remedy);
```

For a local demonstration of the remote boundary without a network service, pass
`{ listAllComplete: () => client.listAllComplete() }` using a `PmClient` aimed at a
scratch tracker. The contracts use this real-data path, then remove `read_output`
and `omission_receipt` separately to verify fail-closed behavior. An untrusted
remote response is typed as `unknown` until SDK certification succeeds.

The summary intentionally returns no item titles, bodies or paths. An empty tracker
is a valid count of zero; partial, filtered or malformed data must never become a
successful empty result. The full corpus is read for certification, so runtime and
memory scale with tracker size even though output stays compact.

Directory and remote support the same `inspect`, `create`, `update`, `delete`
operation vocabulary. Only inspect is implemented. Adding write support requires
an explicit capability and new conformance tests before removing the typed refusal.
A contract pass does not establish authentication or availability of a deployed
remote provider.

## Structured output through the SDK

Use the public host codecs for standalone output and semantic assertions:

```ts
import { encodeToon, decodeToon } from "@unbrained/pm-cli/sdk";

const receipt = await directory.execute("inspect");
const toon = encodeToon(receipt);
console.log(toon);
const decoded: unknown = decodeToon(toon);
```

The SDK floor 2026.10.17 exposes both functions. Generated peer and development
dependencies and `pm_min_version` retain that tested floor. There is no direct
codec dependency: packages installed into a host should use its codec version.
The pm extension command returns its receipt to the host renderer; it only needs
manual encoding in the standalone CLI.

The generated contracts round-trip real non-git tracker receipts and JSON values
with booleans, null, empty arrays, nested objects, numeric-looking strings, Unicode,
newlines, tabs, quotes and backslashes. They check item and history bytes remain
unchanged. The package suite also runs the built CLI with npm and Bun consumers,
compares default TOON with the SDK encoding and decoded JSON receipt, and activates
the generated extension through `createExtensionTestHarness`.

Generated-consumer tests require direct access to the public npm registry. They
install only public packages, use an isolated home for npm and Bun, and discard
inherited registry settings and credentials. Both package managers install a fresh
dependency graph, including when the caller configures an authenticated mirror.

Keep the application's read-only operation policy, compact receipt shape and
complete-list certification. Codecs serialize values; they do not choose supported
operations, certify a full source read or redact transport failures. No raw-string
or custom escaping helper is needed for these structured receipts.
