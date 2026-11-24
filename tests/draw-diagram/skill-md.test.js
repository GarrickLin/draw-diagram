// SKILL.md：frontmatter、提到的文件、命令和选项都存在。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createDrawio } from "../../skills/draw-diagram/scripts/lib/convert.js";
import { SKILL, run } from "./helpers.js";

const md = readFileSync(join(SKILL, "SKILL.md"), "utf8");

test("frontmatter: name matches the folder, description is specific", () => {
  const fm = md.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(fm);
  assert.match(fm[1], /^name: draw-diagram$/m);
  const desc = fm[1].match(/^description: "(.*)"$/m)[1];
  assert.ok(desc.length > 100 && desc.length <= 1024, `${desc.length} chars`);
  assert.match(desc, /\.drawio/);
});

test("every file SKILL.md names exists", () => {
  for (const ref of new Set(md.match(/references\/[\w.-]+\.md/g))) assert.ok(existsSync(join(SKILL, ref)), ref);
  assert.ok(existsSync(join(SKILL, "scripts", "draw-diagram.js")));
});

test("every command and option SKILL.md uses is accepted", () => {
  const help = run(["--help"]).stdout;
  for (const cmd of new Set([...md.matchAll(/\bdd (\w+)/g)].map((m) => m[1]))) {
    assert.match(help, new RegExp(`^  ${cmd} `, "m"), cmd);
    const usage = run([cmd, "--help"]).stdout;
    for (const opt of new Set([...md.matchAll(new RegExp(`dd ${cmd}\\b[^\\n\`]*`, "g"))].flatMap((m) => m[0].match(/--[a-z-]+|(?<=\s)-[a-z]\b/g) || []))) {
      if (opt === "--json") continue;
      assert.ok(usage.includes(opt), `${cmd} ${opt}`);
    }
  }
});

test("every error code in the fix table is one check can report", () => {
  const src = readFileSync(join(SKILL, "scripts", "lib", "check.js"), "utf8") + readFileSync(join(SKILL, "scripts", "lib", "commands", "check.js"), "utf8");
  for (const code of md.match(/\| `(\w+)` \|/g).map((m) => m.slice(3, -3))) assert.match(src, new RegExp(`"${code}"`), code);
});

test("the example in SKILL.md converts", async () => {
  const src = md.match(/<<'EOF'\n([\s\S]*?)\nEOF/)[1];
  assert.equal((await createDrawio(src)).type, "flowchart");
});

test("every complete Mermaid example in the reference converts", async () => {
  const ref = readFileSync(join(SKILL, "references", "mermaid-reference.md"), "utf8");
  const blocks = [...ref.matchAll(/```(?:mermaid)?\n([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => /^\s*(flowchart|graph|sequenceDiagram|erDiagram)\b/m.test(b));
  assert.ok(blocks.length >= 5);
  for (const b of blocks) assert.ok(["flowchart", "sequence", "er"].includes((await createDrawio(b)).type), b);
});
