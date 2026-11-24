// check：几何检查、引擎标记和内容清单（PRD 第一阶段验收 6）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { runJson, tmp, ROOT, EXAMPLES, loadSpec, skipWithoutPython } from "./helpers.js";
import { checkPage } from "../../skills/draw-diagram/scripts/lib/check.js";
import { pages } from "../../skills/draw-diagram/scripts/lib/drawio-read.js";

const GOLDEN = join(ROOT, "tests", "draw-diagram", "golden");
const CELLS = '<mxCell id="0"/><mxCell id="1" parent="0"/>';
const page = (body) => `<mxGraphModel><root>${CELLS}${body}</root></mxGraphModel>`;
const box = (id, value, x, y, w, h, parent = "1", style = "rounded=1;html=1;whiteSpace=wrap;fontFamily=Helvetica;fontSize=12;") =>
  `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
const edge = (id, s, t) => `<mxCell id="${id}" style="html=1;" edge="1" parent="1" source="${s}" target="${t}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
const codes = (r) => r.errors.map((e) => e.code).sort();

test("acceptance 6: overlaps, overflow, escaping children and dangling edges are errors", () => {
  const xml = page(
    box("g", "Compute", 20, 20, 200, 120, "1", "swimlane;startSize=24;html=1;fontSize=12;") +
    box("a", "CPU", 10, 34, 120, 50, "g") +
    box("b", "DSP", 90, 60, 150, 50, "g") +
    box("c", "On-Chip Interconnect Fabric With Very Long Name", 320, 50, 90, 40, "1", "rounded=1;html=1;fontSize=12;") +
    box("d", "DRAM", 320, 200, 90, 40) +
    edge("e1", "a", "d") + edge("e2", "d", "zzz"),
  );
  const r = checkPage(xml);
  assert.deepEqual(codes(r), ["dangling_edge", "outside_container", "overlap", "text_overflow"]);
  assert.equal(r.warnings[0].code, "edge_crosses_shape");
});

test("the CLI exits 1 on errors and still prints the contents", () => {
  const cwd = tmp();
  writeFileSync(join(cwd, "bad.drawio"), page(box("a", "A", 0, 0, 80, 40) + box("b", "B", 40, 10, 80, 40)));
  const r = runJson(["check", "bad.drawio"], { cwd });
  assert.equal(r.status, 1);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.errors[0].code, "overlap");
  assert.deepEqual(r.json.inventory.nodes.map((n) => n.label), ["A", "B"]);
});

test("labels that wrap inside their box are fine; one that can't is not", () => {
  const ok = checkPage(page(box("a", "Peripheral Controllers UART SPI", 0, 0, 120, 80)));
  assert.deepEqual(codes(ok), []);
  const tooTall = checkPage(page(box("a", "Peripheral Controllers UART SPI I2C GPIO Timers", 0, 0, 90, 30)));
  assert.deepEqual(codes(tooTall), ["text_overflow"]);
  const noWrap = checkPage(page(box("a", "Peripheral Controllers", 0, 0, 90, 60, "1", "rounded=1;html=1;fontSize=12;")));
  assert.deepEqual(codes(noWrap), ["text_overflow"]);
});

test("Chinese labels are measured at one em per character", () => {
  assert.deepEqual(codes(checkPage(page(box("a", "共享缓存", 0, 0, 70, 30)))), []);
  assert.deepEqual(codes(checkPage(page(box("a", "共享缓存与显存控制器", 0, 0, 70, 20)))), ["text_overflow"]);
});

test("text labels, containers and their own children don't count as overlaps", () => {
  const xml = page(
    box("g", "Group", 0, 0, 200, 100, "1", "swimlane;startSize=24;html=1;fontSize=12;container=1;") +
    box("a", "A", 10, 30, 80, 40, "g") +
    box("t", "label over it", 5, 40, 100, 20, "1", "text;html=1;fontSize=12;"),
  );
  assert.deepEqual(codes(checkPage(xml)), []);
});

test("every golden diagram passes with no errors", () => {
  for (const f of readdirSync(GOLDEN).filter((x) => x.endsWith(".drawio"))) {
    const r = checkPage(pages(readFileSync(join(GOLDEN, f), "utf8"))[0].xml);
    assert.deepEqual(r.errors, [], f);
  }
});

test("convert output (flowchart, sequence, ER) passes too", async () => {
  const { createDrawio } = await import("../../skills/draw-diagram/scripts/lib/convert.js");
  for (const src of [
    "flowchart TD\n  A[Open login page] --> B{Credentials valid?}\n  B -->|Yes| C[Dashboard]\n  B -->|No| D[Show error]\n  D --> A",
    "sequenceDiagram\n  participant C as Client\n  participant S as Server\n  C->>S: request\n  alt ok\n    S-->>C: 200\n  else fail\n    S-->>C: 500\n  end",
    "erDiagram\n  USER ||--o{ ORDER : places\n  ORDER ||--|{ ITEM : contains",
  ]) {
    const { content } = await createDrawio(src);
    assert.deepEqual(checkPage(pages(content)[0].xml).errors, [], src.split("\n")[0]);
  }
});

test("the contents list names shapes once and keeps algorithm details", () => {
  const r = checkPage(pages(readFileSync(join(GOLDEN, "examples__online-attention-dataflow.drawio"), "utf8"))[0].xml);
  const online = r.inventory.nodes.find((n) => n.id === "online");
  assert.equal(online.label, "Online row normalization");
  assert.match(online.detail, /alpha = exp\(m - m_new\)/);
  const fsm = checkPage(pages(readFileSync(join(GOLDEN, "tests__fixtures__design_coverage__retry-controller.drawio"), "utf8"))[0].xml);
  assert.ok(!fsm.inventory.nodes.some((n) => n.id === "idle-initial"));
  assert.equal(fsm.inventory.nodes.find((n) => n.id === "idle").label, "IDLE (busy=0)");
});

test("a file compile made reports the labels the engine left out", { skip: skipWithoutPython }, () => {
  const cwd = tmp();
  const { spec, description } = loadSpec(join(EXAMPLES, "gpu.json"));
  writeFileSync(join(cwd, "spec.json"), JSON.stringify(spec));
  const prep = runJson(["prepare", "--description", description], { cwd });
  const out = runJson(["compile", "--prep", prep.json.id, "--spec", "spec.json", "-o", "gpu.drawio"], { cwd });
  const r = runJson(["check", "gpu.drawio"], { cwd });
  assert.equal(r.status, 0, JSON.stringify(r.json.errors));
  assert.ok(r.json.warnings.some((w) => w.code === "label_deferred" && /miss \/ spill \/ fill/.test(w.message)));
  // 拷到别处检查时没有 compile 记录，这条警告就没有
  const other = tmp();
  copyFileSync(out.json.output, join(other, "gpu.drawio"));
  assert.ok(!runJson(["check", "gpu.drawio"], { cwd: other }).json.warnings.some((w) => w.code === "label_deferred"));
});

test("unreadable XML and missing pages", () => {
  const cwd = tmp();
  writeFileSync(join(cwd, "bad.drawio"), "<mxfile><diagram>");
  const r = runJson(["check", "bad.drawio"], { cwd });
  assert.equal(r.status, 1);
  assert.equal(r.json.error.code, "syntax_error");
  writeFileSync(join(cwd, "ok.drawio"), page(box("a", "A", 0, 0, 80, 40)));
  assert.equal(runJson(["check", "ok.drawio", "--page", "3"], { cwd }).status, 2);
});
