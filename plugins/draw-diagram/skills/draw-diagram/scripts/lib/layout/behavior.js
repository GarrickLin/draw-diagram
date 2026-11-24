// 行为图版面（状态机、流程、拓扑、时序）转成 draw.io XML。
//
// silicon-canvas 的 behavior_guide 给出像素坐标（画布宽 1800）。节点的形状和尺寸按它
// render() 里的画法：状态机是直径 156 的圆，流程用 sizes 里的宽高，拓扑是 196×84 的方框，
// 正文 32px、标签 27px。整张图按「正文缩到 14px」的比例统一缩小。
//
// 时序图（sampled-timing）没有节点和连线，是一张「信号 × 采样点」的表，画成表格。

import { Page, htmlLabel } from "./xml.js";
import { nodeStyle, edgeStyle, labelStyle, fmt, FONT } from "./styles.js";
import { FONT_COLOR, ROLES } from "../../vendor/drawio/semantic/theme.js";
import { textWidth } from "../text-width.js";

const BODY = 32;
const SMALL = 27;
const WIDTH = 1800;
const TARGET_BODY_PX = 14;
const STATE_R = 78;
const TOPOLOGY = [196, 84];

/**
 * @param {object} doc 版面文档，kind 为 behavior
 * @returns {{xml: string, warnings: string[], stats: object}}
 */
