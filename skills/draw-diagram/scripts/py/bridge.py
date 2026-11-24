"""Bridge between the Node CLI and the silicon-canvas planning and layout engine.

Reads one JSON request on stdin and writes one JSON object on stdout:

    {"op": "prepare", "description": ..., "language": "zh"|"en", "feedback": ..., "previous": {...}|null}
        -> {"messages": [...], "context": {...}, "representation": {...}}
    {"op": "compile", "spec": {...}, "context": {...}}
        -> {"layout": <layout document>}

Errors are {"error": {"code", "message", ...}} with exit status 0; a non-zero status means the
bridge itself failed. Nothing here reads the clock, the network or a font file.

The layout document is the contract with the Node converters (tests/draw-diagram/layout-doc.schema.json);
the JavaScript engine of phase 2 must produce the same document.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "vendor" / "silicon"))

from silicon_canvas import engine, scene_profiles  # noqa: E402

UNSUPPORTED = {"product_render", "system_illustration"}

# prepare_request tells the model its output becomes an Image Gen prompt; here it becomes a
# draw.io diagram, and the model should not write draw.io XML itself.
OUTPUT_SENTENCE = "Your output will be compiled into a raster Image Gen prompt, NOT Mermaid, SVG, draw.io, code, or a finished image."
OUTPUT_REPLACEMENT = "Your output will be laid out by a layout engine and drawn as an editable draw.io diagram; do not write Mermaid, SVG, draw.io XML, code, or a finished image yourself."

KINDS = {
    "publication-candidates": "publication",
    "legacy-technical-annex": "legacy",
    "semantic-guide": "behavior",
    "algorithm-dependency-plan": "algorithm",
    "text-only": "text-only",
}

# Warnings about the technical annexes and the Image Gen bitmap don't apply to one draw.io page.
DROPPED_WARNINGS = ("技术附图", "成图", "Image Gen")


def error(code, message, **extra):
    return {"error": {"code": code, "message": message, **extra}}


def prepare(req):
    description = req.get("description") or ""
    feedback = req.get("feedback") or ""
    previous = req.get("previous")
    # Judge the medium from the user's words before forcing a diagram: a product render or a
    # spatial illustration needs materials and lighting that draw.io can't draw.
    original = previous.get("description") if feedback and isinstance(previous, dict) else description
    representation = scene_profiles.resolve_representation({"representation": "auto", "notes": feedback}, original)
    if representation["id"] in UNSUPPORTED:
        return error("unsupported_representation",
                     f"The description asks for a {representation['name']} ({representation['id']}: "
                     f"{representation.get('selection_reason', '')}). draw.io can't draw materials, lighting or camera "
                     "views; describe the system as a block diagram instead.",
                     representation=representation["id"])
    payload = {
        "scene": "auto",
        "representation": "diagram",
        "language": req.get("language") or "en",
        "description": description,
        "feedback": feedback,
        "lock_structure": bool(req.get("lock_structure", False)),
    }
    if previous is not None:
        payload["previous"] = previous
    try:
        messages, context = engine.prepare_request(payload)
    except ValueError as e:
        return error("request_invalid", str(e))
    for m in messages:
        if m["role"] == "system":
            m["content"] = m["content"].replace(OUTPUT_SENTENCE, OUTPUT_REPLACEMENT)
    return {"messages": messages, "context": context, "representation": representation}


# When the main figure has no drawable layout, another view stands in for it: draw-diagram draws one
# figure, and a view with a layout beats a refusal. The view that shows the most of the spec wins;
# among equals, the newer layout grammars first.
PREFERENCE = ["publication-candidates", "semantic-guide", "algorithm-dependency-plan", "legacy-technical-annex"]


def _coverage(figure):
    sl = figure.get("structure_layout") or {}
    ids = set(figure.get("node_ids") or []) | set((sl.get("node_to_macro") or {}).keys())
    plan = figure.get("algorithm_flow_plan") or {}
    ids |= {o.get("source_node_id") for o in plan.get("objects", [])}
    return len(ids)


def choose_figure(result):
    figures = result["figures"]
    primary = next(f for f in figures if f.get("primary"))
    if KINDS.get(primary.get("layout_strategy")) != "text-only":
        return primary, None
    usable = [f for f in figures if f is not primary and f.get("layout_strategy") in PREFERENCE and _routes_ok(f)]
    if not usable:
        return primary, None
    best = max(usable, key=lambda f: (_coverage(f), -PREFERENCE.index(f["layout_strategy"])))
    return best, primary


def _routes_ok(figure):
    quality = (figure.get("layout_scene") or {}).get("quality")
    return quality is None or quality.get("routes_complete", True)


def layout_document(result):
    figure, replaced = choose_figure(result)
    strategy = figure.get("layout_strategy")
    scene = figure.get("layout_scene") or {}
    return {
        "version": 1,
        "kind": KINDS.get(strategy, "text-only"),
        "figure": {
            "id": figure.get("id"),
            "title": figure.get("title"),
            "layout_strategy": strategy,
            "design_limit": figure.get("design_limit"),
        },
        "spec": result["spec"],
        "settings": result["settings"],
        "structure_layout": figure.get("structure_layout"),
        "layout_scene": scene,
        "label_layout": figure.get("label_layout"),
        "algorithm_flow_plan": figure.get("algorithm_flow_plan"),
        "quality": scene.get("quality", {}),
        "warnings": [w for w in result.get("warnings", []) if not any(s in w for s in DROPPED_WARNINGS)]
        + ([f"The planned main view ({replaced.get('title')}) couldn't be laid out; this is the engine's "
            f"\"{figure.get('title')}\" view instead. If it doesn't show what matters, narrow the description "
            "to the system you want and compile again."] if replaced else []),
    }


def compile_(req):
    spec, context = req.get("spec"), req.get("context")
    if not isinstance(context, dict):
        return error("request_invalid", "compile needs the context prepare returned.")
    try:
        result = engine.finish_request(spec, context)
    except engine.ProvenanceError as e:
        return error("spec_invalid", str(e), issues=e.issues)
    except ValueError as e:
        return error("spec_invalid", str(e))
    return {"layout": layout_document(result)}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        import PIL  # noqa: F401  label placement uses Pillow; without it labels silently go missing
    except ImportError:
        print(json.dumps(error("engine_unavailable",
                               f"The layout engine needs Pillow, which {sys.executable} doesn't have. "
                               "Point DRAW_DIAGRAM_PYTHON at a Python 3.11+ with Pillow installed.")))
        return
    try:
        req = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    except ValueError as e:
        print(json.dumps(error("request_invalid", f"the request isn't JSON: {e}")))
        return
    op = req.get("op")
    handler = {"prepare": prepare, "compile": compile_}.get(op)
    out = handler(req) if handler else error("request_invalid", f"unknown op {op!r}")
    sys.stdout.write(json.dumps(out, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
