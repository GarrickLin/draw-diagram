// search：在本地 draw.io 形状库里查样式。

import { searchShapes } from "../search.js";
import { UsageError } from "../cli.js";

export async function run(opts) {
  let limit = 6;
  if (opts.limit !== undefined) {
    limit = Number(opts.limit);
    if (!Number.isInteger(limit) || limit < 1) throw new UsageError("--limit needs a positive integer.");
  }
  const blocks = [];
  const lines = [];
  for (const query of opts._) {
    const { results, strong } = searchShapes(query, limit);
    blocks.push({ query, strong, results });
    lines.push(`# ${query}${results.length && !strong ? " (weak match)" : ""}`);
    if (results.length === 0) lines.push("(no match)");
    for (const r of results) lines.push(`${r.title}\t${r.width}x${r.height}\t${r.style}`);
  }
  return { text: lines.join("\n"), json: { queries: blocks } };
}
