// draw-diagram 的 convert 和 search（最初从已删除的 skills/drawio 的测试迁移过来）。
// 运行：node --test tests/draw-diagram/

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createDrawio, detectFormat, wrapAsMxFile } from "../../skills/draw-diagram/scripts/lib/convert.js";
import { searchShapes } from "../../skills/draw-diagram/scripts/lib/search.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILL = join(ROOT, "skills", "draw-diagram");
const CLI = join(SKILL, "scripts", "draw-diagram.js");

function run(args, input, cwd) {
  return spawnSync("node", [CLI, ...args], { input, cwd, encoding: "utf8" });
}

// ---- 格式识别 ----

test("detects each format", () => {
  assert.equal(detectFormat("<mxGraphModel><root/></mxGraphModel>"), "xml");
  assert.equal(detectFormat('```xml\n<mxfile version="1"></mxfile>\n```'), "xml");
  assert.equal(detectFormat("@startuml\nA -> B\n@enduml"), "plantuml");
  assert.equal(detectFormat("flowchart TD\n A --> B"), "mermaid");
  assert.equal(detectFormat("graph LR\n A --> B"), "mermaid");
  assert.equal(detectFormat("sequenceDiagram\n A->>B: hi"), "mermaid");
  assert.equal(detectFormat("erDiagram\n A ||--o{ B : has"), "mermaid");
  assert.equal(detectFormat("# label: %name%\nname,boss\nA,\nB,A"), "csv");
});

test("detects Mermaid behind frontmatter and directives", () => {
  assert.equal(detectFormat("---\ntitle: T\nconfig:\n  layout: elk\n---\nflowchart TD\n A-->B"), "mermaid");
  assert.equal(detectFormat("%%{init: {}}%%\nsequenceDiagram\n A->>B: x"), "mermaid");
});

test("an explicit format wins; an unknown one is rejected", () => {
  assert.equal(detectFormat("flowchart TD", "xml"), "xml");
  assert.throws(() => detectFormat("x", "png"), /Unknown format/);
});

test("text with commas but no # config line is not taken for CSV", () => {
  assert.equal(detectFormat("flowchat TD\n A --> B, C"), "mermaid");
  assert.equal(detectFormat("name,boss\nA,\nB,A"), "mermaid");
  assert.equal(detectFormat("name,boss\nA,\nB,A", "csv"), "csv");
});

test("a misspelled or missing header gets the converter's suggestion", async () => {
  await assert.rejects(() => createDrawio("flowchat TD\n A-->B"), /"flowchat" is not a Mermaid diagram type.*Fix:/s);
  await assert.rejects(() => createDrawio("just words"), /not a Mermaid diagram type/);
});

test("indented frontmatter still converts", async () => {
  const r = await createDrawio("  ---\n  title: My Diagram\n  ---\n  flowchart TD\n  A-->B");
  assert.equal(r.type, "flowchart");
});

test("plain CSV converts with an explicit format", async () => {
  const r = await createDrawio("name,boss\nA,\nB,A", { format: "csv" });
  assert.equal(r.format, "csv");
});

// ---- 文件包装 ----

test("wraps a model in an mxfile with one page", () => {
  const out = wrapAsMxFile("<mxGraphModel><root/></mxGraphModel>", "Login");
  assert.match(out, /^<mxfile /);
  assert.match(out, /<diagram id="page-1" name="Login">/);
  assert.equal(out.match(/<mxfile/g).length, 1);
});

test("leaves an mxfile as it is and escapes the page name", () => {
  const src = '<mxfile><diagram id="x"></diagram></mxfile>';
  assert.equal(wrapAsMxFile(src).trim(), src);
  assert.match(wrapAsMxFile("<mxGraphModel/>", 'a"&<'), /name="a&quot;&amp;&lt;"/);
});

// ---- 转换 ----

