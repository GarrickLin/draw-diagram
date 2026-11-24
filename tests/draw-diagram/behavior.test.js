// 行为图版面（状态机、流程、拓扑、时序）转 draw.io。
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { behaviorToDrawio } from "../../skills/draw-diagram/scripts/lib/layout/behavior.js";
import { compileLayout, countCells, FIXTURES, UPSTREAM, skipWithoutPython } from "./helpers.js";

const skip = skipWithoutPython;
const DC = join(UPSTREAM, "tests", "fixtures", "design_coverage");

test("DMA state machine: four states, five transitions including a self-loop", { skip }, () => {
  const doc = compileLayout(join(FIXTURES, "dma-fsm.json"));
  assert.equal(doc.kind, "behavior");
  assert.equal(doc.structure_layout.grammar, "state-machine");
  const { xml, stats } = behaviorToDrawio(doc);
  assert.deepEqual([stats.nodes, stats.edges], [4, 5]);
  assert.match(xml, /id="xfer" value="Transfer" style="ellipse;/);
  // 自环的首尾都在 Transfer 上
  assert.match(xml, /source="xfer" target="xfer"/);
  for (const label of ["start", "desc valid", "beats left", "last beat", "ack"]) assert.match(xml, new RegExp(`value="${label}"`));
});

test("retry controller: initial marker, state outputs and the reset note", { skip }, () => {
  const { xml, stats } = behaviorToDrawio(compileLayout(join(DC, "retry-controller.json")));
  assert.equal(stats.nodes, 6);
  assert.equal(stats.edges, 12);
  assert.match(xml, /id="idle-initial"/);
  assert.match(xml, /busy=0/);
  assert.match(xml, /Synchronous reset has highest priority/);
});

test("directed processes keep the engine's box sizes", { skip }, () => {
  for (const name of ["elastic-pipeline", "branched-tile-return"]) {
    const doc = compileLayout(join(DC, `${name}.json`));
    assert.equal(doc.structure_layout.grammar, "directed-process");
    const { xml, stats } = behaviorToDrawio(doc);
    assert.equal(stats.nodes, Object.keys(doc.structure_layout.positions).length, name);
    assert.equal(stats.edges, doc.structure_layout.routes.length, name);
    const [id, [w]] = Object.entries(doc.structure_layout.sizes)[0];
    const width = +xml.match(new RegExp(`<mxCell id="${id}"[^>]*><mxGeometry[^>]*width="([\\d.]+)"`))[1];
    assert.ok(Math.abs(width - (w * 14) / 32) < 0.01, name);
  }
});

test("logical topology", { skip }, () => {
  const { stats } = behaviorToDrawio(compileLayout(join(DC, "mesh-memory.json")));
  assert.deepEqual([stats.nodes, stats.edges], [12, 24]);
});

test("a sampled timing trace becomes a signal × sample table", { skip }, () => {
  const doc = compileLayout(join(DC, "ready-valid-trace.json"));
  assert.equal(doc.structure_layout.grammar, "sampled-timing");
  const { xml, stats } = behaviorToDrawio(doc);
  const rows = doc.structure_layout.rows.length;
  const cols = doc.structure_layout.axis.length;
  assert.equal(stats.samples, cols);
  assert.equal(countCells(xml).vertices, 1 + cols + rows * (1 + cols) + 1);
  assert.equal(countCells(xml).edges, 0);
});

test("the same layout gives the same XML", { skip }, () => {
  const doc = compileLayout(join(FIXTURES, "dma-fsm.json"));
  assert.equal(behaviorToDrawio(doc).xml, behaviorToDrawio(structuredClone(doc)).xml);
});
