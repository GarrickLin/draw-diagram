// 生成物和 CPython 参考环境：引擎代码是转译器当前的输出，字宽表是构建脚本的输出，
// Python 引擎测出的字宽和 lib/text-width.js 相同。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, ENGINE, PYTHON, SILICON, skipWithoutPython } from "./helpers.js";
import { textWidth } from "../../skills/draw-diagram/scripts/lib/text-width.js";

const SCRIPTS = join(ROOT, "skills", "draw-diagram", "scripts");
const hasPython3 = spawnSync("python3", ["-c", "import sys; assert sys.version_info >= (3, 12)"]).status === 0;

test("lib/engine/silicon is what tools/port/transpile.py makes now", { skip: hasPython3 ? false : "no python3 >= 3.12" }, () => {
  const out = mkdtempSync(join(tmpdir(), "transpile-"));
  const modules = readFileSync(join(ROOT, "tools", "port", "modules.txt"), "utf8").split(/\s+/).filter(Boolean);
  const r = spawnSync("python3", ["-I", join(ROOT, "tools", "port", "transpile.py"), join(SILICON, "silicon_canvas"), out, ...modules], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  for (const m of modules) {
    assert.equal(readFileSync(join(out, `${m}.js`), "utf8"), readFileSync(join(ENGINE, "silicon", `${m}.js`), "utf8"), `${m}.js is stale: run tools/port/build_engine.sh`);
  }
  assert.deepEqual(readdirSync(join(ENGINE, "silicon")).filter((f) => f.endsWith(".js")).sort(), modules.map((m) => `${m}.js`).sort());
  rmSync(out, { recursive: true });
});

test("data/widths.json is what tools/widths/build_widths.py makes", { skip: skipWithoutPython }, () => {
  const dir = mkdtempSync(join(tmpdir(), "widths-"));
  const out = join(dir, "widths.json");
  const r = spawnSync(PYTHON, ["-I", join(ROOT, "tools", "widths", "build_widths.py"),
    join(SCRIPTS, "vendor", "diagram-render", "fonts"),
    join(SCRIPTS, "vendor", "drawio", "semantic", "text-width.js"), out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(out, "utf8"), readFileSync(join(SCRIPTS, "data", "widths.json"), "utf8"));
  rmSync(dir, { recursive: true });
});

test("the Python engine measures text exactly as lib/text-width.js", { skip: skipWithoutPython }, () => {
  const labels = ["On-Chip Interconnect", "共享缓存与显存", "Q·Kᵀ / √d", "L2 Cache 4MB", "α ≤ β → γ", "μs ±5%", "控制 Control 123", "⊕ unknown ∇", "\t tab", "", "x₀ + x₁²"];
  const code = `import json, os, sys
sys.path.insert(0, ${JSON.stringify(SILICON)})
os.environ["DRAW_DIAGRAM_WIDTHS"] = ${JSON.stringify(join(SCRIPTS, "data", "widths.json"))}
from silicon_canvas.publication_render import font
print(json.dumps([[font(s).getlength(t) for s in (14, 27, 34, 36)] for t in json.loads(sys.argv[1])]))`;
  const r = spawnSync(PYTHON, ["-I", "-B", "-c", code, JSON.stringify(labels)], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), labels.map((t) => [14, 27, 34, 36].map((s) => textWidth(t, s))));
});
