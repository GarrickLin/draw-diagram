// convert：Mermaid / PlantUML / draw.io CSV / draw.io XML 转 .drawio。

import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { createDrawio } from "../convert.js";
import { UsageError, DiagramError, readStdin } from "../cli.js";

export async function run(opts, io) {
  const input = opts._[0];
  if (input === "-" && !opts.output) {
    throw new UsageError("With stdin input, pass -o <file>.drawio.");
  }
  let source;
  if (input === "-") {
    source = await readStdin(io.stdin);
  } else {
    try {
      source = readFileSync(resolve(io.cwd, input), "utf8");
    } catch (e) {
      throw new DiagramError(`Can't read ${input}: ${e.code || e.message}`, "input_unreadable");
    }
  }
  const result = await createDrawio(source, { format: opts.format, name: opts.name });
  const output = resolve(io.cwd, opts.output || basename(input, extname(input)) + ".drawio");
  writeFileSync(output, result.content, "utf8");

  const type = result.type || result.format;
  const text = [`${output}: ${type}` + (result.warnings.length ? `, ${result.warnings.length} warning(s)` : "")]
    .concat(result.warnings.map((w) => `  warning: ${w}`))
    .join("\n");
  return {
    text,
    json: { output, format: result.format, type: result.type ?? null, warnings: result.warnings },
  };
}
