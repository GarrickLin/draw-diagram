// render：把 .drawio 渲染成 PNG 或 SVG。

import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve, dirname, join } from "node:path";
import { UsageError, DiagramError } from "../cli.js";
import { render } from "../render.js";

function outputFor(input, page) {
  const base = basename(input).replace(/\.drawio(\.xml)?$|\.dio$|\.xml$/i, "");
  return join(dirname(input), base + (page ? `-${String(page).replace(/[^\w.-]+/g, "_")}` : "") + ".png");
}

export async function run(opts, io) {
  const input = resolve(io.cwd, opts._[0]);
  let text;
  try {
    text = readFileSync(input, "utf8");
  } catch (e) {
    throw new DiagramError(`Can't read ${opts._[0]}: ${e.code || e.message}`, "input_unreadable");
  }
  const output = resolve(io.cwd, opts.output || outputFor(input, opts.page));
  const ext = extname(output).toLowerCase();
  if (ext !== ".png" && ext !== ".svg") throw new UsageError("-o must end in .png or .svg.");
  let scale = 0;
  if (opts.scale !== undefined) {
    scale = Number(opts.scale);
    if (!(scale > 0 && scale <= 8)) throw new UsageError("--scale is a number above 0, at most 8.");
    if (ext === ".svg") throw new UsageError("--scale applies to PNG only.");
  }

  const r = await render(text, { to: ext.slice(1), scale, page: opts.page });
  if (!r.ok) {
    const e = r.meta.error || {};
    const where = e.line ? ` (line ${e.line}${e.column ? `, column ${e.column}` : ""})` : "";
    throw new DiagramError(`${e.message || "The diagram couldn't be drawn."}${where}`, e.code || "render_failed", { hint: e.hint ?? null, line: e.line ?? null });
  }
  writeFileSync(output, r.out);

  const warnings = (r.meta.warnings || []).map((w) => w.message);
  if (r.cjk.needed && !r.cjk.font) {
    warnings.push("No Chinese/Japanese/Korean font was found on this computer, so those characters are drawn as boxes in the image (the .drawio file is fine). Set DRAW_DIAGRAM_CJK_FONT to a .ttf/.ttc/.otf file to fix it.");
  }
  // diagram-render 对中日韩字符总是说「由本机字体画出，图片可能因电脑而异」：找到字体时这是预期的，
  // 没找到时这句话不对（字画成了方框），两种情况都由上面那条提示代替
  const shown = warnings.filter((w) => !(r.cjk.needed && /aren't in the bundled fonts/.test(w)));
  const size = `${r.meta.width}×${r.meta.height}`;
  const lines = [`${output}: ${ext.slice(1)} ${size}` + (r.meta.scale ? ` @${r.meta.scale}x` : "")];
  for (const w of shown) lines.push(`  warning: ${w}`);
  if (ext === ".png") lines.push("Look at the image to review the diagram.");
  return {
    text: lines.join("\n"),
    json: { output, format: ext.slice(1), width: r.meta.width, height: r.meta.height, scale: r.meta.scale ?? null, page: r.meta.page ?? null, pages: r.meta.pages ?? [], cjk_font: r.cjk.font, warnings: shown },
  };
}
