// 读 .drawio 文件里一页的单元格：只读，供 check 使用。
//
// draw.io 的 XML 很规整：<mxCell> 带 <mxGeometry>，<UserObject>/<object> 包一个 mxCell 并带 id、
// label 和其他属性。页面可能被压缩（deflate + base64 + URL 编码），用 Node 自带的 zlib 解开。

import { inflateRawSync } from "node:zlib";

function attrs(s) {
  const out = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = unescape(m[2]);
  return out;
}

export function unescape(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** style 字符串拆成键值；第一个不带 = 的项是形状名，记为 _shape。 */
export function parseStyle(style) {
  const out = {};
  for (const part of String(style || "").split(";")) {
    if (!part) continue;
    const i = part.indexOf("=");
    if (i < 0) out._shape ??= part;
    else out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

/** html=1 的标签转成纯文本行：<br> 和块级标签换行，去掉其余标签。 */
export function labelLines(value, style) {
  let v = String(value ?? "");
  if (style.html === "1") {
    v = v.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, "");
    v = unescape(v);
  }
  return v.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l !== "");
}

function decompress(text) {
  const raw = Buffer.from(text.trim(), "base64");
  return decodeURIComponent(inflateRawSync(raw).toString("latin1"));
}

/**
 * 文件里的页面。
 * @returns {Array<{name: string, xml: string}>}
 */
export function pages(text) {
  const t = text.trim();
  if (/^<mxGraphModel[\s>]/.test(t)) return [{ name: "Page-1", xml: t }];
  const out = [];
  for (const m of t.matchAll(/<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/g)) {
    const a = attrs(m[1]);
    const body = m[2].trim();
    const xml = body.startsWith("<") ? body : decompress(body);
    out.push({ name: a.name || `Page-${out.length + 1}`, id: a.id, xml });
  }
  return out;
}

/**
 * 一页里的单元格。几何是相对父单元格的坐标，和文件里写的一样。
 * @returns {Map<string, {id, parent, value, lines, style, vertex, edge, source, target, geo, points, attrs}>}
 */
export function cells(pageXml) {
  const out = new Map();
  const re = /<(UserObject|object)\b([^>]*)>\s*(<mxCell\b[^>]*?(?:\/>|>[\s\S]*?<\/mxCell>))\s*<\/\1>|(<mxCell\b[^>]*?(?:\/>|>[\s\S]*?<\/mxCell>))/g;
  for (const m of pageXml.matchAll(re)) {
    const wrapper = m[1] ? attrs(m[2]) : null;
    const cellXml = m[3] || m[4];
    const open = cellXml.match(/^<mxCell\b([^>]*?)\/?>/)[1];
    const a = attrs(open);
    const id = wrapper?.id ?? a.id;
    const style = parseStyle(a.style);
    const value = wrapper ? (wrapper.label ?? "") : (a.value ?? "");
    const g = cellXml.match(/<mxGeometry\b([^>]*?)(\/>|>([\s\S]*?)<\/mxGeometry>)/);
    const ga = g ? attrs(g[1]) : {};
    const geo = g ? { x: +(ga.x || 0), y: +(ga.y || 0), w: +(ga.width || 0), h: +(ga.height || 0), relative: ga.relative === "1" } : null;
    const points = [];
    const arr = g?.[3]?.match(/<Array\b[^>]*as="points"[^>]*>([\s\S]*?)<\/Array>/);
    if (arr) for (const p of arr[1].matchAll(/<mxPoint\b([^>]*)\/>/g)) {
      const pa = attrs(p[1]);
      points.push([+(pa.x || 0), +(pa.y || 0)]);
    }
    out.set(id, {
      id,
      parent: a.parent,
      value,
      lines: labelLines(value, style),
      style,
      vertex: a.vertex === "1",
      edge: a.edge === "1",
      source: a.source,
      target: a.target,
      geo,
      points,
      attrs: wrapper || {},
    });
  }
  return out;
}

/** 单元格的绝对坐标：沿 parent 链把相对坐标加起来（只对顶点有意义）。 */
export function absolute(all, id) {
  let x = 0;
  let y = 0;
  let c = all.get(id);
  const seen = new Set();
  const box = c?.geo ? { w: c.geo.w, h: c.geo.h } : { w: 0, h: 0 };
  while (c && c.vertex && c.geo && !seen.has(c.id)) {
    seen.add(c.id);
    x += c.geo.x;
    y += c.geo.y;
    c = all.get(c.parent);
  }
  return { x, y, w: box.w, h: box.h };
}
