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
