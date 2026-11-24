"""Method names the ported silicon modules call, and the ones their own classes define.

    python -I tests/port/method_calls.py <silicon_canvas dir> <module> ...  -> JSON on stdout
"""
import ast
import json
import sys
from pathlib import Path

src = Path(sys.argv[1])
calls, defined = {}, set()
for m in sys.argv[2:]:
    tree = ast.parse((src / f"{m}.py").read_text(encoding="utf-8"))
    imported = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            imported |= {(a.asname or a.name).split(".")[0] for a in n.names}
        elif isinstance(n, ast.ImportFrom):
            imported |= {a.asname or a.name for a in n.names}
        elif isinstance(n, ast.ClassDef):
            defined |= {f.name for f in n.body if isinstance(f, ast.FunctionDef)}
    for n in ast.walk(tree):
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute):
            # module.function(...) calls go to the module shims, not to methods
            if isinstance(n.func.value, ast.Name) and n.func.value.id in imported:
                continue
            calls.setdefault(n.func.attr, f"{m}.py:{n.lineno}")
json.dump({"calls": calls, "defined": sorted(defined)}, sys.stdout)
