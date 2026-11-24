// 当前目录下 .draw-diagram/ 里的状态文件。
//
// prepare 写 prep-<id>.json（请求和引擎上下文）和 prep-<id>.md（给 agent 读的规格说明）；
// compile 写 out-<id>.json（规格、版面质量、生成的文件）。ID 是内容哈希的前 12 位，
// 同样的输入得到同样的 ID，重复运行会覆盖同一个文件。

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DiagramError } from "./cli.js";

export const DIR = ".draw-diagram";

/** 键排序后的 JSON，用于算哈希。 */
export function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.keys(value).sort().filter((k) => value[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
  }
  return JSON.stringify(value ?? null);
}

export function contentId(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 12);
}

export function stateDir(cwd) {
  const dir = join(cwd, DIR);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function statePath(cwd, kind, id, ext = "json") {
  return join(cwd, DIR, `${kind}-${id}.${ext}`);
}

export function writeState(cwd, kind, id, data) {
  stateDir(cwd);
  const path = statePath(cwd, kind, id);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
  return path;
}

export function readState(cwd, kind, id) {
  if (!/^[0-9a-f]{12}$/.test(String(id))) {
    throw new DiagramError(`"${id}" isn't a ${kind} ID: it is the 12-character ID ${kind === "prep" ? "prepare" : "compile"} printed.`, "state_missing");
  }
  const path = statePath(cwd, kind, id);
  if (!existsSync(path)) {
    throw new DiagramError(`No ${kind} ${id} in ${join(cwd, DIR)}. Run ${kind === "prep" ? "prepare" : "compile"} again in this directory.`, "state_missing");
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

/** compile 生成过这个文件时，返回那次的 out 记录（最近一次），否则 null。 */
export function findOutFor(cwd, file) {
  const dir = join(cwd, DIR);
  if (!existsSync(dir)) return null;
  const target = resolve(file);
  let found = null;
  let newest = -Infinity;
  for (const name of readdirSync(dir)) {
    if (!/^out-[0-9a-f]{12}\.json$/.test(name)) continue;
    const path = join(dir, name);
    try {
      const out = JSON.parse(readFileSync(path, "utf8"));
      const time = statSync(path).mtimeMs;
      if (out.output === target && time >= newest) {
        found = out;
        newest = time;
      }
    } catch {
      // 损坏的状态文件忽略
    }
  }
  return found;
}
