// 生成 draw.io XML 的小工具：转义、单元格、一页 mxGraphModel。
//
// 所有转换器都通过这里写 XML，同一份输入总是得到逐字节相同的输出：单元格按加入顺序输出，
// 数字统一经过 fmt。

import { fmt } from "./styles.js";

export function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;");
}

/** 标签写成 html=1 的值：先转义成文本，换行变成 <br>。 */
export function htmlLabel(lines) {
  const text = Array.isArray(lines) ? lines : [lines];
  return text.map((l) => String(l).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")).join("<br>");
}

export class Page {
  constructor() {
    this.cells = [];
    this.ids = new Set(["0", "1"]);
  }

  /** 单元格 ID 必须唯一；规格里的 ID 可能和保留 ID 或彼此冲突，冲突时加后缀。 */
  id(wanted) {
    let id = String(wanted);
    if (!this.ids.has(id)) {
      this.ids.add(id);
      return id;
    }
    for (let i = 2; ; i++) {
      const next = `${id}-${i}`;
      if (!this.ids.has(next)) {
        this.ids.add(next);
        return next;
      }
    }
  }

  vertex({ id, value = "", style, parent = "1", x, y, width, height }) {
    const cell = this.id(id);
    this.cells.push(
      `<mxCell id="${esc(cell)}" value="${esc(value)}" style="${esc(style)}" vertex="1" parent="${esc(parent)}">` +
        `<mxGeometry x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}" as="geometry"/></mxCell>`,
    );
    return cell;
  }

  /**
   * 连线。points 是中间折点；exit/entry 是 0–1 的出入点（相对端点方框），给了就写进样式。
   */
  edge({ id, value = "", style, parent = "1", source, target, points = [], exit, entry }) {
    const cell = this.id(id);
    let s = style;
    if (exit) s += `exitX=${fmt(exit[0])};exitY=${fmt(exit[1])};exitDx=0;exitDy=0;exitPerimeter=0;`;
    if (entry) s += `entryX=${fmt(entry[0])};entryY=${fmt(entry[1])};entryDx=0;entryDy=0;entryPerimeter=0;`;
    const pts = points.length
      ? `<Array as="points">${points.map(([x, y]) => `<mxPoint x="${fmt(x)}" y="${fmt(y)}"/>`).join("")}</Array>`
      : "";
    this.cells.push(
      `<mxCell id="${esc(cell)}" value="${esc(value)}" style="${esc(s)}" edge="1" parent="${esc(parent)}" source="${esc(source)}" target="${esc(target)}">` +
        `<mxGeometry relative="1" as="geometry">${pts}</mxGeometry></mxCell>`,
    );
    return cell;
  }

  /** 一页 mxGraphModel。 */
  model() {
    return (
      '<mxGraphModel adaptiveColors="auto" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0">\n' +
      '<root>\n<mxCell id="0"/>\n<mxCell id="1" parent="0"/>\n' +
      this.cells.join("\n") +
      "\n</root>\n</mxGraphModel>"
    );
  }
}
