// render：WASM 渲染。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runJson, run, tmp, ROOT } from "./helpers.js";
import { needsCjk, render } from "../../plugins/draw-diagram/skills/draw-diagram/scripts/lib/render.js";

const GOLDEN = join(ROOT, "tests", "draw-diagram", "golden");
const NATIVE = process.env.DIAGRAM_RENDER_BIN || "/tmp/dr/pkg/diagram-render";

function sample(name) {
  const dir = tmp();
  writeFileSync(join(dir, name), readFileSync(join(GOLDEN, name)));
  return dir;
}

test("every golden drawio renders to PNG and SVG", async () => {
  const files = readdirSync(GOLDEN).filter((f) => f.endsWith(".drawio"));
  assert.ok(files.length >= 27);
  for (const f of files) {
    const text = readFileSync(join(GOLDEN, f), "utf8");
    for (const to of ["png", "svg"]) {
      const r = await render(text, { to });
      assert.ok(r.ok, `${f} ${to}: ${JSON.stringify(r.meta.error)}`);
      assert.ok(r.out.length > 100, f);
    }
  }
});

test("the CLI writes a PNG next to the input by default", () => {
  const cwd = sample("examples__gpu.drawio");
  const r = runJson(["render", "examples__gpu.drawio"], { cwd });
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.json.output, join(cwd, "examples__gpu.png"));
  assert.deepEqual([...readFileSync(r.json.output).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(r.json.scale, 2);
});

test("SVG and scale options", () => {
  const cwd = sample("examples__gpu.drawio");
  const svg = runJson(["render", "examples__gpu.drawio", "-o", "g.svg"], { cwd });
  assert.equal(svg.status, 0);
  assert.match(readFileSync(join(cwd, "g.svg"), "utf8"), /^<\?xml[\s\S]*<svg/);
  const big = runJson(["render", "examples__gpu.drawio", "-o", "g3.png", "--scale", "3"], { cwd });
  assert.equal(big.json.scale, 3);
});

test("Chinese labels use a local CJK font, or warn when there is none", () => {
  assert.ok(needsCjk("空闲"));
  assert.ok(!needsCjk("Idle → Done ±5%"));
  const cwd = sample("fixtures__dma-fsm-zh.drawio");
  const none = runJson(["render", "fixtures__dma-fsm-zh.drawio", "-o", "none.png"], { cwd, env: { DRAW_DIAGRAM_CJK_FONT: "none" } });
  assert.equal(none.status, 0);
  assert.equal(none.json.cjk_font, null);
  assert.equal(none.json.warnings.length, 1);
  assert.match(none.json.warnings[0], /No Chinese\/Japanese\/Korean font/);
  const found = runJson(["render", "fixtures__dma-fsm-zh.drawio", "-o", "zh.png"], { cwd });
  if (found.json.cjk_font) assert.deepEqual(found.json.warnings, []);
});

test("errors: bad XML exits 1 with the line, a bad option exits 2", () => {
  const cwd = tmp();
  writeFileSync(join(cwd, "bad.drawio"), "<mxfile><diagram>");
  const r = runJson(["render", "bad.drawio"], { cwd });
  assert.equal(r.status, 1);
  assert.equal(r.json.error.code, "syntax_error");
  assert.equal(r.json.error.line, 1);
  assert.equal(run(["render", "bad.drawio", "-o", "x.jpg"], { cwd }).status, 2);
  assert.equal(run(["render", "bad.drawio", "-o", "x.svg", "--scale", "2"], { cwd }).status, 2);
  assert.ok(!existsSync(join(cwd, "bad.png")));
});

test("SVG and Latin-only PNG match the official diagram-render binary byte for byte", { skip: existsSync(NATIVE) ? false : `no native binary at ${NATIVE}` }, () => {
  for (const name of ["examples__gpu.drawio", "examples__soc.drawio", "tests__fixtures__design_coverage__retry-controller.drawio", "examples__attention-dataflow.drawio"]) {
    const cwd = sample(name);
    for (const ext of ["svg", "png"]) {
      assert.equal(run(["render", name, "-o", `wasm.${ext}`], { cwd }).status, 0);
      const n = spawnSync(NATIVE, [join(cwd, name), "-o", join(cwd, `native.${ext}`)], { encoding: "utf8" });
      assert.equal(n.status, 0, n.stderr);
      assert.ok(readFileSync(join(cwd, `wasm.${ext}`)).equals(readFileSync(join(cwd, `native.${ext}`))), `${name} ${ext}`);
    }
  }
});

test("rendering opens no network connection", { skip: spawnSync("which", ["strace"]).status === 0 ? false : "no strace" }, () => {
  const cwd = sample("fixtures__dma-fsm-zh.drawio");
  const log = join(cwd, "net.log");
  const r = spawnSync("strace", ["-f", "-e", "trace=connect", "-o", log, process.execPath, join(ROOT, "plugins", "draw-diagram", "skills", "draw-diagram", "scripts", "draw-diagram.js"), "render", "fixtures__dma-fsm-zh.drawio"], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const inet = readFileSync(log, "utf8").split("\n").filter((l) => /connect\(/.test(l) && /AF_INET/.test(l));
  assert.deepEqual(inet, []);
});
