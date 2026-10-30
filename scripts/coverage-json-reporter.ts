/** Preserve native test coverage paths as JSON without enabling coverage in unrelated subprocesses. */
export default async function* coverageJson(events: AsyncIterable<{type: string; data: unknown}>): AsyncGenerator<string> {
  const records: unknown[] = [];
  for await (const event of events) if (event.type === "test:coverage") records.push(event.data);
  yield JSON.stringify(records);
}
