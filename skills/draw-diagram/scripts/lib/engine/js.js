// 第二阶段的引擎实现：silicon-canvas 转成 JS 后在本进程内运行，不需要 Python。
//
// 和 py/bridge.py 逐行对应：同样的 prepare（先判断表达方式，拒绝产品渲染和空间示意）、同样的
// compile（只取主图，主图排不出时选覆盖节点最多的视图），输出同样的版面文档。
// silicon/ 下的模块由 tools/port/transpile.py 从 vendor/silicon 生成，不要手改。

import * as py from "./py/runtime.js";
import { DiagramError } from "../cli.js";

const UNSUPPORTED = new Set(["product_render", "system_illustration"]);
const OUTPUT_SENTENCE = "Your output will be compiled into a raster Image Gen prompt, NOT Mermaid, SVG, draw.io, code, or a finished image.";
const OUTPUT_REPLACEMENT = "Your output will be laid out by a layout engine and drawn as an editable draw.io diagram; do not write Mermaid, SVG, draw.io XML, code, or a finished image yourself.";
const KINDS = {
  "publication-candidates": "publication",
  "legacy-technical-annex": "legacy",
  "semantic-guide": "behavior",
  "algorithm-dependency-plan": "algorithm",
  "text-only": "text-only",
};
const DROPPED_WARNINGS = ["技术附图", "成图", "Image Gen"];
const PREFERENCE = ["publication-candidates", "semantic-guide", "algorithm-dependency-plan", "legacy-technical-annex"];

let modules = null;
async function load() {
  if (modules === null) {
    const [engine, scene_profiles] = await Promise.all([import("./silicon/engine.js"), import("./silicon/scene_profiles.js")]);
    modules = { engine, scene_profiles };
  }
  return modules;
}

function error(code, message, extra = {}) {
  return { error: { code, message, ...extra } };
}

const get = (d, k, dflt = null) => py.M.get(d, k, dflt);

export async function prepare(req) {
  const { engine, scene_profiles } = await load();
  const description = req.description || "";
  const feedback = req.feedback || "";
  const previous = req.previous ?? null;
  const original = feedback && previous && typeof previous === "object" ? previous.description : description;
  const representation = scene_profiles.resolve_representation(py.dict(["representation", "auto"], ["notes", feedback]), original ?? "");
  if (UNSUPPORTED.has(get(representation, "id"))) {
    return error(
      "unsupported_representation",
      `The description asks for a ${get(representation, "name")} (${get(representation, "id")}: ` +
        `${get(representation, "selection_reason", "")}). draw.io can't draw materials, lighting or camera ` +
        "views; describe the system as a block diagram instead.",
      { representation: get(representation, "id") },
    );
  }
  const payload = py.dict(
    ["scene", "auto"],
    ["representation", "diagram"],
    ["language", req.language || "en"],
    ["description", description],
    ["feedback", feedback],
    ["lock_structure", Boolean(req.lock_structure ?? false)],
  );
  if (previous !== null) py.setitem(payload, "previous", py.fromJS(previous));
  let messages;
  let context;
  try {
    [messages, context] = engine.prepare_request(payload);
  } catch (e) {
    if (e instanceof py.ValueError) return error("request_invalid", py.str(e));
    throw e;
  }
  for (const m of messages) {
    if (get(m, "role") === "system") py.setitem(m, "content", py.M.replace(get(m, "content"), OUTPUT_SENTENCE, OUTPUT_REPLACEMENT));
  }
  return { messages: py.toJS(messages), context: py.toJS(context), representation: py.toJS(representation) };
}

function routesOk(figure) {
  const quality = get(get(figure, "layout_scene") ?? py.dict(), "quality");
  return quality === null || py.bool(get(quality, "routes_complete", true));
}

function coverage(figure) {
  const sl = get(figure, "structure_layout") ?? py.dict();
  const ids = py.set(get(figure, "node_ids") ?? []);
  ids.update(py.M.keys(get(sl, "node_to_macro") ?? py.dict()));
  const plan = get(figure, "algorithm_flow_plan") ?? py.dict();
  for (const o of py.iter(get(plan, "objects", []))) ids.add(get(o, "source_node_id"));
  return ids.size;
}

function chooseFigure(result) {
  const figures = [...py.iter(py.getitem(result, "figures"))];
  const primary = figures.find((f) => py.bool(get(f, "primary")));
  if ((KINDS[get(primary, "layout_strategy")] ?? "text-only") !== "text-only") return [primary, null];
  const usable = figures.filter((f) => f !== primary && PREFERENCE.includes(get(f, "layout_strategy")) && routesOk(f));
  if (!usable.length) return [primary, null];
  // max() keeps the first of equals, as Python's max with a key
  let best = usable[0];
  let bestKey = py.T(coverage(best), -PREFERENCE.indexOf(get(best, "layout_strategy")));
  for (const f of usable.slice(1)) {
    const k = py.T(coverage(f), -PREFERENCE.indexOf(get(f, "layout_strategy")));
    if (py.gt(k, bestKey)) {
      best = f;
      bestKey = k;
    }
  }
  return [best, primary];
}

function layoutDocument(result) {
  const [figure, replaced] = chooseFigure(result);
  const strategy = get(figure, "layout_strategy");
  const scene = get(figure, "layout_scene") ?? py.dict();
  const warnings = [...py.iter(get(result, "warnings", []))].filter((w) => !DROPPED_WARNINGS.some((s) => w.includes(s)));
  if (replaced) {
    warnings.push(
      `The planned main view (${py.str(get(replaced, "title"))}) couldn't be laid out; this is the engine's ` +
        `"${py.str(get(figure, "title"))}" view instead. If it doesn't show what matters, narrow the description ` +
        "to the system you want and compile again.",
    );
  }
  return {
    version: 1,
    kind: KINDS[strategy] ?? "text-only",
    figure: py.toJS(py.dict(["id", get(figure, "id")], ["title", get(figure, "title")], ["layout_strategy", strategy], ["design_limit", get(figure, "design_limit")])),
    spec: py.toJS(py.getitem(result, "spec")),
    settings: py.toJS(py.getitem(result, "settings")),
    structure_layout: py.toJS(get(figure, "structure_layout")),
    layout_scene: py.toJS(scene),
    label_layout: py.toJS(get(figure, "label_layout")),
    algorithm_flow_plan: py.toJS(get(figure, "algorithm_flow_plan")),
    quality: py.toJS(get(scene, "quality", py.dict())),
    warnings,
  };
}

export async function compile(req) {
  const { engine } = await load();
  const context = req.context;
  if (!context || typeof context !== "object") return error("request_invalid", "compile needs the context prepare returned.");
  let result;
  try {
    result = engine.finish_request(py.fromJS(req.spec), py.fromJS(context));
  } catch (e) {
    if (e instanceof engine.ProvenanceError) return error("spec_invalid", py.str(e), { issues: py.toJS(py.getattr(e, "issues")) });
    if (e instanceof py.ValueError) return error("spec_invalid", py.str(e));
    throw e;
  }
  return { layout: layoutDocument(result) };
}

/** The engine call as lib/engine/index.js expects it. */
export async function call(request) {
  const { op, ...rest } = request;
  const out = op === "prepare" ? await prepare(rest) : op === "compile" ? await compile(rest) : error("request_invalid", `unknown op ${op}`);
  if (out.error) {
    const { code, message, ...details } = out.error;
    throw new DiagramError(message, code, details);
  }
  return out;
}
