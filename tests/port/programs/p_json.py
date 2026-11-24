"""json.dumps/loads byte for byte."""
import json


def main():
    data = [
        {"b": 1, "a": [1, 2.0, 2.5, -0.0, 1e20, 1e-7, None, True, False], "c": {"z": "片上", "y": "tab\t\"q\"\\   \U0001f642"}},
        [], {}, "", 0, 1.0, 3.14, [[], [{}]], {"nested": {"deep": {"er": [1, {"x": [2]}]}}},
        {3: "int key", 2.5: "float key", True: "bool key", None: "none key"},
        (1, 2, (3,)), {"ctrl": "\x00\x1f\x7f", "uni": "é ß 🙂"},
    ]
    out = []
    for d in data:
        out.append(json.dumps(d))
        out.append(json.dumps(d, ensure_ascii=False))
        out.append(json.dumps(d, sort_keys=True) if not (isinstance(d, dict) and 3 in d) else "")
        out.append(json.dumps(d, indent=2, ensure_ascii=False))
        out.append(json.dumps(d, separators=(",", ":")))
        out.append(json.dumps(d, indent=1, separators=(",", ": ")))
    texts = ['{"a": 1, "b": 1.0, "c": [1e5, -2, 0.5], "d": "\\u00e9\\ud83d\\ude42", "e": null}', "[1, 2.50, 3e0, -0, 1000000000000000]", '"x"', '{"dup": 1, "dup": 2}']
    for t in texts:
        v = json.loads(t)
        out.append([repr(v), json.dumps(v)])
    out.append(json.dumps(float("inf")))
    out.append(json.dumps({"k": float("nan")}))
    return out
