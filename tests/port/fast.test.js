// 快速路径和 CPython 原版逐一对照：lib/engine/fast/structure_scene.js 的 astar 必须给出同样的路径。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ENGINE, PYTHON, SILICON, skipWithoutPython } from "./helpers.js";

const py = await import(join(ENGINE, "py", "runtime.js"));
const fast = await import(join(ENGINE, "fast", "structure_scene.js"));

function reference(count, seed) {
  const r = spawnSync(PYTHON, ["-I", "-B", join(import.meta.dirname, "astar_ref.py"), join(SILICON, "silicon_canvas", "structure_scene.py"), String(count), String(seed)], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

const point = ([x, y]) => py.T(x, y);
function env(c) {
  const blocked = py.set(c.blocked.map(point));
  const occupied = py.set(c.occupied.map(([a, b]) => py.T(point(a), point(b))));
  const colors = py.dict(...c.segment_colors.map(([[a, b], v]) => [py.T(point(a), point(b)), v]));
  return () => [c.maxx, c.maxy, blocked, occupied, colors];
}
const noGeneric = () => {
  throw new Error("the fast path fell back to the generic function");
};

for (const seed of [1, 2, 3]) {
  test(`astar matches CPython on 300 random grids (seed ${seed})`, { skip: skipWithoutPython }, () => {
    const cases = reference(300, seed);
    let reachable = 0;
    for (const [i, c] of cases.entries()) {
      const astar = fast.astar(noGeneric, env(c));
      const path = astar(point(c.start), point(c.goal), c.bounds ? py.T(...c.bounds) : null, c.line_color);
      const got = path === null ? null : path.map((p) => [...p]);
      assert.deepEqual(got, c.path, `case ${i}: ${JSON.stringify({ start: c.start, goal: c.goal, bounds: c.bounds, line_color: c.line_color })}`);
      if (path) {
        reachable++;
        assert.ok(path.every((p) => p instanceof py.Tuple), "points are tuples");
      }
    }
    assert.ok(reachable > 100, `only ${reachable} reachable cases`);
  });
}

test("astar mirrors follow later changes to the sets it reads", () => {
  const blocked = py.set();
  const occupied = py.set();
  const colors = py.dict();
  const astar = fast.astar(noGeneric, () => [10, 10, blocked, occupied, colors]);
  const before = astar(py.T(1, 1), py.T(5, 1));
  assert.equal(before.length, 5);
  for (let y = 0; y <= 10; y++) if (y !== 8) blocked.add(py.T(3, y));
  const after = astar(py.T(1, 1), py.T(5, 1));
  assert.ok(after.some((p) => p[1] === 8), "the path goes through the gap at y = 8");
  blocked.delete(py.T(3, 1));
  assert.equal(astar(py.T(1, 1), py.T(5, 1)).length, 5, "and back once the wall opens");
});

test("astar falls back to the generic function outside integer grids", () => {
  let calls = 0;
  const generic = () => {
    calls++;
    return "generic";
  };
  const sets = () => [10, 10, py.set(), py.set(), py.dict()];
  const astar = fast.astar(generic, sets);
  assert.equal(astar(py.T(py.F(1), 1), py.T(5, 1)), "generic", "a float start");
  assert.equal(astar(py.T(true, 1), py.T(5, 1)), "generic", "a bool start");
  assert.equal(astar([1, 1], py.T(5, 1)), "generic", "a list start");
  assert.equal(astar(py.T(1, 1), py.T(5, 1), "bounds"), "generic", "bounds that aren't numbers");
  assert.equal(fast.astar(generic, () => [10, 10, [], py.set(), py.dict()])(py.T(1, 1), py.T(5, 1)), "generic", "blocked isn't a set");
  assert.equal(calls, 5);
  assert.notEqual(astar(py.T(1, 1), py.T(5, 1)), "generic", "integers take the fast path");
});
