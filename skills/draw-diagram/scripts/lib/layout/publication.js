// 架构图版面（新版 publication 和旧版 legacy）转成 draw.io XML。
//
// silicon-canvas 按 160mm 印刷宽度排版：画布宽 1800px，正文 36px（旧版 22px）。整张图按
// 「正文缩到 14px」的比例统一缩小，坐标和字号一起缩，版面比例不变。
//
// 方框、容器、子模块、走线折点、连线标签的位置都直接取自版面数据，不重新计算：
// - 方框和走线是 0–1 的归一化坐标，乘以画布尺寸；
// - 新版里展开分组的子模块（symbol_metrics[].children[].box_px）是相对父方框左上角的像素；
// - 旧版里 unit-region 的子模块（template_slots[].box）是相对父方框的比例。
// 连线不设 edgeStyle，draw.io 按给定折点画直线段；出入点由首尾两个折点决定。

import { Page, htmlLabel } from "./xml.js";
import { nodeStyle, containerStyle, edgeStyle, labelStyle, fmt } from "./styles.js";

const TARGET_BODY_PX = 14;

// 旧版版面在 structure_scene.render 里用的字号
const LEGACY = { body: 22, label: 16, container: 20, frame: 24, slot: 18, slotSmall: 16 };

/** 容器样式的变体：只有边框，标签在框外左上方（silicon-canvas 的画法）。 */
function scopeStyle(fontSize, dashed = false) {
  return `rounded=0;whiteSpace=wrap;html=1;container=1;collapsible=0;fillColor=none;strokeColor=#B8C0CC;` +
    (dashed ? "dashed=1;dashPattern=6 4;" : "") +
    `fontFamily=Helvetica;fontSize=${fmt(fontSize)};fontColor=#1B1F24;fontStyle=1;` +
    `labelPosition=center;verticalLabelPosition=top;align=left;verticalAlign=bottom;spacingLeft=2;spacingBottom=2;`;
}

function boxIn(outer, inner) {
  const e = 1e-6;
  return inner.x >= outer.x - e && inner.y >= outer.y - e &&
    inner.x + inner.w <= outer.x + outer.w + e && inner.y + inner.h <= outer.y + outer.h + e;
}

function area(b) {
  return b.w * b.h;
}

/**
 * @param {object} doc 版面文档，kind 为 publication 或 legacy
 * @returns {{xml: string, warnings: string[], stats: object}}
 */