test("converts flowchart, sequence and ER Mermaid", async () => {
  const flow = await createDrawio("flowchart TD\n  A[Start] --> B{Ok?}\n  B --> C[End]");
  assert.equal(flow.type, "flowchart");
  assert.match(flow.content, /value="Start"/);
  assert.equal((flow.content.match(/edge="1"/g) || []).length, 2);

  assert.equal((await createDrawio("sequenceDiagram\n A->>B: hi")).type, "sequence");
  assert.equal((await createDrawio("erDiagram\n A ||--o{ B : has")).type, "er");
});

test("converts PlantUML and CSV", async () => {
  assert.equal((await createDrawio("@startuml\nAlice -> Bob: hi\n@enduml")).type, "sequence");
  const csv = await createDrawio("# label: %name%\nname,boss\nA,\nB,A");
  assert.equal(csv.format, "csv");
  assert.match(csv.content, /UserObject/);
});

test("conversion is deterministic", async () => {
  const src = "flowchart LR\n A-->B-->C\n B-->D";
  assert.equal((await createDrawio(src)).content, (await createDrawio(src)).content);
});

test("keeps non-ASCII labels", async () => {
  const r = await createDrawio("flowchart TD\n  A[开始] --> B[结束]");
  assert.match(r.content, /value="开始"/);
});

test("rejects Mermaid types that need draw.io's browser converter", async () => {
  for (const src of ["classDiagram\n class A", "gantt\n title T", "mindmap\n  root", "stateDiagram-v2\n [*] --> A"]) {
    await assert.rejects(() => createDrawio(src), /cannot be converted offline.*as draw\.io XML/s, src);
  }
});

test("passes on Mermaid syntax errors with the line and fix", async () => {
  await assert.rejects(() => createDrawio("flowchart TD\n  A --> "), /line 2.*Fix:/s);
});

test("rejects empty input", async () => {
  await assert.rejects(() => createDrawio("  "), /empty/);
  await assert.rejects(() => createDrawio(undefined), /empty/);
});

// ---- XML ----

const CELLS = '<mxCell id="0"/><mxCell id="1" parent="0"/>';