export function behaviorToDrawio(doc) {
  const sl = doc.structure_layout;
  if (sl.grammar === "sampled-timing") return timing(doc);
  const s = TARGET_BODY_PX / BODY;
  const body = BODY * s;
  const small = SMALL * s;
  const page = new Page();
  const warnings = [];
  const spec = new Map((doc.spec.nodes || []).map((n) => [n.id, n]));
  const boxes = new Map();
  const cells = new Map();
  const fitted = new Map();

  if (sl.grammar === "state-machine" && sl.reset_notes?.length) {
    const text = sl.reset_notes.join(" ");
    page.vertex({ id: "reset-note", value: htmlLabel(text), style: labelStyle({ fontSize: small, color: FONT_COLOR }).replace("whiteSpace=nowrap", "whiteSpace=wrap"),
      x: (WIDTH / 2 - 750) * s, y: 50 * s, width: 1500 * s, height: 40 * s });
  }

  for (const [id, [cx, cy]] of Object.entries(sl.positions || {})) {
    const node = spec.get(id) || { label: id, kind: "compute" };
    let w;
    let h;
    let value;
    let style;
    if (sl.grammar === "state-machine") {
      // 圆的直径用上游的 156：走线终点算在这个圆上，改大小箭头就会插进圆里。
      // 名字放不下时缩小这个节点的字号，让最长的词放进圆的内接正方形。
      w = h = 2 * STATE_R;
      const outputs = sl.state_outputs?.[id] || [];
      const room = 2 * STATE_R * Math.SQRT1_2 - 8;
      const widest = Math.max(...String(node.label).split(/\s+/).map((x) => textWidth(x, BODY)));
      fitted.set(id, widest > room ? BODY * (room / widest) : BODY);
      value = htmlLabel(node.label) + (outputs.length ? `<br><span style="font-size:${fmt(small)}px">${htmlLabel(outputs.join(", "))}</span>` : "");
      style = `ellipse;aspect=fixed;` + nodeStyle("state", { fontSize: fitted.get(id) * s }).replace(/^rounded=1;arcSize=\d+;/, "");
    } else if (sl.grammar === "directed-process") {
      [w, h] = sl.sizes[id];
      const rec = sl.object_text?.[id] || { name_lines: [node.label], required_detail_lines: [] };
      value = htmlLabel(rec.name_lines) + (rec.required_detail_lines.length ? `<br><span style="font-size:${fmt(small)}px">${htmlLabel(rec.required_detail_lines)}</span>` : "");
      style = nodeStyle(node.kind, { fontSize: body }).replace(/^rounded=1;arcSize=\d+;/, "rounded=0;");
    } else {
      [w, h] = TOPOLOGY;
      value = htmlLabel(node.label);
      style = nodeStyle(node.kind, { fontSize: body });
    }
    const box = { x: (cx - w / 2) * s, y: (cy - h / 2) * s, w: w * s, h: h * s };
    boxes.set(id, box);
    cells.set(id, page.vertex({ id, value, style, x: box.x, y: box.y, width: box.w, height: box.h }));

    if (sl.grammar === "state-machine" && (sl.initial_node_ids || []).includes(id)) {
      // 初始状态：实心点加一段箭头，与上游画法相同
      const dot = page.vertex({ id: `${id}-initial`, value: "", style: `ellipse;html=1;aspect=fixed;fillColor=${FONT_COLOR};strokeColor=none;`,
        x: (cx - 38) * s, y: (cy + 139) * s, width: 12 * s, height: 12 * s });
      page.edge({ id: `${id}-initial-edge`, style: edgeStyle("data", { fontSize: small }), source: dot, target: cells.get(id),
        exit: [0.5, 0], entry: attach([(cx - 14) * s, (cy + 76) * s], box) });
    }
  }

  let edgeCount = 0;
  for (const [i, r] of (sl.routes || []).entries()) {
    const src = boxes.get(r.source);
    const tgt = boxes.get(r.target);
    if (!src || !tgt || !Array.isArray(r.points) || r.points.length < 2) {
      warnings.push(`The connection ${r.source} → ${r.target} has no drawable route; it was left out.`);
      continue;
    }
    const pts = r.points.map(([x, y]) => [x * s, y * s]);
    page.edge({
      id: `e${i + 1}`,
      style: edgeStyle(r.kind, { fontSize: small, strokeStyle: r.stroke_style, bidirectional: r.bidirectional }),
      source: cells.get(r.source), target: cells.get(r.target),
      points: pts.slice(1, -1),
      exit: attach(pts[0], src), entry: attach(pts[pts.length - 1], tgt),
    });
    edgeCount++;
  }

  // 连线标签：引擎给的位置按上游的画布宽度安排，回程线的标签放在右侧空白的正中间。我们的画布
  // 右侧更宽，标签会离线很远，所以离所属连线太远时把它挪到紧贴连线的地方（同一侧）。
  const routeOf = new Map();
  for (const r of sl.routes || []) for (const m of r.members || []) routeOf.set(m, r);
  const GAP = 14;
  const MAX_GAP = 30;
  function nearLine(l) {
    let [cx, cy] = l.at;
    const routes = (l.source_edge_indices || []).map((k) => routeOf.get(k)).filter((r) => r && Array.isArray(r.points));
    if (!routes.length) return [cx, cy];
    const halfW = Math.min(textWidth(String(l.text), SMALL), l.max_width || 310) / 2;
    const halfH = SMALL * 0.75;
    let best = null;
    for (const r of routes) {
      for (let k = 0; k + 1 < r.points.length; k++) {
        const [[x0, y0], [x1, y1]] = [r.points[k], r.points[k + 1]];
        const px = Math.max(Math.min(x0, x1), Math.min(cx, Math.max(x0, x1)));
        const py = Math.max(Math.min(y0, y1), Math.min(cy, Math.max(y0, y1)));
        const d = Math.hypot(cx - px, cy - py);
        if (!best || d < best.d) best = { d, vertical: x0 === x1 && y0 !== y1, horizontal: y0 === y1 && x0 !== x1, x: x0, y: y0, py, px };
      }
    }
    const [x0, y0] = [cx, cy];
    if (best.vertical && cy === best.py) {
      const gap = Math.abs(cx - best.x) - halfW;
      if (gap > MAX_GAP) cx = best.x + Math.sign(cx - best.x) * (halfW + GAP);
    } else if (best.horizontal && cx === best.px) {
      const gap = Math.abs(cy - best.y) - halfH;
      if (gap > MAX_GAP) cy = best.y + Math.sign(cy - best.y) * (halfH + GAP);
    }
    // 挪过去会压到节点的话，留在引擎给的位置
    const clear = 4;
    const hit = [...boxes.values()].some((b) =>
      (cx - halfW - clear) * s < b.x + b.w && (cx + halfW + clear) * s > b.x && (cy - halfH - clear) * s < b.y + b.h && (cy + halfH + clear) * s > b.y);
    return hit ? [x0, y0] : [cx, cy];
  }

  let labelCount = 0;
  for (const [i, l] of (sl.labels || []).entries()) {
    const maxW = (l.max_width || 310) * s;
    const [cx, cy] = nearLine(l);
    page.vertex({ id: `label-${i + 1}`, value: htmlLabel(l.text),
      style: labelStyle({ fontSize: small }).replace("whiteSpace=nowrap", "whiteSpace=wrap"),
      x: cx * s - maxW / 2, y: cy * s - small * 0.75, width: maxW, height: small * 1.5 });
    labelCount++;
  }

  return { xml: page.model(), warnings, stats: { nodes: boxes.size, edges: edgeCount, labels: labelCount } };
}

