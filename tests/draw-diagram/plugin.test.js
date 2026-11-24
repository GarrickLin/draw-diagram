// 插件清单：Claude Code 和 Codex 的清单互相一致，插件市场指向的插件和技能都存在。
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SKILL } from "./helpers.js";

const json = (...p) => JSON.parse(readFileSync(join(ROOT, ...p), "utf8"));
const PLUGIN = join(ROOT, "plugins", "draw-diagram");

test("both plugin manifests name the same plugin and version", () => {
  const claude = json("plugins", "draw-diagram", ".claude-plugin", "plugin.json");
  const codex = json("plugins", "draw-diagram", ".codex-plugin", "plugin.json");
  assert.equal(claude.name, "draw-diagram");
  assert.equal(codex.name, claude.name);
  assert.equal(codex.version, claude.version);
  assert.match(claude.version, /^\d+\.\d+\.\d+$/);
  assert.equal(codex.description, claude.description);
  assert.ok(existsSync(join(PLUGIN, codex.skills, "draw-diagram", "SKILL.md")));
});

test("the marketplaces list the plugin as draw-diagram@draw-diagram", () => {
  const claude = json(".claude-plugin", "marketplace.json");
  const codex = json(".agents", "plugins", "marketplace.json");
  assert.equal(claude.name, "draw-diagram");
  assert.equal(codex.name, "draw-diagram");
  assert.deepEqual(claude.plugins.map((p) => [p.name, join(ROOT, p.source)]), [["draw-diagram", PLUGIN]]);
  assert.deepEqual(codex.plugins.map((p) => [p.name, join(ROOT, p.source.path)]), [["draw-diagram", PLUGIN]]);
});

test("the skill is where the plugin and npx skills look for it", () => {
  assert.equal(SKILL, join(PLUGIN, "skills", "draw-diagram"));
  const front = readFileSync(join(SKILL, "SKILL.md"), "utf8").match(/^---\nname: ([\w-]+)\n/);
  assert.equal(front?.[1], "draw-diagram", "SKILL.md name matches its folder");
  const paths = json("skills.sh.json").paths.map((p) => join(ROOT, p));
  assert.ok(paths.includes(join(PLUGIN, "skills")));
});
