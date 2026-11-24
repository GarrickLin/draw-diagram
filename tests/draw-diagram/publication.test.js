// 架构图版面（新版 publication、旧版 legacy）转 draw.io。
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { publicationToDrawio } from "../../skills/draw-diagram/scripts/lib/layout/publication.js";
import { compileLayout, countCells, EXAMPLES, UPSTREAM } from "./helpers.js";

const FIX = join(UPSTREAM, "tests", "fixtures");

function cell(xml, id) {
  const m = xml.match(new RegExp(`<mxCell id="${id}"[^>]*>(<mxGeometry[^>]*>)`));
  assert.ok(m, `no cell ${id}`);
  const attr = (name, s) => s.match(new RegExp(`${name}="([^"]*)"`))?.[1];
  return { parent: attr("parent", m[0]), style: attr("style", m[0]), x: +attr("x", m[1]), y: +attr("y", m[1]), w: +attr("width", m[1]), h: +attr("height", m[1]) };
}

test("soc: subsystems become containers holding their modules", () => {
  const doc = compileLayout(join(EXAMPLES, "soc.json"));
  assert.equal(doc.kind, "publication");
  const { xml, stats } = publicationToDrawio(doc);
  const groups = doc.structure_layout.macro_nodes.filter((m) => m.children?.length);
  const children = groups.reduce((n, m) => n + m.children.length, 0);
  assert.equal(stats.containers, groups.length);
  assert.equal(stats.nodes, doc.structure_layout.macro_nodes.length - groups.length + children);
  assert.equal(stats.edges, 8);
  assert.equal(stats.labels, 2);
  assert.equal(countCells(xml).edges, 8);
  // CPU Cluster 是 Compute Subsystem 容器里的子节点
  assert.equal(cell(xml, "n_cpu").parent, "g_compute");
  assert.match(cell(xml, "g_compute").style, /^swimlane;/);
});

test("gpu: a label that didn't fit is a warning, not a cell", () => {
  const { xml, stats, warnings } = publicationToDrawio(compileLayout(join(EXAMPLES, "gpu.json")));
  assert.equal(stats.edges, 3);
  assert.ok(warnings.some((w) => w.includes("miss / spill / fill")));
  assert.doesNotMatch(xml, /miss \/ spill \/ fill/);
});

test("boxes keep the engine's proportions", () => {
  const doc = compileLayout(join(EXAMPLES, "gpu.json"));
  const { xml } = publicationToDrawio(doc);
  const { boxes } = doc.structure_layout;
  const { width: W, height: H } = doc.layout_scene;
  const s = 14 / doc.structure_layout.typography.body_px;
  for (const id of ["n_host", "g_cluster"]) {
    const c = cell(xml, id);
    assert.ok(Math.abs(c.x - boxes[id].x * W * s) < 0.01, id);
    assert.ok(Math.abs(c.w - boxes[id].width * W * s) < 0.01, id);
    assert.ok(Math.abs(c.h - boxes[id].height * H * s) < 0.01, id);
  }
});

test("edges follow the engine's bends and never re-route", () => {
  const doc = compileLayout(join(EXAMPLES, "gpu.json"));
  const { xml } = publicationToDrawio(doc);
  const route = doc.layout_scene.routes.find((r) => r.points.length > 2);
  const edge = xml.match(new RegExp(`<mxCell id="${route.id}"[^>]*edge="1"[^>]*>.*?</mxCell>`))[0];
  assert.doesNotMatch(edge, /edgeStyle=/);
  assert.equal((edge.match(/<mxPoint /g) || []).length, route.points.length - 2);
  assert.match(edge, /exitX=[\d.]+;exitY=[\d.]+;/);
});

test("ingress: shared containers, a representative inset and a module with detail lines", () => {
  const { xml, stats } = publicationToDrawio(compileLayout(join(FIX, "design_coverage", "repeated-ingress.json")));
  assert.equal(stats.edges, 9);
  assert.match(xml, /Control-plane updates/);
  assert.equal(cell(xml, "rx0").parent, "inset-representative-expansion");
});

test("legacy core layout: system frame, nested scopes and template slots", () => {
  const doc = compileLayout(join(FIX, "structure_benchmark", "core_source.json"));
  assert.equal(doc.kind, "legacy");
  const { xml, stats } = publicationToDrawio(doc);
  assert.equal(stats.edges, 9);
  assert.equal(doc.structure_layout.macro_nodes.length, 11);
  // 系统边框是最外层容器，Shared services 容器嵌在里面
  assert.equal(cell(xml, "grp-services").parent, "frame");
  assert.equal(cell(xml, "coordinator").parent, "grp-services");
  // worker0 展开成 template slots
  assert.match(xml, /value="Task entry"/);
});

test("legacy directed flow", () => {
  const { stats } = publicationToDrawio(compileLayout(join(FIX, "strategy_benchmark", "publication_result.json")));
  assert.equal(stats.nodes, 6);
  assert.equal(stats.containers, 2);
  assert.equal(stats.edges, 7);
});

test("the same layout gives the same XML", () => {
  const doc = compileLayout(join(EXAMPLES, "soc.json"));
  assert.equal(publicationToDrawio(doc).xml, publicationToDrawio(structuredClone(doc)).xml);
});
