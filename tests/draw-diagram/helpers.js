// 测试共用的路径和工具。
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SKILL = join(ROOT, "skills", "draw-diagram");
export const SCRIPTS = join(SKILL, "scripts");
export const CLI = join(SCRIPTS, "draw-diagram.js");
export const UPSTREAM = join(ROOT, "docs", "refs", "silicon-canvas");
export const EXAMPLES = join(UPSTREAM, "examples");
export const FIXTURES = join(ROOT, "tests", "draw-diagram", "fixtures");

/** 第一阶段的 Python 环境：DRAW_DIAGRAM_PYTHON，否则调试 venv。 */
export const PYTHON = process.env.DRAW_DIAGRAM_PYTHON || join(homedir(), ".cache", "draw-diagram", "venv", "bin", "python");
export const hasPython = existsSync(PYTHON);
export const skipWithoutPython = hasPython ? false : `no Python at ${PYTHON}`;

/** 运行命令行，返回 {status, stdout, stderr}。 */
export function run(args, { input, cwd, env } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    input,
    cwd: cwd ?? tmp(),
    encoding: "utf8",
    env: { ...process.env, DRAW_DIAGRAM_PYTHON: PYTHON, ...env },
  });
}

/** 运行命令行并解析 --json 输出。 */
export function runJson(args, options) {
  const r = run([...args, "--json"], options);
  let json;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    throw new Error(`not JSON (exit ${r.status}): ${r.stdout}\n${r.stderr}`);
  }
  return { ...r, json };
}

export function tmp(prefix = "draw-diagram-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** 在副本上运行一段 Python，返回标准输出。 */
export function python(code, args = []) {
  const r = spawnSync(PYTHON, ["-I", "-B", "-c", code, ...args], { encoding: "utf8", cwd: ROOT });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}

const BRIDGE = join(SCRIPTS, "py", "bridge.py");
const layoutCache = new Map();

/** 读取上游规格文件（顶层是规格，或带 spec/description 的对象）。 */
export function loadSpec(path) {
  const d = JSON.parse(readFileSync(path, "utf8"));
  const spec = d.spec && typeof d.spec === "object" ? d.spec : d;
  return { spec, description: d.description || spec.title || "diagram" };
}

/** 用 Python 桥 prepare + compile 一个规格文件，返回版面文档。结果在进程内缓存。 */
export function compileLayout(path, language = "en") {
  const key = path + "|" + language;
  if (layoutCache.has(key)) return layoutCache.get(key);
  const { spec, description } = loadSpec(path);
  const call = (req) => {
    const r = spawnSync(PYTHON, ["-I", "-B", BRIDGE], { input: JSON.stringify(req), encoding: "utf8", maxBuffer: 256 << 20 });
    if (r.status !== 0) throw new Error(r.stderr);
    const out = JSON.parse(r.stdout);
    if (out.error) throw new Error(JSON.stringify(out.error));
    return out;
  };
  const prep = call({ op: "prepare", description, language });
  const { layout } = call({ op: "compile", spec, context: prep.context });
  layoutCache.set(key, layout);
  return layout;
}

/** 数一下 XML 里的顶点和连线。 */
export function countCells(xml) {
  return {
    vertices: (xml.match(/vertex="1"/g) || []).length,
    edges: (xml.match(/edge="1"/g) || []).length,
  };
}
