#!/usr/bin/env node
// Regenerates docs/examples: each example as .drawio and .png, made with the skill's own CLI.
// Planned examples go through prepare → compile with a spec from tests/; direct examples convert
// Mermaid from docs/examples/src. Every result must pass `check`.
//
//   node tools/build_examples.mjs

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "plugins", "draw-diagram", "skills", "draw-diagram", "scripts", "draw-diagram.js");
const OUT = join(ROOT, "docs", "examples");
const UP = join(ROOT, "tests", "upstream", "silicon-canvas");

const PLANNED = [
  { name: "gpu-architecture", spec: join(UP, "examples", "gpu.json"), language: "en" },
  { name: "soc", spec: join(UP, "examples", "soc.json"), language: "en" },
  { name: "online-attention-dataflow", spec: join(UP, "examples", "online-attention-dataflow.json"), language: "en" },
  { name: "dma-state-machine", spec: join(ROOT, "tests", "draw-diagram", "fixtures", "dma-fsm.json"), language: "en" },
  { name: "ready-valid-timing", spec: join(UP, "tests", "fixtures", "design_coverage", "ready-valid-trace.json"), language: "en" },
  { name: "mesh-memory-noc", spec: join(UP, "tests", "fixtures", "design_coverage", "mesh-memory.json"), language: "en" },
];
const DIRECT = [
  { name: "release-pipeline", source: join(OUT, "src", "release-pipeline.mmd"), page: "Release pipeline" },
  { name: "online-store-schema", source: join(OUT, "src", "online-store.mmd"), page: "Online store schema" },
];

const work = mkdtempSync(join(tmpdir(), "draw-diagram-examples-"));
function cli(args) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--json"], { cwd: work, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`draw-diagram ${args.join(" ")} (exit ${r.status}):\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

function finish(name) {
  const drawio = join(OUT, `${name}.drawio`);
  cli(["check", drawio]);
  cli(["render", drawio, "-o", join(OUT, `${name}.png`), "--scale", "1.5"]);
  console.log(`${name}: ok`);
}

for (const ex of PLANNED) {
  const d = JSON.parse(readFileSync(ex.spec, "utf8"));
  const spec = d.spec && typeof d.spec === "object" ? d.spec : d;
  const specFile = join(work, `${ex.name}.spec.json`);
  writeFileSync(specFile, JSON.stringify(spec));
  const prep = cli(["prepare", "--description", d.description || spec.title, "--language", ex.language]);
  cli(["compile", "--prep", prep.id, "--spec", specFile, "-o", join(OUT, `${ex.name}.drawio`)]);
  finish(ex.name);
}
for (const ex of DIRECT) {
  cli(["convert", ex.source, "-o", join(OUT, `${ex.name}.drawio`), "-f", "mermaid", "-n", ex.page]);
  finish(ex.name);
}
