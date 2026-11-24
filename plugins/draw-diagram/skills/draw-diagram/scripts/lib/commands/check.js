// check：检查 .drawio 的版面问题，列出内容清单。不看图。
//
// 三个来源：
// 1. 几何检查（lib/check.js）：重叠、文字溢出、超出容器、悬空连线、连线穿框；
// 2. 文件由 compile 生成时，读 .draw-diagram/out-*.json 里版面引擎的质量结果；
// 3. diagram-render 自己的检查：XML 能否读、近似画出的图形等。
// 有错误时退出码 1。内容清单每次都输出，供 agent 和用户原文核对。

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DiagramError, UsageError } from "../cli.js";
import { pages } from "../drawio-read.js";
import { checkPage } from "../check.js";
import { check as rendererCheck } from "../render.js";
import { findOutFor } from "../state.js";

function pickPage(all, wanted) {
  if (wanted === undefined) return 0;
  if (/^\d+$/.test(wanted)) {
    const n = +wanted;
    if (n >= 1 && n <= all.length) return n - 1;
  }
  const i = all.findIndex((p) => p.name === wanted || p.id === wanted);
  if (i >= 0) return i;
  throw new UsageError(`No page ${wanted}; the file has ${all.map((p, k) => `${k + 1} "${p.name}"`).join(", ")}.`);
}

export async function run(opts, io) {
  const input = resolve(io.cwd, opts._[0]);
  let text;
  try {
    text = readFileSync(input, "utf8");
  } catch (e) {
    throw new DiagramError(`Can't read ${opts._[0]}: ${e.code || e.message}`, "input_unreadable");
  }

  // diagram-render 先读一遍（只看 XML 能否读，页面由下面选）：读不了就没有后面的检查
  const read = await rendererCheck(text);
  if (!read.ok) {
    const e = read.meta.error || {};
    throw new DiagramError(`${e.message || "The file can't be read."}${e.line ? ` (line ${e.line})` : ""}`, e.code || "syntax_error", { line: e.line ?? null });
  }
  let all;
  try {
    all = pages(text);
  } catch (e) {
    throw new DiagramError(`The file can't be read: ${e.message}`, "syntax_error");
  }
  if (all.length === 0) throw new DiagramError("The file has no <mxGraphModel>.", "syntax_error");
  const index = pickPage(all, opts.page);
  const rc = index === 0 ? read : await rendererCheck(text, { page: String(index + 1) });
  const result = checkPage(all[index].xml);
  const errors = [...result.errors];
  const warnings = [...result.warnings];

  for (const w of rc.meta.warnings || []) {
    if (w.code === "edge_skipped") continue; // 悬空连线几何检查已报
    if (w.code === "pages_more") continue;
    warnings.push({ code: `renderer_${w.code}`, message: w.message });
  }

  const out = findOutFor(io.cwd, input);
  if (out) {
    for (const f of out.quality?.failed_routes || []) {
      errors.push({ code: "route_failed", message: `The layout engine couldn't route the connection ${f.source} → ${f.target}; it is missing from the diagram.` });
    }
    for (const label of out.deferred_labels || []) {
      warnings.push({ code: "label_deferred", message: `The connection label "${label}" didn't fit and isn't on the page.` });
    }
  }

  const inv = result.inventory;
  const lines = [];
  lines.push(`${input}${all.length > 1 ? ` (page ${index + 1} of ${all.length}: ${all[index].name})` : ""}: ` +
    `${errors.length} error(s), ${warnings.length} warning(s)`);
  for (const e of errors) lines.push(`  error: ${e.message}`);
  for (const w of warnings) lines.push(`  warning: ${w.message}`);
  lines.push("", `Contents (${inv.nodes.filter((n) => !n.container).length} shapes, ${inv.nodes.filter((n) => n.container).length} containers, ${inv.edges.length} connections) — compare with what the user asked for:`);
  for (const l of inv.lines) lines.push(`  ${l}`);
  if (inv.text.length) lines.push("  Text on the page: " + inv.text.map((t) => `"${t}"`).join(", "));
  if (errors.length) lines.push("", "Fix the errors, then check again.");

  return {
    code: errors.length ? 1 : 0,
    text: lines.join("\n"),
    json: { file: input, page: { index: index + 1, name: all[index].name }, errors, warnings, inventory: { nodes: inv.nodes, edges: inv.edges, text: inv.text } },
  };
}
