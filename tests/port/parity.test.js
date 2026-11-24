// 引擎整体对照：同一批请求交给 CPython 的 tools/port/bridge.py 和 JS 引擎，回答必须逐字节相同。
// 更大规模的对照：node tests/port/parity.mjs --variants 12 --seed <n>
import { test } from "node:test";
import assert from "node:assert/strict";
import { skipWithoutPython } from "./helpers.js";
import { cases, runParity, DESCRIPTIONS } from "./parity.mjs";

test("every spec, in English and Chinese, with variants and revisions: same bytes as CPython", { skip: skipWithoutPython, timeout: 900_000 }, async () => {
  const list = cases({ variants: 2, seed: 20261125 });
  const outcomes = { layout: 0, error: 0, crash: 0 };
  const res = await runParity(list, { onCase: (_c, kind) => outcomes[kind]++ });
  const shown = res.mismatches.slice(0, 3).map((m) => `${m.op} ${m.id} at ${m.at}\n  python: ${m.python}\n  js:     ${m.js}`);
  assert.equal(res.mismatches.length, 0, shown.join("\n"));
  // the run covered what it should: descriptions, layouts, rejected specs and revisions
  assert.ok(list.length >= 55 * 4 + DESCRIPTIONS.length * 3, `${list.length} cases`);
  assert.ok(outcomes.layout > 100 && outcomes.error > 5, JSON.stringify(outcomes));
  assert.ok(res.byOp["revise compile"] > 10, JSON.stringify(res.byOp));
});
