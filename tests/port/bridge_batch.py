"""tools/port/bridge.py over many requests: one JSON request per stdin line, one answer per stdout line.

Each answer is exactly what `python bridge.py` would print for that request. A request that
crashes the bridge comes back as {"crash": <exception type>, "message": ...} instead of a
traceback, so the parity runner can compare crashes too.

    PYTHONHASHSEED=0 python -s -P -B tests/port/bridge_batch.py tools/port/bridge.py
"""
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("bridge", sys.argv[1])
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
sys.stdout.reconfigure(encoding="utf-8")

for line in sys.stdin.buffer:
    req = json.loads(line.decode("utf-8"))
    op = req.get("op")
    handler = {"prepare": bridge.prepare, "compile": bridge.compile_}.get(op)
    try:
        out = handler(req) if handler else bridge.error("request_invalid", f"unknown op {op!r}")
        text = json.dumps(out, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except Exception as e:  # noqa: BLE001  every crash is reported, by type
        text = json.dumps({"crash": type(e).__name__, "message": str(e)[:300]}, ensure_ascii=False)
    sys.stdout.write(text + "\n")
    sys.stdout.flush()
