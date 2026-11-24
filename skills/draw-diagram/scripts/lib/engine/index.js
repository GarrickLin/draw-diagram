// 规划和版面引擎的统一入口。命令层只调用这里的 prepare 和 compile。
//
// 第一阶段只有 Python 实现（lib/engine/python.js，调用 py/bridge.py）。第二阶段加入 JS 实现后，
// 用环境变量 DRAW_DIAGRAM_ENGINE=python|js 选择，两者输出的版面文档完全相同。

const IMPLEMENTATIONS = {
  python: () => import("./python.js"),
  js: () => import("./js.js"),
};

async function implementation() {
  const name = process.env.DRAW_DIAGRAM_ENGINE || "python";
  const load = IMPLEMENTATIONS[name];
  if (load === undefined) {
    throw new Error(`Unknown DRAW_DIAGRAM_ENGINE "${name}"; use one of: ${Object.keys(IMPLEMENTATIONS).join(", ")}.`);
  }
  return load();
}

/**
 * 根据用户描述生成写规格的说明。
 * @param {{description: string, language: "zh"|"en", feedback?: string, previous?: object|null}} request
 * @returns {Promise<{messages: Array<{role: string, content: string}>, context: object, representation: object}>}
 */
export async function prepare(request) {
  return (await implementation()).call({ op: "prepare", ...request });
}

/**
 * 校验规格并计算主图版面。
 * @param {{spec: object, context: object}} request
 * @returns {Promise<{layout: object}>}
 */
export async function compile(request) {
  return (await implementation()).call({ op: "compile", ...request });
}
