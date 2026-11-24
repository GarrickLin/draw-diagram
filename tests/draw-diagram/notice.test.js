// NOTICE：提到的文件都存在；标为「未修改」的文件和上游逐字节一致；skill 里每个文件都有归属。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { SKILL, ROOT } from "./helpers.js";

const NOTICE = readFileSync(join(SKILL, "NOTICE"), "utf8");
const DRAWIO_SHARED = join(ROOT, "docs", "refs", "drawio-mcp", "shared");
const SILICON = join(ROOT, "docs", "refs", "silicon-canvas", "src", "silicon_canvas");

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
}

const same = (a, b) => readFileSync(a).equals(readFileSync(b));

test("draw.io files marked unmodified equal the upstream commit", { skip: existsSync(DRAWIO_SHARED) ? false : "no docs/refs/drawio-mcp" }, () => {
  const vendor = join(SKILL, "scripts", "vendor", "drawio");
  for (const f of files(vendor).filter((p) => p.endsWith(".js"))) {
    assert.ok(same(f, join(DRAWIO_SHARED, relative(vendor, f))), relative(SKILL, f));
  }
  assert.ok(same(join(SKILL, "scripts", "data", "shape-index.json"), join(ROOT, "docs", "refs", "drawio-mcp", "shape-search", "search-index.json")));
  for (const r of ["xml-essentials.md", "xml-reference.md", "style-reference.md"]) assert.ok(same(join(SKILL, "references", r), join(DRAWIO_SHARED, r)), r);
});

test("Silicon Canvas: the translator's source differs from upstream in the two patched files only", { skip: existsSync(SILICON) ? false : "no docs/refs/silicon-canvas" }, () => {
  const vendor = join(ROOT, "tools", "port", "silicon", "silicon_canvas");
  const changed = [];
  for (const f of files(vendor)) {
    const rel = relative(vendor, f);
    if (!same(f, join(SILICON, rel))) changed.push(rel);
  }
  assert.deepEqual(changed.sort(), ["publication_render.py", "structure_scene.py"]);
  const patch = readFileSync(join(ROOT, "tools", "port", "silicon", "silicon.patch"), "utf8");
  for (const f of changed) assert.match(patch, new RegExp(`\\+\\+\\+ b/src/silicon_canvas/${f}`));
  for (const gone of ["mcp_server.py", "provider.py", "service.py"]) assert.ok(!existsSync(join(vendor, gone)), gone);
  assert.ok(!existsSync(join(vendor, "fonts")));
});

test("Silicon Canvas: the skill carries its licence and unmodified data files", () => {
  const src = join(ROOT, "tools", "port", "silicon");
  const out = join(SKILL, "scripts", "lib", "engine", "silicon");
  assert.ok(same(join(src, "LICENSE"), join(out, "LICENSE")));
  assert.ok(same(join(src, "silicon_canvas", "catalog.json"), join(out, "catalog.json")));
  for (const f of readdirSync(join(out, "reference_images"))) assert.ok(same(join(src, "silicon_canvas", "reference_images", f), join(out, "reference_images", f)), f);
  const modules = readFileSync(join(ROOT, "tools", "port", "modules.txt"), "utf8").split(/\s+/).filter(Boolean);
  const js = readdirSync(out).filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3));
  assert.deepEqual(js.sort(), [...modules].sort());
  assert.match(NOTICE, new RegExp(`translation into JavaScript of ${modules.length} modules`));
});

test("licence files named in NOTICE exist", () => {
  for (const p of NOTICE.match(/scripts\/[\w/.-]+\/(LICENSE|NOTICE)\b/g)) assert.ok(existsSync(join(SKILL, p)), p);
});

test("every file in the skill belongs to a section of NOTICE", () => {
  const owners = [
    /^SKILL\.md$/, /^NOTICE$/, /^references\//,
    /^scripts\/(draw-diagram\.js|package\.json)$/, /^scripts\/lib\//,
    /^scripts\/data\/(shape-index|widths)\.json$/,
    /^scripts\/vendor\/drawio\//, /^scripts\/vendor\/diagram-render\//,
  ];
  for (const f of files(SKILL).map((p) => relative(SKILL, p))) {
    assert.ok(owners.some((re) => re.test(f)), f);
    assert.doesNotMatch(f, /__pycache__|\.pyc?$|node_modules/, f);
  }
});