export function publicationToDrawio(doc) {
  const legacy = doc.kind === "legacy";
  const sl = doc.structure_layout;
  const scene = doc.layout_scene;
  const labels = doc.label_layout || { labels: [], deferred_labels: [] };
  const typo = sl.typography || {};
  const bodyPx = legacy ? LEGACY.body : typo.body_px;
  const signalPx = legacy ? LEGACY.label : typo.signal_px;
  const s = TARGET_BODY_PX / bodyPx;
  // 旧版按 label_layout 的画布绘制（控制流图会缩到 1100 宽）
  const W = legacy && labels.width ? labels.width : scene.width;
  const H = legacy && labels.height ? labels.height : scene.height;
  const abs = (b) => ({ x: b.x * W * s, y: b.y * H * s, w: b.width * W * s, h: b.height * H * s });
  const warnings = [];
  const specNodes = new Map((doc.spec.nodes || []).map((n) => [n.id, n]));

  // ---- 收集所有方框（绝对坐标），最后统一按父子关系输出 ----
  /** @type {Map<string, {key: string, cellId: string, box: object, parent: string|null, value: string, style: string, children?: Array}>} */
  const shapes = new Map();
  const endpointCell = new Map(); // 版面 ID → 形状 key
  const scopes = []; // 只画边框的容器

  const frame = sl.system_frame;
  if (frame && !frame.display_only && frame.box) {
    const fs = (legacy ? LEGACY.frame : bodyPx) * s;
    shapes.set("frame", {
      key: "frame", cellId: "frame", box: abs(frame.box), parent: null, value: htmlLabel(frame.label || ""),
      style: containerStyle({ fontSize: fs, startSize: 34 * s * (legacy ? 1 : bodyPx / LEGACY.body) }),
    });
    scopes.push({ key: "frame", members: null, box: abs(frame.box) });
  }

  for (const c of sl.containers || []) {
    if (c.is_system_boundary || c.replaces_region || c.render_boundary === false || !c.box) continue;
    const key = "grp:" + c.id;
    const fs = (legacy ? LEGACY.container : bodyPx) * s;
    shapes.set(key, { key, cellId: "grp-" + c.id, box: abs(c.box), parent: null, value: htmlLabel(c.label || ""), style: scopeStyle(fs), containerId: c.id, parentId: c.parent || "" });
    scopes.push({ key, id: c.id, members: new Set(c.members || []), box: abs(c.box), parentId: c.parent || "" });
    endpointCell.set(c.id, key);
  }

  for (const m of sl.macro_nodes || []) {
    const raw = sl.boxes[m.id] || m.box;
    if (!raw) {
      warnings.push(`No position for "${m.label}"; it was left out.`);
      continue;
    }
    const box = abs(raw);
    const key = "node:" + m.id;
    if (legacy) {
      if (m.template_slots && m.template_slots.length) {
        const header = box.h * (m.header_fraction ?? 0.14);
        const children = m.template_slots.map((slot) => {
          const b = { x: slot.box.x * box.w, y: slot.box.y * box.h, w: slot.box.width * box.w, h: slot.box.height * box.h };
          const fs = (b.h / s >= 48 ? LEGACY.slot : LEGACY.slotSmall) * s;
          return { id: slot.source_node_id, value: legacyLabel(slot.display_label || slot.label, specNodes.get(slot.source_node_id)), kind: slot.kind, box: b, fontSize: fs };
        });
        shapes.set(key, { key, cellId: m.id, box, value: htmlLabel(m.label), style: containerStyle({ fontSize: LEGACY.body * s, startSize: header }), children, nodeId: m.id });
      } else {
        shapes.set(key, { key, cellId: m.id, box, value: legacyLabel(m.label, specNodes.get(m.id)), style: nodeStyle(m.kind, { fontSize: LEGACY.body * s }), nodeId: m.id });
      }
    } else {
      const metrics = (sl.symbol_metrics || {})[m.id] || {};
      const fs = (metrics.font_px || bodyPx) * s;
      const lines = metrics.lines || [m.label];
      const detail = metrics.detail_lines || [];
      if (metrics.children && metrics.children.length) {
        const children = metrics.children.map((c) => ({
          id: c.id, value: htmlLabel(c.lines || [c.label]), kind: c.kind,
          box: { x: c.box_px.x * s, y: c.box_px.y * s, w: c.box_px.width * s, h: c.box_px.height * s }, fontSize: fs,
        }));
        shapes.set(key, { key, cellId: m.id, box, value: htmlLabel([...lines, ...detail]), style: containerStyle({ fontSize: fs, startSize: (metrics.header_height || 66) * s }), children, nodeId: m.id });
      } else {
        const value = htmlLabel(lines) + (detail.length ? `<br><span style="font-size:${fmt(fs * 0.85)}px">${htmlLabel(detail)}</span>` : "");
        shapes.set(key, { key, cellId: m.id, box, value, style: nodeStyle(m.kind, { fontSize: fs }), nodeId: m.id });
      }
    }
    endpointCell.set(m.id, key);
  }

  for (const inset of sl.insets || []) {
    const box = abs(inset.box);
    const metrics = inset.metrics || {};
    const fs = (metrics.font_px || bodyPx) * s;
    const children = (metrics.children || []).map((c) => ({
      id: c.id, value: htmlLabel(c.lines || [c.label]), kind: c.kind,
      box: { x: c.box_px.x * s, y: c.box_px.y * s, w: c.box_px.width * s, h: c.box_px.height * s }, fontSize: fs,
    }));
    const key = "inset:" + inset.id;
    shapes.set(key, {
      key, cellId: "inset-" + inset.id, box, value: htmlLabel(metrics.lines || [inset.label]),
      style: containerStyle({ fontSize: fs, startSize: (metrics.header_height || 66) * s }) + "dashed=1;dashPattern=6 4;", children,
    });
  }

  // ---- 父子关系：节点进最小的成员容器，容器进最小的外层容器 ----
  const scopeOf = new Map(scopes.map((sc) => [sc.key, sc]));
  for (const sc of scopes) {
    if (sc.key === "frame") continue;
    let parent = sc.parentId && endpointCell.get(sc.parentId);
    if (!parent || !scopeOf.has(parent)) {
      parent = smallestEnclosing(scopes.filter((o) => o.key !== sc.key), sc.box)?.key ?? null;
    }
    shapes.get(sc.key).parent = parent;
  }
  for (const shape of shapes.values()) {
    if (shape.key.startsWith("grp:") || shape.key === "frame") continue;
    const owners = scopes.filter((sc) => sc.members && shape.nodeId && sc.members.has(shape.nodeId) && boxIn(sc.box, shape.box));
    const owner = owners.sort((a, b) => area(a.box) - area(b.box))[0] ?? smallestEnclosing(scopes, shape.box);
    shape.parent = owner ? owner.key : null;
  }

  // ---- 输出：父节点先于子节点 ----
  const page = new Page();
  const cellOf = new Map();
  const emitted = new Set();
  const origin = (key) => (key ? shapes.get(key).box : { x: 0, y: 0 });
  const childCells = new Map(); // 子模块 ID → {cell, box(绝对)}
  let nodeCount = 0;
  let containerCount = 0;
  const emit = (shape) => {
    if (emitted.has(shape.key)) return;
    if (shape.parent && !emitted.has(shape.parent)) emit(shapes.get(shape.parent));
    const parentCell = shape.parent ? cellOf.get(shape.parent) : "1";
    const o = origin(shape.parent);
    const cell = page.vertex({ id: shape.cellId, value: shape.value, style: shape.style, parent: parentCell, x: shape.box.x - o.x, y: shape.box.y - o.y, width: shape.box.w, height: shape.box.h });
    cellOf.set(shape.key, cell);
    emitted.add(shape.key);
    if (shape.children || shape.key.startsWith("grp:") || shape.key === "frame") containerCount++;
    else nodeCount++;
    for (const c of shape.children || []) {
      const cc = page.vertex({ id: c.id, value: c.value, style: nodeStyle(c.kind, { fontSize: c.fontSize }), parent: cell, x: c.box.x, y: c.box.y, width: c.box.w, height: c.box.h });
      childCells.set(c.id, { cell: cc, box: { x: shape.box.x + c.box.x, y: shape.box.y + c.box.y, w: c.box.w, h: c.box.h } });
      nodeCount++;
    }
  };
  for (const shape of shapes.values()) emit(shape);

  // ---- 走线 ----
  const edgeFont = signalPx * s;
  let edgeCount = 0;
  for (const [i, r] of (scene.routes || []).entries()) {
    const src = endpoint(r.source);
    const tgt = endpoint(r.target);
    if (!src || !tgt || !Array.isArray(r.points) || r.points.length < 2) {
      warnings.push(`The connection ${r.source} → ${r.target} has no drawable route; it was left out.`);
      continue;
    }
    const pts = r.points.map(([x, y]) => [x * W * s, y * H * s]);
    page.edge({
      id: r.id || `e${i + 1}`,
      style: edgeStyle(r.kind, { fontSize: edgeFont, strokeStyle: r.stroke_style, bidirectional: r.bidirectional }),
      source: src.cell, target: tgt.cell,
      points: pts.slice(1, -1),
      exit: attach(pts[0], src.box), entry: attach(pts[pts.length - 1], tgt.box),
    });
    edgeCount++;
  }

  // ---- 连线标签 ----
  const LW = labels.width || W;
  const LH = labels.height || H;
  let labelCount = 0;
  for (const [i, l] of (labels.labels || []).entries()) {
    const b = l.box;
    page.vertex({ id: `label-${i + 1}`, value: htmlLabel(l.text), style: labelStyle({ fontSize: edgeFont, color: l.color }),
      x: b.x * LW * s, y: b.y * LH * s, width: b.width * LW * s, height: b.height * LH * s });
    labelCount++;
  }
  for (const d of labels.deferred_labels || []) {
    warnings.push(`The label "${d.text}" didn't fit on the page and was left out; the connection is drawn without it.`);
  }

  return {
    xml: page.model(),
    warnings,
    stats: { nodes: nodeCount, containers: containerCount, edges: edgeCount, labels: labelCount, deferredLabels: (labels.deferred_labels || []).length },
  };

  function endpoint(id) {
    const key = endpointCell.get(id);
    if (key) return { cell: cellOf.get(key), box: shapes.get(key).box };
    return childCells.get(id) || null;
  }
}

function smallestEnclosing(scopes, box) {
  return scopes.filter((sc) => boxIn(sc.box, box) && !(sc.box.x === box.x && sc.box.y === box.y && sc.box.w === box.w && sc.box.h === box.h))
    .sort((a, b) => area(a.box) - area(b.box))[0] ?? null;
}

/** 折点相对端点方框的位置（0–1），即 draw.io 的 exitX/exitY 或 entryX/entryY。 */
function attach([x, y], box) {
  const clamp = (v) => Math.min(1, Math.max(0, v));
  return [clamp(box.w ? (x - box.x) / box.w : 0.5), clamp(box.h ? (y - box.y) / box.h : 0.5)];
}

/** 旧版节点标签：detail 里的存储参数（N banks、N-B CELL）作为第二行，与上游画法一致。 */
function legacyLabel(label, node) {
  const detail = node?.detail || "";
  const params = detail.match(/\b\d+\s+banks\b|\b\d+[- ]B\s+CELL\b/gi);
  return htmlLabel(params ? [label, params.join(" · ")] : [label]);
}
