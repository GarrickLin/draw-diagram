#!/usr/bin/env node
// drawio skill 的命令行入口。只依赖 Node 内置模块和同目录下的 vendor/，
// 不需要 npm install，不访问网络。

import { createDrawio, searchShapes, FORMATS } from "./lib/core.js";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

const USAGE = `Usage:
  node drawio.js convert <input|-> [-o out.drawio] [-f format] [-n page-name]
  node drawio.js search <query> [<query> ...] [--limit n]

convert  Turn draw.io XML, Mermaid, PlantUML or draw.io CSV into a .drawio file.
         <input> is a file, or - to read stdin. The output defaults to
         <input>.drawio; with stdin, -o is required.
         -f: ${FORMATS.join(" | ")} | auto (default auto)
search   Look up draw.io shape styles, one result block per query.
         --limit: results per query (default 6)

Exit codes: 0 done, 1 the diagram did not convert, 2 usage error.`;

function usageError(message) {
  process.stderr.write(message + "\n\n" + USAGE + "\n");
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) usageError(`${a} needs a value.`);
      return argv[++i];
    };
    if (a === "-o" || a === "--output") opts.output = next();
    else if (a === "-f" || a === "--format") opts.format = next();
    else if (a === "-n" || a === "--name") opts.name = next();
    else if (a === "--limit") opts.limit = Number(next());
    else if (a === "-h" || a === "--help") opts.help = true;
    else opts._.push(a);
  }
  return opts;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function convert(opts) {
  const input = opts._[1];
  if (input === undefined) usageError("convert needs an input file, or - for stdin.");
  if (input === "-" && !opts.output) usageError("With stdin input, pass -o <file>.drawio.");

  const source = input === "-" ? await readStdin() : readFileSync(input, "utf8");
  const result = await createDrawio(source, { format: opts.format, name: opts.name });

  const output = resolve(opts.output || basename(input, extname(input)) + ".drawio");
  writeFileSync(output, result.content, "utf8");

  // 一行结果给 agent 读：路径、类型、警告数
  process.stdout.write(
    `${output}: ${result.type || result.format}` +
      (result.warnings.length ? `, ${result.warnings.length} warning(s)` : "") +
      "\n"
  );
  for (const w of result.warnings) process.stdout.write(`  warning: ${w}\n`);
}

function search(opts) {
  const queries = opts._.slice(1);
  if (queries.length === 0) usageError("search needs at least one query.");
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : 6;

  for (const query of queries) {
    const { results, strong } = searchShapes(query, limit);
    process.stdout.write(`# ${query}${results.length && !strong ? " (weak match)" : ""}\n`);
    if (results.length === 0) process.stdout.write("(no match)\n");
    for (const r of results) {
      process.stdout.write(`${r.title}\t${r.width}x${r.height}\t${r.style}\n`);
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE + "\n");
    return;
  }
  const command = opts._[0];
  if (command === "convert") return convert(opts);
  if (command === "search") return search(opts);
  usageError(command ? `Unknown command "${command}".` : "No command given.");
}

main().catch((err) => {
  process.stderr.write((err && err.message ? err.message : String(err)) + "\n");
  process.exit(1);
});
