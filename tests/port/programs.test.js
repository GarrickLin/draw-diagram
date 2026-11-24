// 转译器和运行时一起对照 CPython：tests/port/programs/*.py 的 main() 返回的每一项，repr 必须相同。
import { test } from "node:test";
import assert from "node:assert/strict";
import { skipWithoutPython } from "./helpers.js";
import { MODULES, runPrograms } from "./programs.mjs";

const results = skipWithoutPython ? null : await runPrograms(MODULES);

for (const m of MODULES) {
  test(`${m} gives CPython's results`, { skip: skipWithoutPython }, () => {
    const r = results[m];
    assert.ok(r.python.length > 10, `${m}: only ${r.python.length} items`);
    assert.deepEqual(r.mismatches.slice(0, 3), [], `${m}: ${r.mismatches.length} of ${r.python.length} items differ`);
  });
}
