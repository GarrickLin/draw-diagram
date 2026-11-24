// 引擎实现：silicon-canvas 转成 JS 后在本进程内运行，不需要 Python。
//
// 这里逐行对应第一阶段的 Python 桥（tools/port/bridge.py），并且全程用 Python 语义的对象计算
// （py/runtime.js），保证行为一致：同样的 prepare（先判断表达方式，拒绝产品渲染和空间示意），
// 同样的 compile（只取主图，主图排不出时选覆盖节点最多的视图）。respond() 给出和桥的标准输出
// 逐字节相同的 JSON，tests/port 用它和 CPython 对照。
// silicon/ 下的模块由 tools/port/build_engine.sh 从 tools/port/silicon 生成，不要手改。

import * as py from "./py/runtime.js";
import * as json from "./py/json.js";
import { DiagramError } from "../cli.js";

const UNSUPPORTED = py.S("product_render", "system_illustration");
const OUTPUT_SENTENCE = "Your output will be compiled into a raster Image Gen prompt, NOT Mermaid, SVG, draw.io, code, or a finished image.";
const OUTPUT_REPLACEMENT = "Your output will be laid out by a layout engine and drawn as an editable draw.io diagram; do not write Mermaid, SVG, draw.io XML, code, or a finished image yourself.";
const KINDS = py.dict(
  ["publication-candidates", "publication"],
  ["legacy-technical-annex", "legacy"],
  ["semantic-guide", "behavior"],
  ["algorithm-dependency-plan", "algorithm"],
  ["text-only", "text-only"],
);
const DROPPED_WARNINGS = ["技术附图", "成图", "Image Gen"];
const PREFERENCE = ["publication-candidates", "semantic-guide", "algorithm-dependency-plan", "legacy-technical-annex"];

let modules = null;
/** Loads the transpiled modules; the sync entry points need it done. */
export async function ready() {
  if (modules === null) {
    const [engine, scene_profiles] = await Promise.all([import("./silicon/engine.js"), import("./silicon/scene_profiles.js")]);
    modules = { engine, scene_profiles };
  }
  return modules;
}
function loaded() {
  if (modules === null) throw new Error("js.js: await ready() before the sync calls");
  return modules;
}

const get = (d, k, dflt = null) => py.M.get(d, k, dflt);
const isDict = (v) => v instanceof py.PyDict;

function error(code, message, extra = []) {
  return py.dict(["error", py.dict(["code", code], ["message", message], ...extra)]);
}

function prepare(req) {
  const { engine, scene_profiles } = loaded();
  const description = py.bool(get(req, "description")) ? get(req, "description") : "";
  const feedback = py.bool(get(req, "feedback")) ? get(req, "feedback") : "";
  const previous = get(req, "previous");
  const original = py.bool(feedback) && isDict(previous) ? get(previous, "description") : description;
  const representation = scene_profiles.resolve_representation(py.dict(["representation", "auto"], ["notes", feedback]), original);
  if (py.contains(UNSUPPORTED, py.getitem(representation, "id"))) {
    return error(
      "unsupported_representation",
      `The description asks for a ${py.str(py.getitem(representation, "name"))} (${py.str(py.getitem(representation, "id"))}: ` +
        `${py.str(get(representation, "selection_reason", ""))}). draw.io can't draw materials, lighting or camera ` +
        "views; describe the system as a block diagram instead.",
      [["representation", py.getitem(representation, "id")]],
    );
  }
  const payload = py.dict(
    ["scene", "auto"],
    ["representation", "diagram"],
    ["language", py.bool(get(req, "language")) ? get(req, "language") : "en"],
    ["description", description],
    ["feedback", feedback],
    ["lock_structure", py.bool(get(req, "lock_structure", false))],
  );
  if (previous !== null) py.setitem(payload, "previous", previous);
  let messages;
  let context;
  try {
    [messages, context] = py.unpack(engine.prepare_request(payload), 2);
  } catch (e) {
    if (py.excMatch(e, [py.ValueError])) return error("request_invalid", py.str(e));
    throw e;
  }
  for (const m of py.iter(messages)) {
    if (py.eq(py.getitem(m, "role"), "system")) {
      py.setitem(m, "content", py.M.replace(py.getitem(m, "content"), OUTPUT_SENTENCE, OUTPUT_REPLACEMENT));
    }
  }
  return py.dict(["messages", messages], ["context", context], ["representation", representation]);
}

