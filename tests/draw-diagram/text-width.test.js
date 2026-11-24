// 字宽：Node 和 Python 版面引擎读同一份 data/widths.json，测出的宽度必须完全相同。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { textWidth, textEm } from "../../skills/draw-diagram/scripts/lib/text-width.js";
import { SCRIPTS, ROOT, PYTHON, skipWithoutPython, python, tmp } from "./helpers.js";
import { spawnSync } from "node:child_process";

const LABELS = [
  "On-Chip Interconnect", "共享缓存与显存", "Q·Kᵀ / √d", "L2 Cache 4MB", "α ≤ β → γ",
  "μs ±5%", "控制 Control 123", "⊕ unknown ∇", "\t tab", "", "Ω·m", "x₀ + x₁²",
];

test("ASCII widths are draw.io's Helvetica table", async () => {
  const { textWidth: drawio } = await import("../../skills/draw-diagram/scripts/vendor/drawio/semantic/text-width.js");
  for (const t of ["On-Chip Interconnect", "Memory Controller", "L2 Cache 4MB", "~!@#$%^&*()_+{}|:\"<>?"]) {
    assert.equal(textWidth(t, 100), drawio(t, 100), t);
    assert.equal(textWidth(t, 100, true), drawio(t, 100, true), t);
  }
});

test("wide characters are one em and symbols come from the extra table", () => {
  assert.equal(textEm("共享缓存"), 4000);
  assert.equal(textEm("√"), 549);
  assert.equal(textEm("→"), 1000);
  // Liberation Sans has no ⊕: it falls back to the width of "n"
  assert.equal(textEm("⊕"), textEm("n"));
  assert.equal(textEm("\t"), 0);
});

test("the layout engine measures exactly as lib/text-width.js", { skip: skipWithoutPython }, () => {
  const out = python(
    `import json, sys
sys.path.insert(0, "skills/draw-diagram/scripts/vendor/silicon")
from silicon_canvas.publication_render import font
labels = json.loads(sys.argv[1])
print(json.dumps([[font(s).getlength(t) for s in (14, 27, 34, 36)] for t in labels]))`,
    [JSON.stringify(LABELS)],
  );
  const py = JSON.parse(out);
  const js = LABELS.map((t) => [14, 27, 34, 36].map((s) => textWidth(t, s)));
  assert.deepEqual(js, py);
});

test("data/widths.json is what tools/widths/build_widths.py makes", { skip: skipWithoutPython }, () => {
  const dir = tmp();
  const out = join(dir, "widths.json");
  const r = spawnSync(PYTHON, ["-I", join(ROOT, "tools", "widths", "build_widths.py"),
    join(SCRIPTS, "vendor", "diagram-render", "fonts"),
    join(SCRIPTS, "vendor", "drawio", "semantic", "text-width.js"), out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(out, "utf8"), readFileSync(join(SCRIPTS, "data", "widths.json"), "utf8"));
  rmSync(dir, { recursive: true });
});

test("layout needs no font file", { skip: skipWithoutPython }, () => {
  // 副本里没有 fonts/，四个示例的主图仍按完整版面排出（不会退化成 text-only）
  const out = python(
    `import json, sys
sys.path.insert(0, "skills/draw-diagram/scripts/vendor/silicon")
from silicon_canvas import engine
res = {}
for name in ["soc", "gpu", "attention-dataflow", "online-attention-dataflow"]:
    r = engine.compile_manual(json.load(open(f"docs/refs/silicon-canvas/examples/{name}.json")))
    res[name] = next(f for f in r["figures"] if f.get("primary"))["layout_strategy"]
print(json.dumps(res))`,
  );
  assert.deepEqual(JSON.parse(out), {
    soc: "publication-candidates",
    gpu: "publication-candidates",
    "attention-dataflow": "algorithm-dependency-plan",
    "online-attention-dataflow": "algorithm-dependency-plan",
  });
});
