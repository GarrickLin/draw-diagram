// 算法数据流：依赖计划交给语义引擎排版。
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { algorithmToDrawio, fullText } from "../../skills/draw-diagram/scripts/lib/layout/algorithm.js";
import { compileLayout, EXAMPLES, UPSTREAM } from "./helpers.js";

const CASES = [
  join(EXAMPLES, "attention-dataflow.json"),
  join(EXAMPLES, "online-attention-dataflow.json"),
  join(UPSTREAM, "tests", "fixtures", "design_coverage", "residual-projection.json"),
];

test("every tensor and operator is on the page and every relation is an edge", async () => {
  for (const path of CASES) {
    const doc = compileLayout(path);
    assert.equal(doc.kind, "algorithm", path);
    const plan = doc.algorithm_flow_plan;
    const { xml, stats } = await algorithmToDrawio(doc);
    assert.equal(stats.edges, plan.relations.length, path);
    for (const o of plan.objects) assert.match(xml, new RegExp(`id="${o.source_node_id}"`), `${path}: ${o.label}`);
    for (const r of plan.relations) {
      assert.match(xml, new RegExp(`edge="1"[^>]*source="${r.source}" target="${r.target}"`), `${path}: ${r.source} → ${r.target}`);
    }
    for (const g of plan.groups) assert.match(xml, new RegExp(`id="${g.id}" value="${g.label}"`), path);
    assert.doesNotMatch(xml, /fontSize=[\d.]+;(?![^"]*fontFamily=)[^"]*"/, "every sized style names a font");
  }
});

test("long formulas go to the tooltip, not the box", async () => {
  const doc = compileLayout(CASES[1]);
  const { xml } = await algorithmToDrawio(doc);
  const online = xml.match(/<UserObject id="online"[^>]*>/)[0];
  assert.match(online, /label="Online row normalization"/);
  assert.match(online, /tooltip="m_new = max\(m, rowmax\(S_j\)\)&#10;alpha = /);
  const o = doc.algorithm_flow_plan.objects.find((x) => x.source_node_id === "online");
  assert.equal(fullText(o).length, 5);
});

test("the same plan gives the same XML", async () => {
  const doc = compileLayout(CASES[0]);
  assert.equal((await algorithmToDrawio(doc)).xml, (await algorithmToDrawio(structuredClone(doc))).xml);
});
