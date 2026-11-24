// 样式表：每种类型的样式固定，全部使用 Helvetica。
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeStyle, edgeStyle, containerStyle, labelStyle, fmt } from "../../plugins/draw-diagram/skills/draw-diagram/scripts/lib/layout/styles.js";
import { Page, esc, htmlLabel } from "../../plugins/draw-diagram/skills/draw-diagram/scripts/lib/layout/xml.js";

const NODE_KINDS = ["compute", "memory", "io", "control", "stage", "decision", "state", "event", "signal"];
const EDGE_KINDS = ["data", "control", "feedback", "clock", "relation"];

test("every node and edge kind has a fixed Helvetica style", (t) => {
  const styles = {};
  for (const k of NODE_KINDS) styles["node:" + k] = nodeStyle(k, { fontSize: 14 });
  for (const r of ["tensor", "operator", "reduction", "state", "storage", "index", "decision"]) styles["role:" + r] = nodeStyle("compute", { fontSize: 14, role: r });
  for (const k of EDGE_KINDS) styles["edge:" + k] = edgeStyle(k, { fontSize: 12 });
  styles.container = containerStyle({ fontSize: 14, startSize: 26 });
  styles.label = labelStyle({ fontSize: 12 });
  for (const [name, s] of Object.entries(styles)) {
    assert.match(s, /fontFamily=Helvetica;/, name);
    assert.doesNotMatch(s, /edgeStyle=/, name);
  }
  t.assert.snapshot?.(styles);
  assert.match(styles["node:decision"], /^rhombus;/);
  assert.match(styles["edge:control"], /dashed=1/);
  assert.doesNotMatch(styles["edge:data"], /dashed=1/);
  assert.match(styles["edge:relation"], /endArrow=none/);
  assert.notEqual(styles["node:compute"], styles["node:memory"]);
});

test("stroke style and direction modify the edge", () => {
  assert.match(edgeStyle("data", { fontSize: 12, strokeStyle: "dashed" }), /dashed=1/);
  assert.doesNotMatch(edgeStyle("control", { fontSize: 12, strokeStyle: "solid" }), /dashed=1/);
  assert.match(edgeStyle("data", { fontSize: 12, bidirectional: true }), /startArrow=block/);
});

test("numbers keep two decimals", () => {
  assert.equal(fmt(1.005), "1");
  assert.equal(fmt(12.3456), "12.35");
  assert.equal(fmt(-0.001), "0");
  assert.equal(fmt(40), "40");
});

test("XML escapes values and keeps IDs unique", () => {
  const p = new Page();
  const a = p.vertex({ id: "1", value: 'a<b>&"c"', style: "x", x: 0, y: 0, width: 10, height: 10 });
  const b = p.vertex({ id: "1", value: "", style: "x", x: 0, y: 0, width: 10, height: 10 });
  assert.equal(a, "1-2");
  assert.equal(b, "1-3");
  assert.match(p.model(), /value="a&lt;b&gt;&amp;&quot;c&quot;"/);
  assert.equal(esc("a\nb"), "a&#10;b");
  assert.equal(htmlLabel(["A<1>", "B"]), "A&lt;1&gt;<br>B");
});
