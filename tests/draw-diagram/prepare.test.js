// prepare：语言、拒绝渲染类请求、确定的 ID。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runJson, run, tmp } from "./helpers.js";
import { detectLanguage } from "../../plugins/draw-diagram/skills/draw-diagram/scripts/lib/commands/prepare.js";


function request(json) {
  const md = readFileSync(json.instructions, "utf8");
  return JSON.parse(md.slice(md.indexOf("```json\n") + 8, md.lastIndexOf("```")));
}

test("language follows the description", () => {
  assert.equal(detectLanguage("画一张 GPU 架构图"), "zh");
  assert.equal(detectLanguage("GPU overview"), "en");
});

test("a Chinese description asks for Chinese labels, an English one for English", () => {
  const cwd = tmp();
  const zh = runJson(["prepare", "--description", "画一张 GPU 架构总览"], { cwd });
  assert.equal(zh.status, 0, zh.stdout + zh.stderr);
  assert.equal(zh.json.language, "zh");
  assert.equal(request(zh.json).image_label_language, "zh");
  const en = runJson(["prepare", "--description", "A GPU architecture overview"], { cwd });
  assert.equal(request(en.json).image_label_language, "en");
  assert.equal(runJson(["prepare", "--description", "GPU", "--language", "zh"], { cwd }).json.language, "zh");
});

test("the instructions are about draw.io, not an Image Gen prompt", () => {
  const r = runJson(["prepare", "--description", "GPU overview"], { cwd: tmp() });
  const md = readFileSync(r.json.instructions, "utf8");
  assert.doesNotMatch(md, /Image Gen prompt/);
  assert.match(md, /editable draw\.io diagram/);
  assert.match(md, new RegExp(`compile --prep ${r.json.id} --spec`));
});

test("product renders and spatial illustrations are refused", () => {
  for (const [d, rep] of [["做一张芯片封装的商业产品渲染图，金属质感", "product_render"], ["用剖面插画展示 SoC 的空间结构", "system_illustration"]]) {
    const r = runJson(["prepare", "--description", d]);
    assert.equal(r.status, 1);
    assert.equal(r.json.error.code, "unsupported_representation");
    assert.equal(r.json.error.representation, rep);
  }
});

test("the same request gets the same ID", () => {
  const cwd = tmp();
  const a = runJson(["prepare", "--description", "GPU overview"], { cwd });
  const b = runJson(["prepare", "--description", "GPU overview"], { cwd });
  assert.match(a.json.id, /^[0-9a-f]{12}$/);
  assert.equal(a.json.id, b.json.id);
  assert.notEqual(runJson(["prepare", "--description", "SoC overview"], { cwd }).json.id, a.json.id);
});

test("usage errors exit 2", () => {
  assert.equal(run(["prepare"]).status, 2);
  assert.equal(run(["prepare", "--description", "a", "--description-file", "b"]).status, 2);
  assert.equal(run(["prepare", "--description", "a", "--feedback", "b"]).status, 2);
  assert.equal(run(["prepare", "--description", "a", "--language", "fr"]).status, 2);
});

test("--previous names a compile that must exist", () => {
  const r = runJson(["prepare", "--description", "a", "--previous", "000000000000", "--feedback", "x"]);
  assert.equal(r.status, 1);
  assert.equal(r.json.error.code, "state_missing");
});
