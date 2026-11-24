// 第一阶段的引擎实现：启动 Python 运行 py/bridge.py，标准输入写请求，标准输出读结果。
//
// Python 路径取环境变量 DRAW_DIAGRAM_PYTHON，默认 python3。需要 Python 3.11+ 和 Pillow。

import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DiagramError } from "../cli.js";

const BRIDGE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "py", "bridge.py");
const TIMEOUT_MS = 120_000;

export function call(request) {
  const python = process.env.DRAW_DIAGRAM_PYTHON || "python3";
  const r = spawnSync(python, ["-I", "-B", BRIDGE], {
    input: JSON.stringify(request),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: TIMEOUT_MS,
  });
  if (r.error) {
    const why = r.error.code === "ENOENT" ? `${python} wasn't found` : r.error.code === "ETIMEDOUT" ? `it ran longer than ${TIMEOUT_MS / 1000} s` : r.error.message;
    throw new DiagramError(`The layout engine couldn't run: ${why}. Set DRAW_DIAGRAM_PYTHON to a Python 3.11+ with Pillow.`, "engine_unavailable");
  }
  if (r.status !== 0) {
    const tail = (r.stderr || "").trim().split("\n").slice(-3).join("\n");
    throw new DiagramError(`The layout engine failed (exit ${r.status}):\n${tail}`, "engine_failed");
  }
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    throw new DiagramError(`The layout engine returned something that isn't JSON:\n${r.stdout.slice(0, 300)}`, "engine_failed");
  }
  if (out.error) {
    const { code, message, ...details } = out.error;
    throw new DiagramError(message, code, details);
  }
  return out;
}