test("repairs fences, stray text and unescaped & in XML", async () => {
  const src = "Here you go:\n```xml\n<mxGraphModel><root>" + CELLS +
    '<mxCell id="a" value="R&D" style="html=1;" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell>' +
    "</root></mxGraphModel>\n```\nHope it helps.";
  const r = await createDrawio(src);
  assert.match(r.content, /value="R&amp;D"/);
  assert.doesNotMatch(r.content, /```|Here you go|Hope it helps/);
  assert.ok(r.warnings.some((w) => /text around the diagram/.test(w)));
});

test("leaves well-formed XML unchanged and without warnings", async () => {
  const xml = "<mxGraphModel><root>" + CELLS + "</root></mxGraphModel>";
  const r = await createDrawio(xml);
  assert.deepEqual(r.warnings, []);
  assert.ok(r.content.includes(xml));
});

test("rejects XML without the root cells", async () => {
  await assert.rejects(() => createDrawio("<mxGraphModel><root></root></mxGraphModel>"), /root cells/);
});

// ---- 形状搜索 ----

test("a library prefix restricts the search to that library", () => {
  const aws4 = searchShapes("aws4 lambda", 6);
  assert.equal(aws4.strong, true);
  assert.ok(aws4.results.length > 0);
  for (const r of aws4.results) assert.match(r.style, /mxgraph\.aws4\./);

  const aws3 = searchShapes("aws3 lambda", 6);
  for (const r of aws3.results) assert.match(r.style, /mxgraph\.aws3\./);
});

test("search results carry title, size and a usable style", () => {
  const [first] = searchShapes("kubernetes pod", 1).results;
  assert.equal(typeof first.title, "string");
  assert.ok(first.width > 0 && first.height > 0);
  assert.match(first.style, /kubernetes/);
});

test("library image paths become absolute URLs", () => {
  const { results } = searchShapes("azure2 functions", 6);
  const withImage = results.filter((r) => /image=/.test(r.style));
  assert.ok(withImage.length > 0);
  for (const r of withImage) assert.match(r.style, /image=https:\/\/app\.diagrams\.net\/img\/lib\//);
});

test("a query no shape fully matches is marked weak", () => {
  assert.equal(searchShapes("lambda pizza", 3).strong, false);
});

test("the limit is honoured and an empty query is rejected", () => {
  assert.ok(searchShapes("aws4", 2).results.length <= 2);
  assert.throws(() => searchShapes(" "), /empty/);
});

// ---- 命令行 ----

test("CLI converts stdin to the -o path and prints it", () => {
  const dir = mkdtempSync(join(tmpdir(), "draw-diagram-"));
  const r = run(["convert", "-", "-o", "flow.drawio"], "flowchart TD\n A-->B", dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), join(dir, "flow.drawio") + ": flowchart");
  assert.match(readFileSync(join(dir, "flow.drawio"), "utf8"), /<mxfile/);
});

test("CLI names the output after the input file", () => {
  const dir = mkdtempSync(join(tmpdir(), "draw-diagram-"));
  execFileSync("sh", ["-c", "printf 'erDiagram\\n A ||--o{ B : has\\n' > schema.mmd"], { cwd: dir });
  const r = run(["convert", "schema.mmd"], undefined, dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(dir, "schema.drawio")));
});

test("CLI exits 1 on a diagram error and 2 on a usage error", () => {
  const dir = mkdtempSync(join(tmpdir(), "draw-diagram-"));
  const bad = run(["convert", "-", "-o", "x.drawio"], "classDiagram\n class A", dir);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /cannot be converted offline/);
  assert.ok(!existsSync(join(dir, "x.drawio")), "no file is written on failure");

  assert.equal(run(["convert", "-"], "flowchart TD", dir).status, 2);
  assert.equal(run(["export", "a"], undefined, dir).status, 2);
  assert.equal(run([], undefined, dir).status, 2);
  assert.equal(run(["convert", "-", "-o"], "", dir).status, 2);
});

test("CLI search prints one block per query", () => {
  const r = run(["search", "aws4 lambda", "zzqqxx", "--limit", "2"]);
  assert.equal(r.status, 0, r.stderr);
  const blocks = r.stdout.split(/^# /m).filter(Boolean);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].trim().split("\n").length, 3);
  for (const line of blocks[0].trim().split("\n").slice(1)) {
    assert.equal(line.split("\t").length, 3);
  }
});

// ---- 分发 ----

test("the skill runs from a copy with no node_modules", () => {
  const dir = mkdtempSync(join(tmpdir(), "draw-diagram-copy-"));
  const copy = join(dir, "draw-diagram");
  cpSync(SKILL, copy, { recursive: true });
  rmSync(join(copy, "scripts", "node_modules"), { recursive: true, force: true });
  const r = spawnSync("node", [join(copy, "scripts", "draw-diagram.js"), "convert", "-", "-o", "a.drawio"], {
    input: "flowchart TD\n A-->B",
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
});

test("every complete Mermaid example in the reference converts", async () => {
  const md = readFileSync(join(SKILL, "references", "mermaid-reference.md"), "utf8");
  const blocks = [...md.matchAll(/```(?:mermaid)?\n([\s\S]*?)```/g)].map((m) => m[1]);
  // 只有一两行的片段（单独的 subgraph、linkStyle）不是完整的图，跳过
  const complete = blocks.filter((b) => /^\s*(flowchart|graph|sequenceDiagram|erDiagram)\b/m.test(b));
  assert.ok(complete.length >= 5, `found ${complete.length} examples`);
  for (const b of complete) {
    const r = await createDrawio(b);
    assert.ok(["flowchart", "sequence", "er"].includes(r.type), b);
  }
});
