// check 的几何检查和内容清单。不看图，只读 .drawio 的单元格。
//
// 错误（error）：同一容器里方框重叠、文字超出方框、子节点超出容器、连线端点不存在。
// 警告（warning）：连线穿过不相关的方框。
// 判定时容许 TOLERANCE 像素的误差，避免浮点和取整造成的误报。

import { cells as readCells, absolute, parseStyle } from "./drawio-read.js";
import { textWidth } from "./text-width.js";

const TOLERANCE = 1;
const LINE_HEIGHT = 1.2;

// 本来就画在其他形状上面或只是一条线的形状：不参与重叠和穿框判定
const OVERLAY_SHAPES = new Set(["text", "edgeLabel", "group", "line", "umlFrame", "umlLifeline", "partialRectangle"]);

function shapeName(c) {
  return c.style.shape || c.style._shape;
}

/** 有边框或填充、在版面上占地方的顶点；文字、连线标签、分组框、UML 帧、线条不算。 */
function isBox(c) {
  if (!c.vertex || !c.geo || c.geo.relative) return false;
  const s = c.style;
  if (OVERLAY_SHAPES.has(s._shape) || OVERLAY_SHAPES.has(s.shape)) return false;
  if (s.perimeter === "orthogonalPerimeter") return false; // 时序图的激活条，画在生命线上
  if (s.strokeColor === "none" && (s.fillColor === "none" || s.fillColor === undefined) && !s._shape) return false;
  return c.geo.w > 0 && c.geo.h > 0;
}

function isContainer(c) {
  const s = c.style;
  return s.container === "1" || s._shape === "swimlane" || s._shape === "group" || shapeName(c) === "umlFrame";
}

function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > TOLERANCE && h > TOLERANCE ? { w, h } : null;
}

function inside(outer, inner) {
  return inner.x >= outer.x - TOLERANCE && inner.y >= outer.y - TOLERANCE &&
    inner.x + inner.w <= outer.x + outer.w + TOLERANCE && inner.y + inner.h <= outer.y + outer.h + TOLERANCE;
}

function fontSize(c) {
  return +(c.style.fontSize || 12);
}

/** 标签需要的宽和高（像素）。wrap 时按可用宽度逐词换行，中日韩按字换行。 */
function textBox(lines, size, bold, maxWidth) {
  const out = [];
  for (const line of lines) {
    if (maxWidth === null || textWidth(line, size, bold) <= maxWidth) {
      out.push(line);
      continue;
    }
    // 拆成可断开的单元：空格分隔的词，以及单个中日韩字符
    const tokens = line.match(/[⺀-鿿가-힣＀-￯]|[^\s⺀-鿿가-힣＀-￯]+|\s+/g) || [];
    let cur = "";
    for (const t of tokens) {
      const next = cur + t;
      if (cur.trim() !== "" && textWidth(next.trimEnd(), size, bold) > maxWidth) {
        out.push(cur.trimEnd());
        cur = t.trimStart();
      } else {
        cur = next;
      }
    }
    if (cur.trim() !== "") out.push(cur.trimEnd());
  }
  const width = Math.max(0, ...out.map((l) => textWidth(l, size, bold)));
  return { width, height: out.length * size * LINE_HEIGHT, lines: out.length };
}

/** 方框内能放文字的区域：去掉内边距；swimlane 只算标题栏。 */
function textArea(c, box) {
  const s = c.style;
  const pad = 4 + +(s.spacing || 0);
  if (s._shape === "swimlane") {
    const start = +(s.startSize ?? 23);
    return s.horizontal === "0" ? { w: start - 2 * pad, h: box.h - 2 * pad } : { w: box.w - 2 * pad, h: start };
  }
  // 椭圆、菱形：draw.io 按外接矩形排文字，文字可以伸进曲边附近；可用区域取内接矩形（约 0.7 / 0.5）
  // 再放宽内边距，只有明显放不下才算错
  if (s._shape === "ellipse") return { w: box.w * Math.SQRT1_2, h: box.h * Math.SQRT1_2 + pad };
  if (s._shape === "rhombus") return { w: box.w * 0.5 + pad, h: box.h * 0.5 + pad };
  return { w: box.w - 2 * pad - +(s.spacingLeft || 0) - +(s.spacingRight || 0), h: box.h - 2 };
}

/** 线段 a→b 是否穿过方框内部（端点贴边不算）。 */
function segmentCrosses(a, b, box) {
  const inset = 2;
  const x0 = box.x + inset, y0 = box.y + inset, x1 = box.x + box.w - inset, y1 = box.y + box.h - inset;
  if (x1 <= x0 || y1 <= y0) return false;
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 >= t1) return false;
    }
  }
  return t1 - t0 > 1e-6;
}

