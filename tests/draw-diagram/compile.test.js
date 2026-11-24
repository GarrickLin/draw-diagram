// compile：从规格到 .drawio 的完整流程。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runJson, run, tmp, loadSpec, countCells, EXAMPLES, FIXTURES } from "./helpers.js";
import { fileName } from "../../plugins/draw-diagram/skills/draw-diagram/scripts/lib/commands/compile.js";


/** 在新目录里 prepare + compile 一个规格文件。 */
function build(path, extra = []) {
  const cwd = tmp();
  const { spec, description } = loadSpec(path);
  writeFileSync(join(cwd, "spec.json"), JSON.stringify(spec));
  const prep = runJson(["prepare", "--description", description], { cwd });
  assert.equal(prep.status, 0, prep.stdout);
  const out = runJson(["compile", "--prep", prep.json.id, "--spec", "spec.json", ...extra], { cwd });
  return { cwd, prep: prep.json, out };
}

test("file names come from the title", () => {
  assert.equal(fileName("GPU Architecture Overview"), "gpu-architecture-overview.drawio");
  assert.equal(fileName("DMA 控制器状态机"), "dma.drawio");
  assert.equal(fileName("控制器"), "diagram.drawio");
});

test("acceptance 1: soc and gpu compile to drawio files", () => {
  for (const name of ["soc", "gpu"]) {
    const { out } = build(join(EXAMPLES, `${name}.json`));
    assert.equal(out.status, 0, out.stdout);
    assert.equal(out.json.kind, "publication");
    const xml = readFileSync(out.json.output, "utf8");
    assert.match(xml, /^<mxfile /);
    assert.ok(countCells(xml).edges > 0);
  }
});

test("acceptance 2: the attention dataflow keeps every tensor and operator", () => {
  const { out } = build(join(EXAMPLES, "attention-dataflow.json"));
  assert.equal(out.json.kind, "algorithm");
  const xml = readFileSync(out.json.output, "utf8");
  for (const id of ["q", "k", "v", "mask", "scores", "scale_mask", "softmax", "weighted", "output"]) assert.match(xml, new RegExp(`id="${id}"`));
  assert.equal(countCells(xml).edges, 8);
});

test("acceptance 3: compiling the same spec twice gives the same bytes", () => {
  const a = build(join(EXAMPLES, "soc.json"));
  const b = build(join(EXAMPLES, "soc.json"));
  assert.equal(readFileSync(a.out.json.output, "utf8"), readFileSync(b.out.json.output, "utf8"));
  assert.equal(a.out.json.id, b.out.json.id);
});

test("acceptance 4: a Chinese description and spec give Chinese labels", () => {
  const { prep, out } = build(join(FIXTURES, "dma-fsm-zh.json"), ["-o", "dma.drawio"]);
  assert.equal(prep.language, "zh");
  const xml = readFileSync(out.json.output, "utf8");
  for (const label of ["空闲", "取描述符", "传输", "完成", "描述符有效"]) assert.match(xml, new RegExp(label));
  assert.match(xml, /<diagram id="page-1" name="DMA 控制器状态机">/);
});

test("acceptance 5 is the prepare refusal test (prepare.test.js)", () => {});

test("an invalid spec lists what to fix and writes nothing", () => {
  const cwd = tmp();
  const prep = runJson(["prepare", "--description", "GPU overview"], { cwd });
  writeFileSync(join(cwd, "bad.json"), JSON.stringify({ title: "x", category: "architecture", nodes: [{ id: "a", label: "A", kind: "compute" }], edges: [{ source: "a", target: "zz" }] }));
  const r = runJson(["compile", "--prep", prep.json.id, "--spec", "bad.json"], { cwd });
  assert.equal(r.status, 1);
  assert.equal(r.json.error.code, "spec_invalid");
  assert.match(r.json.error.message, /edges\[0\]\.target/);
  assert.ok(!existsSync(join(cwd, "x.drawio")));
});

test("a spec in a code fence is accepted", () => {
  const cwd = tmp();
  const { spec, description } = loadSpec(join(EXAMPLES, "gpu.json"));
  writeFileSync(join(cwd, "spec.md"), "Here it is:\n```json\n" + JSON.stringify(spec, null, 2) + "\n```\n");
  const prep = runJson(["prepare", "--description", description], { cwd });
  assert.equal(runJson(["compile", "--prep", prep.json.id, "--spec", "spec.md"], { cwd }).status, 0);
});

test("a revision with --previous and --feedback carries the previous spec", () => {
  const { cwd, out } = build(join(EXAMPLES, "gpu.json"));
  const r = runJson(["prepare", "--description", "GPU", "--previous", out.json.id, "--feedback", "make the L2 cache stand out"], { cwd });
  assert.equal(r.status, 0, r.stdout);
  const prep = JSON.parse(readFileSync(join(cwd, ".draw-diagram", `prep-${r.json.id}.json`), "utf8"));
  assert.equal(prep.context.feedback, "make the L2 cache stand out");
  assert.equal(prep.context.previous_spec.nodes.length, 10);
  assert.match(readFileSync(r.json.instructions, "utf8"), /revision_feedback/);
});

test("compile records what check needs", () => {
  const { cwd, out } = build(join(EXAMPLES, "gpu.json"));
  const state = JSON.parse(readFileSync(join(cwd, ".draw-diagram", `out-${out.json.id}.json`), "utf8"));
  assert.equal(state.output, out.json.output);
  assert.equal(state.quality.routes_complete, true);
  assert.deepEqual(state.deferred_labels, ["miss / spill / fill"]);
});

test("usage and state errors", () => {
  assert.equal(run(["compile", "--spec", "x.json"]).status, 2);
  const r = runJson(["compile", "--prep", "aaaaaaaaaaaa", "--spec", "x.json"]);
  assert.equal(r.status, 1);
  assert.equal(r.json.error.code, "state_missing");
});