function coverage(figure) {
  const sl = py.bool(get(figure, "structure_layout")) ? get(figure, "structure_layout") : py.dict();
  const ids = py.set(py.bool(get(figure, "node_ids")) ? get(figure, "node_ids") : []);
  ids.update(py.M.keys(py.bool(get(sl, "node_to_macro")) ? get(sl, "node_to_macro") : py.dict()));
  const plan = py.bool(get(figure, "algorithm_flow_plan")) ? get(figure, "algorithm_flow_plan") : py.dict();
  for (const o of py.iter(get(plan, "objects", []))) ids.add(get(o, "source_node_id"));
  return ids.size;
}

function routesOk(figure) {
  const scene = py.bool(get(figure, "layout_scene")) ? get(figure, "layout_scene") : py.dict();
  const quality = get(scene, "quality");
  return quality === null || py.bool(get(quality, "routes_complete", true));
}

function chooseFigure(result) {
  const figures = [...py.iter(py.getitem(result, "figures"))];
  const primary = figures.find((f) => py.bool(get(f, "primary")));
  if (primary === undefined) throw new py.StopIteration();
  if (get(KINDS, get(primary, "layout_strategy")) !== "text-only") return [primary, null];
  const usable = figures.filter((f) => f !== primary && PREFERENCE.includes(get(f, "layout_strategy")) && routesOk(f));
  if (!usable.length) return [primary, null];
  // max() keeps the first of equals
  let best = usable[0];
  let bestKey = py.T(coverage(best), -PREFERENCE.indexOf(py.getitem(best, "layout_strategy")));
  for (const f of usable.slice(1)) {
    const k = py.T(coverage(f), -PREFERENCE.indexOf(py.getitem(f, "layout_strategy")));
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
  const scene = py.bool(get(figure, "layout_scene")) ? get(figure, "layout_scene") : py.dict();
  const warnings = [...py.iter(get(result, "warnings", []))].filter((w) => !DROPPED_WARNINGS.some((s) => py.contains(w, s)));
  if (replaced) {
    warnings.push(
      `The planned main view (${py.str(get(replaced, "title"))}) couldn't be laid out; this is the engine's ` +
        `"${py.str(get(figure, "title"))}" view instead. If it doesn't show what matters, narrow the description ` +
        "to the system you want and compile again.",
    );
  }
  return py.dict(
    ["version", 1],
    ["kind", get(KINDS, strategy, "text-only")],
    ["figure", py.dict(["id", get(figure, "id")], ["title", get(figure, "title")], ["layout_strategy", strategy], ["design_limit", get(figure, "design_limit")])],
    ["spec", py.getitem(result, "spec")],
    ["settings", py.getitem(result, "settings")],
    ["structure_layout", get(figure, "structure_layout")],
    ["layout_scene", scene],
    ["label_layout", get(figure, "label_layout")],
    ["algorithm_flow_plan", get(figure, "algorithm_flow_plan")],
    ["quality", get(scene, "quality", py.dict())],
    ["warnings", warnings],
  );
}

function compile(req) {
  const { engine } = loaded();
  const spec = get(req, "spec");
  const context = get(req, "context");
  if (!isDict(context)) return error("request_invalid", "compile needs the context prepare returned.");
  let result;
  try {
    result = engine.finish_request(spec, context);
  } catch (e) {
    if (e instanceof engine.ProvenanceError) return error("spec_invalid", py.str(e), [["issues", py.getattr(e, "issues")]]);
    if (py.excMatch(e, [py.ValueError])) return error("spec_invalid", py.str(e));
    throw e;
  }
  return py.dict(["layout", layoutDocument(result)]);
}

/** One bridge request (a JS object), answered as Python objects. */
function handle(request) {
  const req = py.fromJS(request);
  const op = get(req, "op");
  if (op === "prepare") return prepare(req);
  if (op === "compile") return compile(req);
  return error("request_invalid", `unknown op ${py.repr(op)}`);
}

const dump = (out) => json.dumps(out, py.KW({ ensure_ascii: false, sort_keys: true, separators: py.T(",", ":") }));

/** The bridge's stdout for a request, byte for byte: tests/port compares it with tools/port/bridge.py. */
export async function respond(request) {
  await ready();
  return dump(handle(request)) + "\n";
}

/** The engine call as lib/engine/index.js expects it: the answer, or a DiagramError. */
export async function call(request) {
  await ready();
  return callSync(request);
}

/** call() without the await, once ready() has resolved. */
export function callSync(request) {
  // through the bridge's JSON, as phase 1 did: same values and the same (sorted) key order, which
  // the converters' output order follows
  const out = JSON.parse(dump(handle(request)));
  if (out.error) {
    const { code, message, ...details } = out.error;
    throw new DiagramError(message, code, details);
  }
  return out;
}
