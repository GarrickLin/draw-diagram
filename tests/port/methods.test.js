// 静态检查：silicon 模块里调用的每个方法名，运行时都有实现。转译器拒绝不认识的语法，
// 而方法到运行时才查，没实现的方法会在测试没走到的路径上才出错，所以在这里一次查全。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, ENGINE, SILICON } from "./helpers.js";

const hasPython3 = spawnSync("python3", ["-c", "import sys; assert sys.version_info >= (3, 12)"]).status === 0;

test("every method the silicon modules call is implemented", { skip: hasPython3 ? false : "no python3 >= 3.12" }, async () => {
  const modules = readFileSync(join(ROOT, "tools", "port", "modules.txt"), "utf8").split(/\s+/).filter(Boolean);
  const r = spawnSync("python3", ["-I", join(import.meta.dirname, "method_calls.py"), join(SILICON, "silicon_canvas"), ...modules], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const { calls, defined } = JSON.parse(r.stdout);

  const py = await import(join(ENGINE, "py", "runtime.js"));
  const re = await import(join(ENGINE, "py", "re.js"));
  const pathlib = await import(join(ENGINE, "py", "pathlib.js"));
  const io = await import(join(ENGINE, "py", "io.js"));
  const pil = await import(join(ENGINE, "py", "pil.js"));
  const hashlib = await import(join(ENGINE, "py", "hashlib.js"));
  const have = new Set([...py.methodNames(), ...defined, "fromkeys" /* dict.fromkeys: the transpiler maps it */]);
  const objects = [re.compile("x"), re.compile("x").match("x"), new pathlib.Path("."), new io.BytesIO(), pil.ImageDraw.Draw(pil.Image.new()), new py.Deque(), hashlib.sha256(Buffer.from("")), pil.Image.new(), pathlib.open(join(ENGINE, "silicon", "catalog.json"))];
  for (const o of objects) {
    for (let p = Object.getPrototypeOf(o); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      for (const n of Object.getOwnPropertyNames(p)) have.add(n);
    }
  }
  const missing = Object.entries(calls).filter(([name]) => !have.has(name));
  assert.deepEqual(missing, [], "called but not implemented (name, first call)");
  assert.ok(Object.keys(calls).length > 50, `only ${Object.keys(calls).length} method names found`);
});
