// 命令行框架：解析参数、分派子命令、统一退出码和 --json 输出。
//
// 退出码：0 成功；1 图本身有问题（转换失败、规格校验失败、check 发现错误）；2 命令用法错误。
// 每个命令都支持 --json：标准输出只有一个 JSON 对象，成功时 ok 为 true，失败时带 error。
// 不加 --json 时，结果写到标准输出，错误和警告写到标准错误。

/** 命令用法错误，退出码 2。 */
export class UsageError extends Error {}

/** 图本身的问题，退出码 1。`code` 是给 agent 判断的短标识，`details` 并入 JSON 输出。 */
export class DiagramError extends Error {
  constructor(message, code = "diagram_error", details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const COMMANDS = {
  prepare: {
    summary: "根据用户描述生成写规格的说明（架构、芯片、算法、状态机等图）",
    usage: "prepare --description <text> | --description-file <file> [--language zh|en] [--previous <id> --feedback <text>]",
    options: {
      description: { value: true },
      "description-file": { value: true },
      language: { value: true },
      previous: { value: true },
      feedback: { value: true },
    },
    positional: [0, 0],
  },
  compile: {
    summary: "校验规格、计算版面并生成 .drawio",
    usage: "compile --prep <id> --spec <spec.json> [-o out.drawio]",
    options: {
      prep: { value: true },
      spec: { value: true },
      output: { alias: "o", value: true },
    },
    positional: [0, 0],
  },
  convert: {
    summary: "把 Mermaid、PlantUML、draw.io CSV 或 draw.io XML 转成 .drawio",
    usage: "convert <input|-> [-o out.drawio] [-f xml|mermaid|plantuml|csv|auto] [-n page-name]",
    options: {
      output: { alias: "o", value: true },
      format: { alias: "f", value: true },
      name: { alias: "n", value: true },
    },
    positional: [1, 1],
  },
  search: {
    summary: "在本地形状库里查 draw.io 样式，每个查询一段结果",
    usage: "search <query> [<query> ...] [--limit n]",
    options: { limit: { value: true } },
    positional: [1, Infinity],
  },
  check: {
    summary: "检查 .drawio 的版面问题，并列出内容清单",
    usage: "check <file.drawio> [--page n]",
    options: { page: { value: true } },
    positional: [1, 1],
  },
  render: {
    summary: "把 .drawio 渲染成 PNG 或 SVG",
    usage: "render <file.drawio> [-o out.png|out.svg] [--page n] [--scale n]",
    options: {
      output: { alias: "o", value: true },
      page: { value: true },
      scale: { value: true },
    },
    positional: [1, 1],
  },
};

const COMMON = {
  json: { value: false },
  help: { alias: "h", value: false },
};

export function usage() {
  const lines = ["Usage: node draw-diagram.js <command> [options] [--json]", "", "Commands:"];
  for (const [name, c] of Object.entries(COMMANDS)) {
    lines.push(`  ${c.usage}`);
    lines.push(`      ${c.summary}`);
  }
  lines.push("", "Exit codes: 0 done, 1 the diagram has a problem, 2 the command was wrong.");
  return lines.join("\n");
}

/**
 * 按命令的选项表解析参数。`-` 是位置参数（标准输入），`--` 之后全部是位置参数。
 * @returns {{_: string[], [key: string]: string|boolean}}
 */
export function parseArgs(argv, options) {
  const table = { ...COMMON, ...options };
  const byAlias = {};
  for (const [name, o] of Object.entries(table)) {
    if (o.alias) byAlias[o.alias] = name;
  }
  const opts = { _: [] };
  let rest = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (rest || a === "-" || !a.startsWith("-")) {
      opts._.push(a);
      continue;
    }
    if (a === "--") {
      rest = true;
      continue;
    }
    let name;
    let inline;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      name = eq < 0 ? a.slice(2) : a.slice(2, eq);
      inline = eq < 0 ? undefined : a.slice(eq + 1);
    } else {
      name = byAlias[a.slice(1)];
      if (name === undefined) throw new UsageError(`Unknown option ${a}.`);
    }
    const o = table[name];
    if (o === undefined) throw new UsageError(`Unknown option --${name}.`);
    if (!o.value) {
      if (inline !== undefined) throw new UsageError(`--${name} takes no value.`);
      opts[name] = true;
      continue;
    }
    if (inline !== undefined) {
      opts[name] = inline;
    } else if (i + 1 < argv.length) {
      opts[name] = argv[++i];
    } else {
      throw new UsageError(`${a} needs a value.`);
    }
  }
  return opts;
}

function commandUsage(name) {
  return `Usage: node draw-diagram.js ${COMMANDS[name].usage} [--json]`;
}

/**
 * 运行一次命令行。返回退出码，不直接调用 process.exit，便于测试。
 * @param {string[]} argv
 * @param {{stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, stdin: NodeJS.ReadableStream, cwd: string}} io
 */
export async function main(argv, io) {
  const name = argv[0];
  const json = argv.includes("--json");
  const fail = (code, err) => {
    if (json) {
      const error = { code: err.code || (code === 2 ? "usage" : "diagram_error"), message: err.message, ...(err.details || {}) };
      io.stdout.write(JSON.stringify({ ok: false, error }) + "\n");
    } else {
      io.stderr.write(err.message + "\n");
      if (code === 2) io.stderr.write("\n" + (COMMANDS[name] ? commandUsage(name) : usage()) + "\n");
    }
    return code;
  };

  if (name === undefined || name === "-h" || name === "--help" || name === "help") {
    (name === undefined ? io.stderr : io.stdout).write(usage() + "\n");
    return name === undefined ? 2 : 0;
  }
  const spec = COMMANDS[name];
  if (spec === undefined) {
    return fail(2, new UsageError(`Unknown command "${name}".`));
  }

  try {
    const opts = parseArgs(argv.slice(1), spec.options);
    if (opts.help) {
      io.stdout.write(commandUsage(name) + "\n");
      return 0;
    }
    const [min, max] = spec.positional;
    if (opts._.length < min || opts._.length > max) {
      throw new UsageError(min === max && min === 0 ? `${name} takes no positional arguments.` : `${name} needs ${min === max ? min : `at least ${min}`} argument(s).`);
    }
    const command = await import(`./commands/${name}.js`);
    const result = await command.run(opts, io);
    if (json) {
      io.stdout.write(JSON.stringify({ ok: (result.code ?? 0) === 0, ...result.json }) + "\n");
    } else {
      if (result.text) io.stdout.write(result.text.endsWith("\n") ? result.text : result.text + "\n");
      if (result.stderr) io.stderr.write(result.stderr.endsWith("\n") ? result.stderr : result.stderr + "\n");
    }
    return result.code ?? 0;
  } catch (err) {
    if (err instanceof UsageError) return fail(2, err);
    if (err instanceof DiagramError) return fail(1, err);
    // 转换器等抛出的普通错误也是图的问题，例如语法错误
    return fail(1, err);
  }
}

/** 读取标准输入的全部文本。 */
export async function readStdin(stdin) {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
