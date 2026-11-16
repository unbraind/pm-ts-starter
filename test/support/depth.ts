/**
 * Keep full local/release depth by default; quick runs the same deterministic
 * seed prefix at one tenth depth, with at least 25 cases (capped by full count).
 * Explicit finite matrices may supply a smaller quick count after preserving each kind.
 * Seeded callers keep the default floor and identical seed generation/assertions.
 */
export function testDepth(full: number, quick = Math.max(25, Math.ceil(full / 10))): number {
  return process.env.PM_TEST_DEPTH === "quick" ? Math.min(full, quick) : full;
}

/** Scale harness watchdogs only; product deadline assertions remain unchanged. */
export function testTimeout(milliseconds: number, value = process.env.PM_TEST_TIME_SCALE ?? "1"): number {
  const scale = Number(value);
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isSafeInteger(Math.ceil(milliseconds * scale)) || Math.ceil(milliseconds * scale) > 2_147_483_647) {
    throw new Error("PM_TEST_TIME_SCALE must yield a positive safe timeout");
  }
  return Math.ceil(milliseconds * scale);
}


/** Spread a finite compatibility matrix across all dimensions within the quick budget. */
export function testMatrix<T>(cases: readonly T[], quick?: number): T[] {
  const count = testDepth(cases.length, quick);
  return Array.from({ length: count }, (_, index) => cases[count === 1 ? 0 : Math.floor(index * (cases.length - 1) / (count - 1))]!);
}

/** Keep the first occurrence of every boundary kind; full retains every ordinal. */
export function testKinds<T>(cases: readonly T[], kind: (value: T) => unknown): T[] {
  const seen = new Set<unknown>();
  const representatives = cases.filter(value => { const key = kind(value); if (seen.has(key)) return false; seen.add(key); return true; });
  return testDepth(cases.length, representatives.length) === cases.length ? [...cases] : representatives;
}