function ancestors(all, id) {
  const out = new Set();
  let c = all.get(id);
  while (c && c.parent && !out.has(c.parent)) {
    out.add(c.parent);
    c = all.get(c.parent);
  }
  return out;
}

/** 连线的折线：起点中心 → 折点 → 终点中心；有 exit/entry 时用指定的出入点。 */
function edgePath(all, e, abs) {
  const src = abs.get(e.source);
  const tgt = abs.get(e.target);
  if (!src || !tgt) return null;
  const at = (box, x, y, fx, fy) => [box.x + (x !== undefined ? +x : fx) * box.w, box.y + (y !== undefined ? +y : fy) * box.h];
  const origin = e.parent && all.get(e.parent)?.vertex ? abs.get(e.parent) : { x: 0, y: 0 };
  const pts = e.points.map(([x, y]) => [x + origin.x, y + origin.y]);
  const first = pts[0] ?? [tgt.x + tgt.w / 2, tgt.y + tgt.h / 2];
  const last = pts[pts.length - 1] ?? [src.x + src.w / 2, src.y + src.h / 2];
  const s = e.style.exitX !== undefined ? at(src, e.style.exitX, e.style.exitY, 0.5, 0.5) : clipToBox(src, first);
  const t = e.style.entryX !== undefined ? at(tgt, e.style.entryX, e.style.entryY, 0.5, 0.5) : clipToBox(tgt, last);
  return [s, ...pts, t];
}

/** 从方框中心朝 toward 方向，与方框边界的交点。 */
function clipToBox(box, toward) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const dx = toward[0] - cx, dy = toward[1] - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const sx = dx !== 0 ? box.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? box.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return [cx + dx * s, cy + dy * s];
}

/**
 * 检查一页。
 * @param {string} pageXml
 * @returns {{errors: Array, warnings: Array, inventory: object}}
 */
export function checkPage(pageXml) {
  const all = readCells(pageXml);
  const errors = [];
  const warnings = [];
  const abs = new Map();
  for (const c of all.values()) if (c.vertex && c.geo) abs.set(c.id, absolute(all, c.id));
  const name = (id) => {
    const c = all.get(id);
    return c?.lines?.[0] ? `"${c.lines[0]}"` : `cell ${id}`;
  };

  // 同一父容器里的方框两两比较
  const byParent = new Map();
  for (const c of all.values()) {
    if (!isBox(c)) continue;
    if (!byParent.has(c.parent)) byParent.set(c.parent, []);
    byParent.get(c.parent).push(c);
  }
  for (const list of byParent.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const o = overlap(abs.get(list[i].id), abs.get(list[j].id));
        if (o) errors.push({ code: "overlap", cells: [list[i].id, list[j].id], message: `${name(list[i].id)} and ${name(list[j].id)} overlap by ${Math.round(o.w)}×${Math.round(o.h)} px.` });
      }
    }
  }

  // 子节点超出容器
  for (const c of all.values()) {
    if (!c.vertex || !c.geo || c.geo.relative) continue;
    const p = all.get(c.parent);
    if (!p || !p.vertex || !p.geo || !isContainer(p)) continue;
    if (!isBox(c) && c.style._shape !== "text") continue;
    if (shapeName(p) === "umlFrame") continue; // UML 帧框住的是一段消息，不是它的子节点
    if (!inside(abs.get(p.id), abs.get(c.id))) {
      errors.push({ code: "outside_container", cells: [c.id, p.id], message: `${name(c.id)} sticks out of its container ${name(p.id)}.` });
    }
  }

  // 文字超出方框
  for (const c of all.values()) {
    if (!isBox(c) || c.lines.length === 0) continue;
    const s = c.style;
    if (s.labelPosition && s.labelPosition !== "center") continue;
    if (s.verticalLabelPosition && s.verticalLabelPosition !== "middle") continue;
    if (s.overflow === "hidden" || s.overflow === "fill") continue;
    const box = abs.get(c.id);
    const area = textArea(c, box);
    const wrap = s.whiteSpace === "wrap";
    const bold = (+(s.fontStyle || 0) & 1) === 1;
    const t = textBox(c.lines, fontSize(c), bold, wrap ? area.w : null);
    const wide = t.width - area.w;
    const tall = t.height - area.h;
    if (wide > TOLERANCE + 1 || tall > TOLERANCE + 2) {
      const how = wide > TOLERANCE + 1 ? `${Math.round(wide)} px too wide` : `${Math.round(tall)} px too tall (${t.lines} lines)`;
      errors.push({ code: "text_overflow", cells: [c.id], message: `The text of ${name(c.id)} doesn't fit its box: ${how}. Widen the box or shorten the label.` });
    }
  }

  // 连线：端点存在、不穿过不相关的方框
  for (const e of all.values()) {
    if (!e.edge) continue;
    const missing = [e.source, e.target].filter((id) => !id || !all.has(id));
    if (missing.length) {
      errors.push({ code: "dangling_edge", cells: [e.id], message: `The connection ${e.id} ${e.source ? name(e.source) : "?"} → ${e.target ? name(e.target) : "?"} points at a missing shape.` });
      continue;
    }
    const path = edgePath(all, e, abs);
    if (!path) continue;
    const skip = new Set([e.source, e.target, ...ancestors(all, e.source), ...ancestors(all, e.target)]);
    const crossed = new Set();
    for (const c of all.values()) {
      if (skip.has(c.id) || !isBox(c) || isContainer(c)) continue;
      const box = abs.get(c.id);
      for (let i = 0; i < path.length - 1; i++) {
        if (segmentCrosses(path[i], path[i + 1], box)) {
          crossed.add(c.id);
          break;
        }
      }
    }
    if (crossed.size) {
      warnings.push({ code: "edge_crosses_shape", cells: [e.id, ...crossed], message: `The connection ${name(e.source)} → ${name(e.target)} passes through ${[...crossed].map(name).join(", ")}.` });
    }
  }

  return { errors, warnings, inventory: inventory(all) };
}