/** 时序图：第一行是采样点，每个信号一行，单元格写该采样点的值。 */
function timing(doc) {
  const sl = doc.structure_layout;
  const s = TARGET_BODY_PX / BODY;
  const body = BODY * s;
  const small = SMALL * s;
  const page = new Page();
  const axis = sl.axis || [];
  const left = 360;
  const cell = (WIDTH - left - 90) / Math.max(1, axis.length);
  const rowH = 108;
  const top = 150;
  const font = (size) => `fontFamily=${FONT};fontSize=${fmt(size)};fontColor=${FONT_COLOR};`;
  const header = `rounded=0;html=1;whiteSpace=wrap;fillColor=${ROLES.container.fill};strokeColor=${ROLES.container.stroke};${font(body)}fontStyle=1;`;
  const plain = `rounded=0;html=1;whiteSpace=wrap;fillColor=#FFFFFF;strokeColor=${ROLES.container.stroke};${font(body)}`;
  const high = `rounded=0;html=1;whiteSpace=wrap;fillColor=${ROLES.step.fill};strokeColor=${ROLES.container.stroke};${font(body)}`;

  page.vertex({ id: "axis-label", value: "", style: header, x: 55 * s, y: 30 * s, width: (left - 55) * s, height: 70 * s });
  axis.forEach((v, c) => page.vertex({ id: `axis-${c}`, value: htmlLabel(v), style: header,
    x: (left + c * cell) * s, y: 30 * s, width: cell * s, height: 70 * s }));

  for (const [r, row] of (sl.rows || []).entries()) {
    const y = (top + r * rowH) * s;
    page.vertex({ id: `row-${row.id}`, value: htmlLabel(row.label), style: header, x: 55 * s, y, width: (left - 55) * s, height: rowH * s });
    axis.forEach((_, c) => {
      const marker = row.kind === "sample-markers";
      const value = marker ? "↑" : row.values?.[c] ?? "";
      page.vertex({ id: `cell-${row.id}-${c}`, value: htmlLabel(value), style: !marker && value === "1" ? high : plain,
        x: (left + c * cell) * s, y, width: cell * s, height: rowH * s });
    });
  }
  const bottom = (top + (sl.rows || []).length * rowH + 30) * s;
  page.vertex({ id: "sampling-note", value: htmlLabel("Values at named sample edges; inter-edge timing unspecified"),
    style: labelStyle({ fontSize: small, color: FONT_COLOR }), x: 55 * s, y: bottom, width: (WIDTH - 105) * s, height: small * 1.6 });

  return { xml: page.model(), warnings: [], stats: { nodes: (sl.rows || []).length, edges: 0, labels: 0, samples: axis.length } };
}

function attach([x, y], box) {
  const clamp = (v) => Math.min(1, Math.max(0, v));
  return [clamp(box.w ? (x - box.x) / box.w : 0.5), clamp(box.h ? (y - box.y) / box.h : 0.5)];
}
