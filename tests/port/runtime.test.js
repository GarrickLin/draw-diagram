// Python 语义运行时的定点检查，不需要 CPython：参考值是在 CPython 3.14（PYTHONHASHSEED=0）上取的。
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { ENGINE } from "./helpers.js";

const py = await import(join(ENGINE, "py", "runtime.js"));
const json = await import(join(ENGINE, "py", "json.js"));

test("str hashes are CPython's SipHash-1-3 with PYTHONHASHSEED=0", () => {
  const cases = { "": 0n, a: 4644417185603328019n, abc: -4594863902769663758n, "hello world": -5642461784034726774n, "é": 6047309291227476195n, "片上": -7704787337590154540n, "🙂": -3580763040787020986n, n_host: -4192199203995597910n };
  for (const [s, h] of Object.entries(cases)) assert.equal(py.pyhash(s), h, JSON.stringify(s));
  assert.equal(py.pyhash("a".repeat(100)), -2643860352045292050n);
  assert.equal(py.pyhash(py.frozenset(["a", "b"])), 1679668661828516449n);
  assert.equal(py.pyhash(py.frozenset([1, 2, 3])), -272375401224217160n);
});

test("set iteration follows CPython's table", () => {
  // list({...}) in CPython 3.14 with PYTHONHASHSEED=0
  assert.deepEqual([...py.S(3, 1, 2)], [1, 2, 3]);
  assert.deepEqual([...py.SC(3, 1, 2, py.F(1), true, 2 ** 52, -1, -2)], [2 ** 52, 1, 2, 3, -1, -2]);
  assert.deepEqual([...py.S(-1, -2)], [-1, -2]);
});

test("ints never become -0 and stay exact", () => {
  assert.ok(Object.is(py.mul(0, -5), 0));
  assert.ok(Object.is(py.neg(0), 0));
  assert.ok(Object.is(py.neg(false), 0));
  assert.ok(Object.is(py.mod(-5, 5), 0));
  assert.ok(Object.is(py.floordiv(0, -5), 0));
  assert.ok(Object.is(py.round(py.F(-0)), 0));
  assert.equal(py.repr(py.floordiv(0, py.F(-1.5))), "-0.0");
  assert.equal(py.repr(py.mod(0, py.F(-1.5))), "-0.0");
  assert.equal(py.pow(10, 16), 1e16, "exactly representable");
  assert.throws(() => py.add(2 ** 53, 1), py.OverflowError);
  assert.throws(() => py.mul(3, 2 ** 52 + 1), py.OverflowError);
  assert.throws(() => py.hashOf(0.5), py.NotImplementedError, "hash(0.5) is 2^60");
});

test("float repr and formatting are CPython's", () => {
  const cases = [
    [1e16, "1e+16"], [1e22, "1e+22"], [5e-324, "5e-324"], [0.1, "0.1"], [1e-5, "1e-05"], [123456789.125, "123456789.125"], [1.7976931348623157e308, "1.7976931348623157e+308"],
  ];
  for (const [x, r] of cases) assert.equal(py.repr(py.fl(x)), r);
  assert.equal(py.format(py.fl(1e22), ".2f"), "10000000000000000000000.00");
  assert.equal(py.format(5e-324, "g"), "4.94066e-324");
  assert.equal(py.format(2.675, ".2f"), "2.67");
  assert.equal(py.format(py.fl(1e22), ".1%"), "999999999999999983222784.0%");
  assert.equal(py.format(-0.001, ".2f"), "-0.00");
  assert.equal(json.dumps([py.fl(-0), py.fl(1e20), 1e-7]), "[-0.0, 1e+20, 1e-07]");
});