/**
 * 节点的可读名字：同一个字号的连续行是名字被自动换行，拼成一行；字号变小的部分（<span>/<small>）
 * 是补充说明，放在括号里。
 */
function readable(c) {
  if (!c) return "?";
  if (!c.lines.length) return `(${c.id})`;
  const raw = String(c.value);
  const cut = raw.search(/<(span|small)\b/i);
  if (cut < 0 || c.style.html !== "1") return c.lines.join(" ");
  const main = labelLinesOf(raw.slice(0, cut), c.style).join(" ");
  const extra = labelLinesOf(raw.slice(cut), c.style).join(" ");
  return extra ? `${main} (${extra})` : main;
}

function labelLinesOf(value, style) {
  return String(value).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** 内容清单：按容器列出节点，再列连线。 */
function inventory(all) {
  const children = new Map();
  for (const c of all.values()) {
    if (!c.vertex || c.style._shape === "text" || c.style._shape === "edgeLabel") continue;
    // 没有文字、也不装别的形状的小装饰（状态机的初始点等）不算内容
    if (!c.lines.length && ![...all.values()].some((k) => k.parent === c.id)) continue;
    if (!children.has(c.parent)) children.set(c.parent, []);
    children.get(c.parent).push(c);
  }
  const lines = [];
  const nodes = [];
  const walk = (parent, depth) => {
    for (const c of children.get(parent) || []) {
      const kids = children.get(c.id);
      const name = readable(c);
      lines.push(`${"  ".repeat(depth)}${kids ? "[" + name + "]" : "- " + name}`);
      if (c.attrs?.tooltip) lines.push(`${"  ".repeat(depth + 1)}  ${c.attrs.tooltip.replace(/\n/g, "; ")}`);
      nodes.push({ id: c.id, label: name, detail: c.attrs?.tooltip ?? null, container: !!kids, parent: c.parent, depth });
      if (kids) walk(c.id, depth + 1);
    }
  };
  walk("1", 0);
  const edges = [];
  const shown = new Set(nodes.map((n) => n.id));
  for (const e of all.values()) {
    if (!e.edge) continue;
    // 从装饰形状（如状态机的初始点）出发的连线也不算内容
    if (all.has(e.source) && all.has(e.target) && (!shown.has(e.source) || !shown.has(e.target))) continue;
    const dashed = e.style.dashed === "1";
    const both = !!(e.style.startArrow && e.style.startArrow !== "none");
    const label = e.lines.join(" ");
    edges.push({ id: e.id, source: e.source, target: e.target, label, dashed, bidirectional: both });
    lines.push(`${readable(all.get(e.source))} ${both ? "↔" : "→"} ${readable(all.get(e.target))}${label ? ` "${label}"` : ""}${dashed ? " (dashed)" : ""}`);
  }
  const free = [...all.values()].filter((c) => c.vertex && c.style._shape === "text" && c.lines.length);
  return { nodes, edges, text: free.map((c) => c.lines.join(" ")), lines };
}

export { parseStyle };
