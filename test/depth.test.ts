import assert from "node:assert/strict";
import test from "node:test";
import { testDepth, testTimeout, testMatrix, testKinds } from "./support/depth.ts";

test("depth defaults to full and quick preserves a deterministic prefix with a floor", () => {
  const original = process.env.PM_TEST_DEPTH;
  try {
    delete process.env.PM_TEST_DEPTH;
    assert.equal(testDepth(500), 500);
    process.env.PM_TEST_DEPTH = "quick";
    assert.equal(testDepth(500), 50);
    assert.equal(testDepth(50), 25);
    assert.equal(testDepth(16), 16);
  } finally {
    if (original === undefined) delete process.env.PM_TEST_DEPTH;
    else process.env.PM_TEST_DEPTH = original;
  }
});

test("scaled harness deadlines are integer milliseconds and reject invalid factors", () => {
  assert.equal(testTimeout(101, "1.5"), 152);
  assert.equal(testTimeout(30_000, "3"), 90_000);
  for (const value of ["", "0", "-1", "NaN", "Infinity", "100000000"]) assert.throws(() => testTimeout(100, value), /PM_TEST_TIME_SCALE/);
});


test("quick compatibility sampling spans every extension and syntax with unique deterministic cases", () => {
  const previous = process.env.PM_TEST_DEPTH;
  try {
    const cases = ["mts", "cts", "ts"].flatMap(extension => ["require", "import", "dual"].flatMap(branch => Array.from({length: 9}, (_, syntax) => ({extension, branch, syntax}))));
    process.env.PM_TEST_DEPTH = "quick";
    const selected = testMatrix(cases, 9);
    assert.equal(selected.length, 9);
    assert.equal(new Set(selected).size, 9);
    assert.deepEqual(new Set(selected.map(row => row.extension)), new Set(["mts", "cts", "ts"]));
    assert.equal(new Set(selected.map(row => row.syntax)).size, 9);
    assert.deepEqual(testMatrix(cases, 9), selected);
    process.env.PM_TEST_DEPTH = "full";
    assert.deepEqual(testMatrix(cases), cases);
    assert.deepEqual(testMatrix([]), []);
  } finally {
    if (previous === undefined) delete process.env.PM_TEST_DEPTH; else process.env.PM_TEST_DEPTH = previous;
  }
});


test("finite quick matrices retain every named kind and full retains repeated ordinals", () => {
  const previous = process.env.PM_TEST_DEPTH;
  const trace = ["opened", "read", "read", "closed", "read", "retired"];
  try {
    process.env.PM_TEST_DEPTH = "quick";
    assert.equal(testDepth(512), 52);
    assert.equal(testDepth(512, 25), 25);
    assert.deepEqual(testKinds(trace, value => value), ["opened", "read", "closed", "retired"]);
    assert.deepEqual(testKinds([], value => value), []);
    process.env.PM_TEST_DEPTH = "full";
    assert.equal(testDepth(512, 25), 512);
    assert.deepEqual(testKinds(trace, value => value), trace);
    delete process.env.PM_TEST_DEPTH;
    assert.deepEqual(testKinds(trace, value => value), trace);
  } finally {
    if (previous === undefined) delete process.env.PM_TEST_DEPTH; else process.env.PM_TEST_DEPTH = previous;
  }
});
