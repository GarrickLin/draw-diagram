// 算法数据流（algorithm_flow_plan）转成 draw.io XML。
//
// silicon-canvas 给算法图的只有依赖计划：对象（张量、算子、归约、状态……）、关系和分组，
// 没有坐标。这里把计划交给 draw.io 的语义引擎（vendor/drawio/semantic）排版：
// - 对象 → 节点：名字作第一行，第二行放一条短公式和形状；diagram_role 决定配色；
// - 分组 → 分组；关系 → 连线，保留标签。
// 公式多或长的对象（如在线 softmax 的三条更新式）塞进方框会把节点撑得很高、打乱排版，
// 所以第二行只放第一条不超过 SUB_MAX 字的公式；完整的公式、轴和驻留信息写进节点的
// tooltip，在 draw.io 里悬停可见，check 的内容清单也会列出。
// 不传 display_columns 列提示：实测加上后，语义引擎会把不在分组里的输出节点排到最左边。

import { semanticToXml } from "../../vendor/drawio/semantic/index.js";

/** diagram_role → 语义引擎的角色（calm 主题配色）。 */
const ROLE = {
  tensor: "data",
  operator: "step",
  reduction: "retry",
  state: "success",
  storage: "external",
  index: "note",
  decision: "decision",
};

const SUB_MAX = 28;

function shape(o) {
  return (o.text_plan || {}).shape_once || o.tensor_shape || "";
}

function subtitle(o) {
  const math = (o.text_plan || {}).mathematical_lines || [];
  const parts = [];
  if (math.length === 1 && math[0].length <= SUB_MAX) parts.push(math[0]);
  const sh = shape(o);
  if (sh && sh.length <= SUB_MAX) parts.push(sh);
  return parts.join(" · ");
}

/** 节点的完整说明：公式、轴、形状、驻留，每项一行。 */
export function fullText(o) {
  const t = o.text_plan || {};
  const lines = [...(t.mathematical_lines || []), ...(t.axis_lines || [])];
  if (shape(o)) lines.push("shape: " + shape(o));
  if (o.residency) lines.push(o.residency);
  return lines;
}

function escAttr(v) {
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
}

/**
 * @param {object} doc 版面文档，kind 为 algorithm
 * @returns {Promise<{xml: string, warnings: string[], stats: object}>}
 */
export async function algorithmToDrawio(doc) {
  const plan = doc.algorithm_flow_plan;
  const groups = plan.groups.map((g) => ({ id: g.id, label: g.label, parent: g.parent || "" }));
  const groupIds = new Set(groups.map((g) => g.id));
  const description = {
    type: "flowchart",
    direction: "horizontal",
    groups,
    nodes: plan.objects.map((o) => ({
      id: o.source_node_id,
      label: o.label,
      sub: subtitle(o),
      role: ROLE[o.role] || "step",
      group: groupIds.has(o.source_group) ? o.source_group : "",
    })),
    edges: plan.relations.map((r) => ({ from: r.source, to: r.target, label: r.label || "" })),
  };
  const r = await semanticToXml(description, {});
  if (r.error) throw new Error(`The algorithm layout failed: ${r.error}`);
  // 语义引擎不写字体，补上 Helvetica，和测宽、其他路径一致
  let xml = r.xml.replace(/style="([^"]*)"/g, (m, s) => (/fontFamily=/.test(s) || !/fontSize=/.test(s) ? m : `style="${s}fontFamily=Helvetica;"`));
  // 完整说明写进 tooltip：mxCell 换成带属性的 UserObject，draw.io 悬停时显示
  for (const o of plan.objects) {
    const lines = fullText(o);
    if (!lines.length) continue;
    const id = o.source_node_id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    xml = xml.replace(new RegExp(`<mxCell id="${id}" value="([^"]*)" (style="[^"]*" vertex="1" parent="[^"]*">)(<mxGeometry[^>]*/?>(?:</mxGeometry>)?)</mxCell>`), (m, value, rest, geo) =>
      `<UserObject id="${o.source_node_id}" label="${value}" tooltip="${escAttr(lines.join("\n"))}"><mxCell ${rest}${geo}</mxCell></UserObject>`);
  }
  return {
    xml,
    warnings: r.warnings || [],
    stats: { nodes: plan.objects.length, groups: groups.length, edges: (xml.match(/edge="1"/g) || []).length },
  };
}
