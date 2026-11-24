// silicon-canvas 的节点、连线类型到 draw.io 样式的映射。
//
// 配色取 draw.io 的 calm 主题（vendor/drawio/semantic/theme.js），和 convert 路径画出来的图一致。
// 所有样式都写明 fontFamily=Helvetica：版面按 Helvetica 字宽排，draw.io 也要用它显示。

import { ROLES, FONT_COLOR, EDGE } from "../../vendor/drawio/semantic/theme.js";

export const FONT = "Helvetica";

/** 节点类型（spec.nodes[].kind）对应的 calm 主题角色。 */
const KIND_ROLE = {
  compute: "step",
  stage: "step",
  memory: "data",
  io: "external",
  control: "retry",
  decision: "decision",
  state: "step",
  event: "start",
  signal: "note",
};

/** 算法图的 diagram_role 对应的角色，优先于 kind。 */
const ALGORITHM_ROLE = {
  tensor: "data",
  operator: "step",
  reduction: "retry",
  state: "success",
  storage: "external",
  index: "note",
  decision: "decision",
};

function colors(role) {
  const r = ROLES[role] || ROLES.step;
  return `fillColor=${r.fill};strokeColor=${r.stroke};fontColor=${FONT_COLOR};`;
}

function font(size, bold = false) {
  return `fontFamily=${FONT};fontSize=${fmt(size)};` + (bold ? "fontStyle=1;" : "");
}

/** 坐标、字号写进 XML 时保留两位小数，去掉多余的 0。 */
export function fmt(n) {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
}

/**
 * 普通节点。
 * @param {string} kind spec 里的 kind
 * @param {{fontSize: number, role?: string, wrap?: boolean}} o role 是算法图的 diagram_role
 */
export function nodeStyle(kind, { fontSize, role } = {}) {
  const r = (role && ALGORITHM_ROLE[role]) || KIND_ROLE[kind] || "step";
  let shape = "rounded=1;arcSize=12;";
  if (kind === "decision" || role === "decision") shape = "rhombus;";
  else if (kind === "state") shape = "rounded=1;arcSize=40;";
  else if (role === "tensor") shape = "rounded=0;";
  return `${shape}whiteSpace=wrap;html=1;${colors(r)}${font(fontSize)}`;
}

/** 分组容器：带标题栏的 swimlane，子节点放在里面。 */
export function containerStyle({ fontSize, startSize }) {
  return `swimlane;startSize=${fmt(startSize)};horizontal=1;html=1;whiteSpace=wrap;container=1;collapsible=0;` +
    `rounded=0;${colors("container")}${font(fontSize, true)}verticalAlign=middle;align=left;spacingLeft=6;`;
}

/** 无边框容器：只用来把子节点组织在一起（例如展开分组里放不下标题栏时）。 */
export function groupStyle() {
  return "group;container=1;collapsible=0;";
}

const EDGE_KIND = {
  data: "",
  control: "dashed=1;dashPattern=6 4;",
  feedback: "dashed=1;dashPattern=6 4;",
  clock: "dashed=1;dashPattern=1 3;",
  relation: "endArrow=none;",
};

/**
 * 连线。不设 edgeStyle：draw.io 沿给定的折点画直线段，不会自己重新寻路。
 * @param {string} kind spec 里的 kind
 * @param {{fontSize: number, strokeStyle?: string, bidirectional?: boolean}} o
 */
export function edgeStyle(kind, { fontSize, strokeStyle, bidirectional } = {}) {
  let s = `html=1;rounded=0;endArrow=block;endFill=1;endSize=6;strokeColor=${EDGE.stroke};strokeWidth=1.5;` +
    `fontColor=${EDGE.font};${font(fontSize)}labelBackgroundColor=#FFFFFF;`;
  s += EDGE_KIND[kind] ?? "";
  if (strokeStyle === "dashed" && !/dashed=1/.test(s)) s += "dashed=1;dashPattern=6 4;";
  if (strokeStyle === "solid") s = s.replace(/dashed=1;dashPattern=[^;]*;/, "");
  if (bidirectional) s += "startArrow=block;startFill=1;startSize=6;";
  return s;
}

/**
 * 独立放置的连线标签（版面引擎给了位置）。白底用 labelBackgroundColor 而不是 fillColor：
 * diagram-render 把带 fillColor 的 text 形状画成渐变，draw.io 两种写法显示相同。
 */
export function labelStyle({ fontSize, color }) {
  return `text;html=1;align=center;verticalAlign=middle;whiteSpace=nowrap;resizable=0;` +
    `fillColor=none;strokeColor=none;labelBackgroundColor=#FFFFFF;fontColor=${color || EDGE.font};${font(fontSize)}`;
}

/** 图标题。 */
export function titleStyle({ fontSize }) {
  return `text;html=1;align=left;verticalAlign=middle;whiteSpace=nowrap;fontColor=${FONT_COLOR};${font(fontSize, true)}`;
}
