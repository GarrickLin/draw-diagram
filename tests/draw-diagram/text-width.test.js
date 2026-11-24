// 字宽：命令行和版面引擎读同一份 data/widths.json，测出的宽度必须完全相同。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { textWidth, textEm } from "../../skills/draw-diagram/scripts/lib/text-width.js";
import { SCRIPTS, ROOT } from "./helpers.js";

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

test("the layout engine measures exactly as lib/text-width.js", async () => {
  const py = await import(join(SCRIPTS, "lib", "engine", "py", "runtime.js"));
  const render = await import(join(SCRIPTS, "lib", "engine", "silicon", "publication_render.js"));
  const engine = LABELS.map((t) => [14, 27, 34, 36].map((s) => py.nv(py.M.getlength(render.font(s), t))));
  const js = LABELS.map((t) => [14, 27, 34, 36].map((s) => textWidth(t, s)));
  assert.deepEqual(engine, js);
});

test("layout needs no font file", async () => {
  // 引擎只查字宽表，不读字体：四个示例的主图按完整版面排出（不会退化成 text-only）
  const py = await import(join(SCRIPTS, "lib", "engine", "py", "runtime.js"));
  const silicon = await import(join(SCRIPTS, "lib", "engine", "silicon", "engine.js"));
  const res = {};
  for (const name of ["soc", "gpu", "attention-dataflow", "online-attention-dataflow"]) {
    const r = silicon.compile_manual(py.fromJS(JSON.parse(readFileSync(join(ROOT, "tests", "upstream", "silicon-canvas", "examples", `${name}.json`), "utf8"))));
    res[name] = py.toJS(py.getitem(r, "figures")).find((f) => f.primary).layout_strategy;
  }
  assert.deepEqual(res, {
    soc: "publication-candidates",
    gpu: "publication-candidates",
    "attention-dataflow": "algorithm-dependency-plan",
    "online-attention-dataflow": "algorithm-dependency-plan",
  });
});
