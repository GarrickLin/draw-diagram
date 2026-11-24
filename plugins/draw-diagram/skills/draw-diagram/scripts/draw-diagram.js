#!/usr/bin/env node
// draw-diagram skill 的命令行入口。只依赖 Node 20+ 内置模块和本目录下的代码。
// 命令说明：node draw-diagram.js --help

import { main } from "./lib/cli.js";

const code = await main(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: process.stdin,
  cwd: process.cwd(),
});
process.exitCode = code;
