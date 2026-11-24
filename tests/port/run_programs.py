"""CPython's answers for tests/port/programs: {module: [repr of each item main() returns]}."""
import importlib
import json
import sys

sys.path.insert(0, sys.argv[1])
out = {}
for name in sys.argv[2:]:
    out[name] = [repr(x) for x in importlib.import_module(name).main()]
sys.stdout.reconfigure(encoding="utf-8")
print(json.dumps(out, ensure_ascii=False))
