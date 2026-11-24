// 基准存档：每个规格的版面文档和 .drawio。存档由第一阶段的 Python 引擎生成，JS 引擎必须产出完全
// 相同的结果；JS 和 CPython 的逐字节对照在 tests/port。
//
// 重新生成（规格、引擎或转换器有意改动之后）：
//   DRAW_DIAGRAM_UPDATE_GOLDEN=1 node --test tests/draw-diagram/golden.test.js
// 平时运行时，只比对不写入。

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { ROOT, SCRIPTS, UPSTREAM, FIXTURES, loadSpec } from "./helpers.js";
import { wrapAsMxFile } from "../../skills/draw-diagram/scripts/lib/convert.js";
import { publicationToDrawio } from "../../skills/draw-diagram/scripts/lib/layout/publication.js";
import { behaviorToDrawio } from "../../skills/draw-diagram/scripts/lib/layout/behavior.js";
import { algorithmToDrawio } from "../../skills/draw-diagram/scripts/lib/layout/algorithm.js";

const GOLDEN = join(ROOT, "tests", "draw-diagram", "golden");
const UPDATE = process.env.DRAW_DIAGRAM_UPDATE_GOLDEN === "1";
const engine = await import(join(SCRIPTS, "lib", "engine", "js.js"));
const CONVERT = { publication: publicationToDrawio, legacy: publicationToDrawio, behavior: behaviorToDrawio, algorithm: algorithmToDrawio };

/**
 * 上游 tests/fixtures 和 examples 里所有规格，加上本项目的 fixtures。不收的：
 * - commercial-*、sparse-acquisition：描述要求产品渲染或产品介绍插画，prepare 会拒绝；
 * - two-input-baseline-result：上游拿它当反例，规格违反「展开模块不能有同名独立节点」的规则。
 */
const EXCLUDED = /commercial-|sparse-acquisition|two-input-baseline-result/;
function specFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".json")) out.push(p);
    }
  };
  walk(join(UPSTREAM, "tests", "fixtures"));
  walk(join(UPSTREAM, "examples"));
  walk(FIXTURES);
  return out.filter((p) => {
    const d = JSON.parse(readFileSync(p, "utf8"));
    const spec = d && typeof d.spec === "object" ? d.spec : d;
    return spec && Array.isArray(spec.nodes) && !EXCLUDED.test(p);
  });
}

async function layoutFor(path) {
  const { spec, description } = loadSpec(path);
  const language = /[一-鿿]/.test(JSON.stringify(spec.nodes.map((n) => n.label))) ? "zh" : "en";
  const prep = await engine.call({ op: "prepare", description, language });
  return (await engine.call({ op: "compile", spec, context: prep.context })).layout;
}

function name(path) {
  return relative(ROOT, path).replace(/^tests\/upstream\/silicon-canvas\//, "").replace(/^tests\/draw-diagram\//, "").replace(/[/\\]/g, "__").replace(/\.json$/, "");
}

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

test("golden layouts and drawio files", async (t) => {
  const files = specFiles();
  assert.ok(files.length >= 27, `only ${files.length} specs`);
  if (UPDATE) mkdirSync(GOLDEN, { recursive: true });
  const index = {};
  for (const path of files) {
    const id = name(path);
    await t.test(id, async () => {
      const layout = await layoutFor(path);
      const convert = CONVERT[layout.kind];
      assert.ok(convert, `${id}: ${layout.kind}`);
      const drawio = wrapAsMxFile((await convert(layout)).xml, layout.spec.title || "Page-1");
      const layoutText = JSON.stringify(layout, null, 1) + "\n";
      index[id] = { kind: layout.kind, layout: sha(layoutText), drawio: sha(drawio) };
      const lp = join(GOLDEN, `${id}.layout.json`);
      const dp = join(GOLDEN, `${id}.drawio`);
      if (UPDATE) {
        writeFileSync(lp, layoutText);
        writeFileSync(dp, drawio);
      } else {
        assert.ok(existsSync(lp), `${id}: no golden; run with DRAW_DIAGRAM_UPDATE_GOLDEN=1`);
        assert.deepEqual(layout, JSON.parse(readFileSync(lp, "utf8")), `${id}: layout changed`);
        assert.equal(drawio, readFileSync(dp, "utf8"), `${id}: drawio changed`);
      }
    });
  }
  if (UPDATE) writeFileSync(join(GOLDEN, "index.json"), JSON.stringify(index, null, 1) + "\n");
});
