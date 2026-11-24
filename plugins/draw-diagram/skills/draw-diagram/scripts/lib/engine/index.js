// 规划和版面引擎的统一入口。命令层只调用这里的 prepare 和 compile。
//
// 引擎是 silicon-canvas 转成的 JS（lib/engine/js.js 加 silicon/），在本进程内运行，不需要 Python。
// 它和第一阶段的 Python 引擎逐字节一致，见 tests/port。

import { DiagramError } from "../cli.js";

async function call(request) {
  const engine = await import("./js.js");
  try {
    return await engine.call(request);
  } catch (e) {
    if (e instanceof DiagramError) throw e;
    // a crash inside the engine: what the Python bridge reported as a non-zero exit
    const where = String(e?.stack ?? "").split("\n").slice(0, 4).join("\n");
    throw new DiagramError(`The layout engine failed:\n${where || e}`, "engine_failed");
  }
}

/**
 * 根据用户描述生成写规格的说明。
 * @param {{description: string, language: "zh"|"en", feedback?: string, previous?: object|null, lock_structure?: boolean}} request
 * @returns {Promise<{messages: Array<{role: string, content: string}>, context: object, representation: object}>}
 */
export async function prepare(request) {
  return call({ op: "prepare", ...request });
}

/**
 * 校验规格并计算主图版面。
 * @param {{spec: object, context: object}} request
 * @returns {Promise<{layout: object}>}
 */
export async function compile(request) {
  return call({ op: "compile", ...request });
}
