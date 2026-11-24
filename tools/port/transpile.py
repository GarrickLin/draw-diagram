"""Transpile silicon-canvas's Python modules to JavaScript modules on lib/engine/py/runtime.js.

    python3 tools/port/transpile.py <src-dir> <out-dir> [module ...]

Every operation whose meaning differs between Python and JS goes through the runtime: truth
values, ==, <, +, indexing, slicing, iteration, unpacking, dict/set/tuple, str methods and
builtins. Python's scoping is kept by declaring every local of a function at its top (`let`),
as Python does, and by running comprehensions in their own function. The output reads like the
source, function for function, so a change upstream maps to the same place here.

The transpiler only handles the Python the silicon-canvas modules are written in; anything else
stops it with the file and line, rather than guessing.
"""

from __future__ import annotations

import ast
import re
import math
import json
import sys
from pathlib import Path

JS_RESERVED = {
    "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete",
    "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if", "implements",
    "import", "in", "instanceof", "interface", "let", "new", "null", "package", "private", "protected",
    "public", "return", "static", "super", "switch", "this", "throw", "true", "try", "typeof", "var",
    "void", "while", "with", "yield", "arguments", "eval", "undefined", "NaN", "Infinity", "py",
}

# Python builtins → JS expressions. Callables taking keyword arguments accept a trailing py.KW.
BUILTINS = {
    "len": "py.len", "sorted": "py.sorted", "min": "py.min", "max": "py.max", "sum": "py.sum",
    "abs": "py.abs", "any": "py.any", "all": "py.all", "enumerate": "py.enumerate", "zip": "py.zip",
    "map": "py.map", "filter": "py.filter", "reversed": "py.reversed", "range": "py.range",
    "round": "py.round", "int": "py.int", "float": "py.float", "str": "py.strCall", "bool": "py.bool",
    "list": "py.list", "tuple": "py.tuple", "set": "py.set", "frozenset": "py.frozenset",
    "dict": "py.dictCall", "repr": "py.repr", "ord": "py.ord", "chr": "py.chr", "iter": "py.pyiter",
    "next": "py.next", "isinstance": "py.isinstance", "type": "py.type", "getattr": "py.getattr",
    "hasattr": "py.hasattr", "setattr": "py.setattr", "format": "py.format", "open": "pathlib.open",
    "print": "py.print", "callable": "py.callable", "id": "py.id", "hash": "py.hashOf",
    "ValueError": "py.ValueError", "TypeError": "py.TypeError_", "KeyError": "py.KeyError",
    "IndexError": "py.IndexError", "ZeroDivisionError": "py.ZeroDivisionError",
    "ImportError": "py.ImportError", "OSError": "py.OSError", "RuntimeError": "py.RuntimeError",
    "AttributeError": "py.AttributeError", "StopIteration": "py.StopIteration",
    "Exception": "py.Exception", "BaseException": "py.BaseException", "LookupError": "py.LookupError",
    "ArithmeticError": "py.ArithmeticError", "NotImplementedError": "py.NotImplementedError",
    "AssertionError": "py.AssertionError", "RecursionError": "py.RecursionError",
    "__file__": "__file__",
}
EXCEPTIONS = {k for k, v in BUILTINS.items() if k.endswith("Error") or k in ("Exception", "BaseException", "StopIteration")}
TYPE_NAMES = {"dict", "list", "tuple", "set", "frozenset", "str", "int", "float", "bool"}

# Names imported from the standard library → JS.
FROM_IMPORTS = {
    ("collections", "defaultdict"): ("py.defaultdict", "func"),
    ("collections", "Counter"): ("py.counter", "func"),
    ("collections", "deque"): ("py.deque", "func"),
    ("copy", "deepcopy"): ("py.deepcopy", "func"),
    ("functools", "lru_cache"): ("py.lru_cache", "decorator"),
    ("pathlib", "Path"): ("pathlib.Path", "class"),
    ("pathlib", "PurePosixPath"): ("pathlib.PurePosixPath", "class"),
    ("typing", "Any"): (None, "ignore"),
    ("PIL", "Image"): ("pil.Image", "module"),
    ("PIL", "ImageDraw"): ("pil.ImageDraw", "module"),
    ("PIL", "ImageFont"): ("pil.ImageFont", "module"),
}
SHIM_MODULES = {"re", "math", "json", "hashlib", "heapq", "os", "io", "copy"}
# Nested functions with a hand-written fast path in lib/engine/fast/<module>.js, and the closure
# variables the fast path reads. The generated code passes it the generic function to fall back on.
FAST = {
    ("structure_scene", "astar"): ["maxx", "maxy", "blocked", "occupied", "segment_colors"],
}

SHIM_FILES = {"re": "re", "math": "math", "json": "json", "hashlib": "hashlib", "heapq": "heapq",
              "os": "os", "io": "io", "pathlib": "pathlib", "pil": "pil", "copy": "copy"}
SHIM_ATTRS = {("copy", "deepcopy"): "py.deepcopy", ("copy", "copy"): "py.shallowcopy"}

BINOPS = {
    ast.Add: "add", ast.Sub: "sub", ast.Mult: "mul", ast.Div: "truediv", ast.FloorDiv: "floordiv",
    ast.Mod: "mod", ast.Pow: "pow", ast.BitAnd: "bitand", ast.BitOr: "bitor", ast.BitXor: "bitxor",
    ast.LShift: "lshift", ast.RShift: "rshift",
}
AUGOPS = {**BINOPS, ast.Add: "iadd", ast.Sub: "isub", ast.Mult: "imul", ast.BitOr: "ior", ast.BitAnd: "iand", ast.BitXor: "ixor"}
CMPOPS = {ast.Eq: "eq", ast.NotEq: "ne", ast.Lt: "lt", ast.LtE: "le", ast.Gt: "gt", ast.GtE: "ge"}


FOLDABLE_BINOPS = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow, ast.LShift, ast.RShift,
                   ast.BitAnd, ast.BitOr, ast.BitXor)


def folds_to_constant(e) -> bool:
    """Whether CPython's optimizer turns the expression into a constant (numbers, strings, tuples of those)."""
    if isinstance(e, ast.Constant):
        return True
    if isinstance(e, ast.UnaryOp) and isinstance(e.op, (ast.USub, ast.UAdd, ast.Invert)):
        return folds_to_constant(e.operand)
    if isinstance(e, ast.BinOp) and isinstance(e.op, FOLDABLE_BINOPS):
        return folds_to_constant(e.left) and folds_to_constant(e.right)
    if isinstance(e, ast.Tuple):
        return all(folds_to_constant(x) for x in e.elts)
    return False


class Unsupported(Exception):
    pass


def js_name(name: str) -> str:
    return name + "$" if name in JS_RESERVED else name


def js_str(s: str) -> str:
    return json.dumps(s, ensure_ascii=False).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def assigned_names(body, include_defs=True):
    """Names a function body binds (Python's locals), not looking into nested scopes."""
    names: list[str] = []

    def add(n):
        if n not in names:
            names.append(n)

    def target(t):
        if isinstance(t, ast.Name):
            add(t.id)
        elif isinstance(t, (ast.Tuple, ast.List)):
            for e in t.elts:
                target(e)
        elif isinstance(t, ast.Starred):
            target(t.value)

    def visit(node):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if include_defs:
                add(node.name)
            return
        if isinstance(node, (ast.Lambda, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            return
        if isinstance(node, ast.Assign):
            for t in node.targets:
                target(t)
        elif isinstance(node, (ast.AugAssign, ast.AnnAssign)):
            target(node.target)
        elif isinstance(node, (ast.For, ast.AsyncFor)):
            target(node.target)
        elif isinstance(node, ast.With):
            for item in node.items:
                if item.optional_vars is not None:
                    target(item.optional_vars)
        elif isinstance(node, ast.ExceptHandler):
            if node.name:
                add(node.name)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for a in node.names:
                add((a.asname or a.name).split(".")[0])
        elif isinstance(node, ast.NamedExpr):
            target(node.target)
        for child in ast.iter_child_nodes(node):
            visit(child)

    for stmt in body:
        visit(stmt)
    return names


def contains_yield(fn):
    def visit(node):
        if isinstance(node, (ast.Yield, ast.YieldFrom)):
            return True
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)) and node is not fn:
            return False
        return any(visit(c) for c in ast.iter_child_nodes(node))

    return any(visit(s) for s in fn.body)


class Scope:
    def __init__(self, kind, names=(), parent=None, globals_=(), nonlocals=()):
        self.kind = kind  # module | function | class | comp
        self.names = set(names)
        self.parent = parent
        self.globals = set(globals_)
        self.nonlocals = set(nonlocals)

    def defines(self, name):
        s = self
        while s is not None:
            if name in s.names and not (s.kind == "class"):
                return s
            s = s.parent
        return None


class Transpiler:
    def __init__(self, module: str, source: str, silicon_modules: set[str]):
        self.module = module
        self.fast_used = False
        self.source = source
        self.tree = ast.parse(source)
        self.silicon = silicon_modules
        self.tmp = 0
        self.imports_ns: dict[str, str] = {}  # alias -> "./x.js" (silicon) or shim file
        self.from_names: dict[str, str] = {}  # name -> JS expression (module attribute or builtin)
        self.name_kind: dict[str, str] = {}  # name -> class | func | module | decorator
        self.classes: set[str] = set()
        self.shims: set[str] = {"pathlib"}
        self.module_funcs: dict[str, ast.FunctionDef] = {}
        self.exc_stack: list[str] = []
        self.float_consts: dict[str, str] = {}
        self.out: list[str] = []
        self.func_stack: list[ast.AST] = []

    # ─── helpers ─────────────────────────────────────────────────

    def fail(self, node, msg):
        raise Unsupported(f"{self.module}.py:{getattr(node, 'lineno', '?')}: {msg}: {ast.unparse(node)[:120] if isinstance(node, ast.AST) else ''}")

    def new_tmp(self):
        self.tmp += 1
        return f"$t{self.tmp}"

    # ─── module ──────────────────────────────────────────────────

    def collect_imports(self):
        for node in ast.walk(self.tree):
            if isinstance(node, ast.ImportFrom):
                if node.level == 1:
                    if node.module:
                        mod = node.module.split(".")[0]
                        self.imports_ns.setdefault(mod, f"./{mod}.js")
                        for a in node.names:
                            self.from_names[a.asname or a.name] = f"{mod}.{a.name}"
                    else:
                        for a in node.names:
                            self.imports_ns.setdefault(a.asname or a.name, f"./{a.name}.js")
                elif node.level == 0:
                    if node.module == "__future__":
                        continue
                    for a in node.names:
                        key = (node.module, a.name)
                        if key not in FROM_IMPORTS:
                            self.fail(node, f"import of {node.module}.{a.name}")
                        expr, kind = FROM_IMPORTS[key]
                        if kind == "ignore":
                            continue
                        self.from_names[a.asname or a.name] = expr
                        self.name_kind[a.asname or a.name] = kind
                        self.shims.add(expr.split(".")[0]) if not expr.startswith("py.") else None
            elif isinstance(node, ast.Import):
                for a in node.names:
                    if a.name not in SHIM_MODULES:
                        self.fail(node, f"import {a.name}")
                    self.shims.add(a.name)

    def import_name(self, name, scope):
        """Whether `name` here means an imported module or name, not a variable."""
        owner = scope.defines(name)
        return owner is None or (owner.kind == "module" and name in self.top_imports)

    def transpile(self) -> str:
        self.collect_imports()
        body = [s for s in self.tree.body if not self.is_docstring(s)]
        self.top_imports = {(a.asname or a.name).split(".")[0] for st in body if isinstance(st, (ast.Import, ast.ImportFrom)) for a in st.names}
        top_names = assigned_names(body)
        for s in body:
            if isinstance(s, ast.FunctionDef):
                self.module_funcs[s.name] = s
            if isinstance(s, ast.ClassDef):
                self.classes.add(s.name)
        scope = Scope("module", top_names)
        lines = []
        decl = [js_name(n) for n in top_names if n not in self.module_funcs and n not in self.classes
                and n not in self.from_names and n not in self.imports_ns and n not in SHIM_MODULES]
        # a list in source order, so the generated declarations don't depend on string hashing
        self.wrapped = [s.name for s in body if isinstance(s, ast.FunctionDef) and (s.decorator_list or self.has_captured_defaults(s.args))]
        decl += [js_name(n) for n in self.wrapped]
        code = []
        for s in body:
            code.extend(self.stmt(s, scope, 0, module_level=True))
        head = [
            f"// Generated by tools/port/transpile.py from silicon_canvas/{self.module}.py. Do not edit.",
            "",
            'import * as py from "../py/runtime.js";',
        ]
        for shim in sorted(self.shims):
            head.append(f'import * as {shim} from "../py/{SHIM_FILES[shim]}.js";')
        if self.fast_used:
            head.append(f'import * as $fast from "../fast/{self.module}.js";')
        for alias, path in sorted(self.imports_ns.items()):
            head.append(f'import * as {js_name(alias)} from "{path}";')
        head.append('import { fileURLToPath as $fileURLToPath } from "node:url";')
        head.append("")
        head.append("const __file__ = $fileURLToPath(import.meta.url).replace(/\\.js$/, \".py\");")
        for name, val in self.float_consts.items():
            head.append(f"const {name} = py.F({val});")
        if decl:
            head.append("export let " + ", ".join(decl) + ";")
        sigs = []
        for name, fn in self.module_funcs.items():
            if name in self.wrapped:
                continue
            sigs.append(self.sig_call(js_name(name), fn.args))
        return "\n".join(head + sigs + [""] + code) + "\n"

    @staticmethod
    def is_docstring(s):
        return isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant) and isinstance(s.value.value, str)

    def sig_call(self, fn_expr, args: ast.arguments):
        params = [a.arg for a in args.posonlyargs + args.args]
        if params and params[0] == "self" and self.func_is_method:
            params = params[1:]
        params += [a.arg for a in args.kwonlyargs]
        opts = []
        if args.kwarg:
            opts.append("kwarg: true")
        if args.vararg:
            opts.append("vararg: true")
        o = (", {" + ", ".join(opts) + "}") if opts else ""
        return f"py.sig({fn_expr}, {json.dumps(params)}{o});"

    func_is_method = False

    # ─── statements ──────────────────────────────────────────────

    def block(self, stmts, scope, ind):
        out = []
        for s in stmts:
            out.extend(self.stmt(s, scope, ind))
        return out

    def stmt(self, s, scope, ind, module_level=False):
        p = "  " * ind
        if self.is_docstring(s):
            return []
        if isinstance(s, ast.FunctionDef):
            return self.function_def(s, scope, ind, module_level)
        if isinstance(s, ast.ClassDef):
            return self.class_def(s, scope, ind)
        if isinstance(s, ast.Return):
            return [p + ("return null;" if s.value is None else f"return {self.expr(s.value, scope)};")]
        if isinstance(s, ast.Assign):
            if len(s.targets) == 1:
                return self.assign(s.targets[0], self.expr(s.value, scope), scope, ind)
            t = self.new_tmp()
            out = [p + f"const {t} = {self.expr(s.value, scope)};"]
            for tg in s.targets:
                out += self.assign(tg, t, scope, ind)
            return out
        if isinstance(s, ast.AnnAssign):
            if s.value is None:
                return []
            return self.assign(s.target, self.expr(s.value, scope), scope, ind)
        if isinstance(s, ast.AugAssign):
            return self.aug_assign(s, scope, ind)
        if isinstance(s, ast.Expr):
            if isinstance(s.value, ast.Constant):
                return []
            return [p + self.expr(s.value, scope) + ";"]
        if isinstance(s, ast.If):
            out = [p + f"if ({self.test(s.test, scope)}) {{"]
            out += self.block(s.body, scope, ind + 1)
            orelse = s.orelse
            while len(orelse) == 1 and isinstance(orelse[0], ast.If):
                e = orelse[0]
                out.append(p + f"}} else if ({self.test(e.test, scope)}) {{")
                out += self.block(e.body, scope, ind + 1)
                orelse = e.orelse
            if orelse:
                out.append(p + "} else {")
                out += self.block(orelse, scope, ind + 1)
            out.append(p + "}")
            return out
        if isinstance(s, ast.For):
            if s.orelse:
                self.fail(s, "for-else")
            v = self.new_tmp()
            out = [p + f"for (const {v} of {self.iterable(s.iter, scope)}) {{"]
            out += self.assign(s.target, v, scope, ind + 1)
            out += self.block(s.body, scope, ind + 1)
            out.append(p + "}")
            return out
        if isinstance(s, ast.While):
            if s.orelse:
                self.fail(s, "while-else")
            out = [p + f"while ({self.test(s.test, scope)}) {{"]
            out += self.block(s.body, scope, ind + 1)
            out.append(p + "}")
            return out
        if isinstance(s, ast.Break):
            return [p + "break;"]
        if isinstance(s, ast.Continue):
            return [p + "continue;"]
        if isinstance(s, ast.Pass):
            return []
        if isinstance(s, ast.Raise):
            if s.exc is None:
                if not self.exc_stack:
                    self.fail(s, "bare raise outside except")
                return [p + f"throw {self.exc_stack[-1]};"]
            return [p + f"throw {self.raise_expr(s.exc, scope)};"]
        if isinstance(s, ast.Try):
            return self.try_stmt(s, scope, ind)
        if isinstance(s, ast.With):
            if len(s.items) != 1:
                self.fail(s, "with of several items")
            item = s.items[0]
            ctx = self.new_tmp()
            out = [p + f"const {ctx} = {self.expr(item.context_expr, scope)};"]
            if item.optional_vars is not None:
                out += self.assign(item.optional_vars, ctx, scope, ind)
            out.append(p + "try {")
            out += self.block(s.body, scope, ind + 1)
            out.append(p + "} finally {")
            out.append(p + f"  if (typeof {ctx}.close === \"function\") {ctx}.close();")
            out.append(p + "}")
            return out
        if isinstance(s, (ast.Global, ast.Nonlocal)):
            return []
        if isinstance(s, (ast.Import, ast.ImportFrom)):
            # imports are hoisted to the module: the names resolve to the module namespace
            return []
        if isinstance(s, ast.Assert):
            msg = f", {self.expr(s.msg, scope)}" if s.msg else ""
            return [p + f"if (!({self.test(s.test, scope)})) throw new py.AssertionError({msg[2:]});"]
        if isinstance(s, ast.Delete):
            out = []
            for t in s.targets:
                if isinstance(t, ast.Subscript):
                    out.append(p + f"py.delitem({self.expr(t.value, scope)}, {self.index(t.slice, scope)});")
                else:
                    self.fail(s, "del of a name")
            return out
        self.fail(s, f"statement {type(s).__name__}")

    def try_stmt(self, s, scope, ind):
        p = "  " * ind
        out = [p + "try {"]
        out += self.block(s.body, scope, ind + 1)
        if s.handlers:
            e = self.new_tmp()
            out.append(p + f"}} catch ({e}) {{")
            first = True
            for h in s.handlers:
                if h.type is None:
                    cond = "true"
                else:
                    types = h.type.elts if isinstance(h.type, ast.Tuple) else [h.type]
                    cond = f"py.excMatch({e}, [{', '.join(self.expr(t, scope) for t in types)}])"
                out.append(p + ("  if" if first else "  } else if") + f" ({cond}) {{")
                first = False
                if h.name:
                    out.append(p + f"    {js_name(h.name)} = {e};")
                self.exc_stack.append(e)
                out += self.block(h.body, scope, ind + 2)
                self.exc_stack.pop()
            out.append(p + "  } else {")
            out.append(p + f"    throw {e};")
            out.append(p + "  }")
        if s.orelse:
            self.fail(s, "try-else")
        if s.finalbody:
            out.append(p + "} finally {")
            out += self.block(s.finalbody, scope, ind + 1)
        out.append(p + "}")
        return out

    def raise_expr(self, exc, scope):
        return self.expr(exc, scope) if not isinstance(exc, ast.Name) else (
            f"new {self.expr(exc, scope)}()" if exc.id in EXCEPTIONS or exc.id in self.classes else self.expr(exc, scope))

    def assign(self, target, value_js, scope, ind):
        p = "  " * ind
        if isinstance(target, ast.Name):
            return [p + f"{self.name_store(target.id, scope)} = {value_js};"]
        if isinstance(target, (ast.Tuple, ast.List)):
            star = next((i for i, e in enumerate(target.elts) if isinstance(e, ast.Starred)), -1)
            n = len(target.elts) - (1 if star >= 0 else 0)
            u = self.new_tmp()
            out = [p + f"const {u} = py.unpack({value_js}, {n}{', ' + str(star) if star >= 0 else ''});"]
            for i, e in enumerate(target.elts):
                if isinstance(e, ast.Starred):
                    out += self.assign(e.value, f"{u}[{i}]", scope, ind)
                else:
                    out += self.assign(e, f"{u}[{i}]", scope, ind)
            return out
        if isinstance(target, ast.Subscript):
            return [p + f"py.setitem({self.expr(target.value, scope)}, {self.index(target.slice, scope)}, {value_js});"]
        if isinstance(target, ast.Attribute):
            return [p + f"{self.expr(target.value, scope)}.{target.attr} = {value_js};"]
        self.fail(target, "assignment target")

    def aug_assign(self, s, scope, ind):
        p = "  " * ind
        op = AUGOPS.get(type(s.op))
        if op is None:
            self.fail(s, "augmented operator")
        v = self.expr(s.value, scope)
        t = s.target
        if isinstance(t, ast.Name):
            n = self.name_store(t.id, scope)
            return [p + f"{n} = py.{op}({self.name_load(t.id, scope, t)}, {v});"]
        if isinstance(t, ast.Subscript):
            return [p + f"py.augitem({self.expr(t.value, scope)}, {self.index(t.slice, scope)}, py.{op}, {v});"]
        if isinstance(t, ast.Attribute):
            o = self.new_tmp()
            return [p + f"const {o} = {self.expr(t.value, scope)};", p + f"{o}.{t.attr} = py.{op}({o}.{t.attr}, {v});"]
        self.fail(s, "augmented target")

    # ─── functions and classes ───────────────────────────────────

    def params_js(self, args: ast.arguments, scope, skip_self=False):
        """JS parameter list. Defaults that aren't literals are captured when the def runs."""
        positional = args.posonlyargs + args.args
        defaults = [None] * (len(positional) - len(args.defaults)) + list(args.defaults)
        items = list(zip(positional, defaults))
        if skip_self:
            items = items[1:]
        items += list(zip(args.kwonlyargs, args.kw_defaults))
        out, captured = [], []
        for a, d in items:
            name = js_name(a.arg)
            if d is None:
                out.append(name)
            elif self.is_literal(d):
                out.append(f"{name} = {self.expr(d, scope)}")
            else:
                c = self.new_tmp()
                captured.append((c, self.expr(d, scope)))
                out.append(f"{name} = {c}")
        if args.vararg:
            if args.kwonlyargs:
                self.fail(args, "keyword-only parameters after *args")
            out.append("..." + js_name(args.vararg.arg))
        if args.kwarg and not args.vararg:
            out.append(js_name(args.kwarg.arg))
        return out, captured

    def has_captured_defaults(self, args):
        ds = list(args.defaults) + [d for d in args.kw_defaults if d is not None]
        return any(not self.is_literal(d) for d in ds)

    def is_literal(self, d):
        if isinstance(d, ast.Constant):
            return True
        if isinstance(d, ast.UnaryOp) and isinstance(d.op, ast.USub) and isinstance(d.operand, ast.Constant):
            return True
        return False

    def function_body(self, fn, scope, ind, is_method=False):
        """Statements of a function body, with locals declared at the top as Python scopes them."""
        p = "  " * ind
        direct = self.direct_statements(fn.body)
        globals_ = {n for s in direct if isinstance(s, ast.Global) for n in s.names}
        nonlocals = {n for s in direct if isinstance(s, ast.Nonlocal) for n in s.names}
        params = [a.arg for a in fn.args.posonlyargs + fn.args.args + fn.args.kwonlyargs]
        if fn.args.vararg:
            params.append(fn.args.vararg.arg)
        if fn.args.kwarg:
            params.append(fn.args.kwarg.arg)
        imported = set()
        for st in self.direct_statements(fn.body):
            if isinstance(st, (ast.Import, ast.ImportFrom)):
                imported |= {(a.asname or a.name).split(".")[0] for a in st.names}
        local = [n for n in assigned_names(fn.body) if n not in globals_ and n not in nonlocals and n not in params
                 and n not in imported]
        inner = Scope("function", set(local) | set(params), scope, globals_, nonlocals)
        out = []
        if is_method:
            out.append(p + "const self = this;")
        if local:
            out.append(p + "let " + ", ".join(js_name(n) for n in local) + ";")
        if fn.args.vararg:
            v = js_name(fn.args.vararg.arg)
            out.append(p + f"{v} = py.tuple({v});")
        if fn.args.kwarg:
            k = js_name(fn.args.kwarg.arg)
            out.append(p + f"if ({k} === undefined) {k} = py.dict();")
        self.func_stack.append(fn)
        body = [s for s in fn.body if not self.is_docstring(s)]
        out += self.block(body, inner, ind)
        self.func_stack.pop()
        return out

    def direct_statements(self, body):
        """Statements of a body, descending into blocks but not into nested scopes."""
        out = []
        for st in body:
            out.append(st)
            for field in ("body", "orelse", "finalbody", "handlers"):
                sub = getattr(st, field, None)
                if isinstance(sub, list) and not isinstance(st, (ast.FunctionDef, ast.ClassDef)):
                    out += self.direct_statements(sub)
        return out

    def function_def(self, fn, scope, ind, module_level):
        p = "  " * ind
        gen = "*" if contains_yield(fn) else ""
        name = js_name(fn.name)
        params, captured = self.params_js(fn.args, scope)
        body = self.function_body(fn, scope, ind + 1)
        self.func_is_method = False
        fast = FAST.get((self.module, fn.name))
        if fast is not None:
            # hand-written fast path (lib/engine/fast/<module>.js) wrapping the generic function
            if module_level or fn.decorator_list or captured or gen:
                self.fail(fn, "fast path form")
            self.fast_used = True
            env = ", ".join(js_name(n) for n in fast)
            sig = self.sig_call("$f", fn.args).replace("py.sig($f, ", "")[:-2]
            lines = [f"py.sig($fast.{name}(function {name}({', '.join(params)}) {{"] + body
            lines.append(p + f"}}, () => [{env}]), {sig});")
            lines[0] = p + f"{self.name_store(fn.name, scope)} = " + lines[0]
            return lines
        if module_level and not fn.decorator_list and not captured:
            return [p + f"export function{gen} {name}({', '.join(params)}) {{"] + body + [p + "}", ""]
        func = [f"function{gen} {name}({', '.join(params)}) {{"] + body + [p + "}"]
        expr_lines = func
        sig = self.sig_call("$f", fn.args).replace("py.sig($f, ", "")[:-2]  # params list + opts
        wrapped_head = f"py.sig("
        lines = [wrapped_head + expr_lines[0]] + expr_lines[1:]
        lines[-1] = lines[-1] + f", {sig})"
        for dec in reversed(fn.decorator_list):
            dname = dec.func.id if isinstance(dec, ast.Call) else dec.id if isinstance(dec, ast.Name) else None
            if self.name_kind.get(dname) != "decorator":
                self.fail(fn, "decorator")
            lines[0] = f"{self.from_names[dname]}(" + lines[0]
            lines[-1] = lines[-1] + ")"
        if captured:
            cs = ", ".join(c for c, _ in captured)
            vs = ", ".join(v for _, v in captured)
            lines[0] = f"(({cs}) => " + lines[0]
            lines[-1] = lines[-1] + f")({vs})"
        lines[0] = p + f"{self.name_store(fn.name, scope)} = " + lines[0]
        lines[-1] = lines[-1] + ";"
        return lines + ([""] if module_level else [])

    def class_def(self, c, scope, ind):
        p = "  " * ind
        if len(c.bases) > 1 or c.keywords or c.decorator_list:
            self.fail(c, "class form")
        base = self.expr(c.bases[0], scope) if c.bases else None
        head = f"export class {js_name(c.name)}" + (f" extends {base}" if base else "") + " {"
        out = [p + head]
        if not base:
            out.append(p + "  constructor(...args) {")
            out.append(p + "    if (this.__init__) this.__init__(...args);")
            out.append(p + "  }")
        sigs = []
        for s in c.body:
            if self.is_docstring(s) or isinstance(s, ast.Pass):
                continue
            if not isinstance(s, ast.FunctionDef):
                self.fail(s, "class body statement")
            params, captured = self.params_js(s.args, scope, skip_self=True)
            if captured:
                self.fail(s, "non-literal default in a method")
            gen = "*" if contains_yield(s) else ""
            out.append(p + f"  {gen}{js_name(s.name)}({', '.join(params)}) {{")
            out += self.function_body(s, scope, ind + 2, is_method=True)
            out.append(p + "  }")
            self.func_is_method = True
            sigs.append(self.sig_call(f"{js_name(c.name)}.prototype.{js_name(s.name)}", s.args))
            self.func_is_method = False
        out.append(p + "}")
        out.append(p + f'{js_name(c.name)}.__pyname__ = "{c.name}";')
        out += [p + s for s in sigs]
        out.append("")
        return out

    # ─── names ───────────────────────────────────────────────────

    def name_store(self, name, scope):
        return js_name(name)

    def name_load(self, name, scope, node):
        if name in ("True", "False", "None"):
            return {"True": "true", "False": "false", "None": "null"}[name]
        owner = scope.defines(name)
        if owner is not None:
            if owner.kind == "module" and name in self.from_names:
                return self.from_names[name]
            return js_name(name)
        if name in self.from_names:
            return self.from_names[name]
        if name in self.imports_ns or name in SHIM_MODULES and name in self.shims:
            return js_name(name)
        if name in BUILTINS:
            return BUILTINS[name]
        self.fail(node, f"unknown name {name}")

    # ─── expressions ─────────────────────────────────────────────

    def test(self, e, scope):
        """A JS boolean for a Python condition."""
        if isinstance(e, ast.Compare):
            return self.compare(e, scope)
        if isinstance(e, ast.UnaryOp) and isinstance(e.op, ast.Not):
            return f"!({self.test(e.operand, scope)})"
        if isinstance(e, ast.BoolOp):
            j = " && " if isinstance(e.op, ast.And) else " || "
            return "(" + j.join(self.test(v, scope) for v in e.values) + ")"
        if isinstance(e, ast.Call) and isinstance(e.func, ast.Name) and e.func.id in ("isinstance", "any", "all", "hasattr", "callable") \
                and scope.defines(e.func.id) is None:
            return self.expr(e, scope)
        if isinstance(e, ast.Constant) and isinstance(e.value, bool):
            return "true" if e.value else "false"
        return f"py.bool({self.expr(e, scope)})"

    def compare(self, e, scope):
        operands = [e.left] + list(e.comparators)
        if len(e.ops) == 1:
            return self.cmp(e.ops[0], self.expr(e.left, scope), self.expr(e.comparators[0], scope), e.left, e.comparators[0], scope)
        temps = [self.new_tmp() for _ in operands]
        parts = []
        for i, op in enumerate(e.ops):
            parts.append(self.cmp(op, temps[i], temps[i + 1], operands[i], operands[i + 1], scope))
        # evaluate operands left to right, stopping at the first false comparison, as Python does
        body = []
        body.append(f"const {temps[0]} = {self.expr(operands[0], scope)};")
        for i, op in enumerate(e.ops):
            body.append(f"const {temps[i + 1]} = {self.expr(operands[i + 1], scope)};")
            if i < len(e.ops) - 1:
                body.append(f"if (!({parts[i]})) return false;")
            else:
                body.append(f"return {parts[i]};")
        return "(() => { " + " ".join(body) + " })()"

    def cmp(self, op, a, b, an, bn, scope):
        if isinstance(op, (ast.Is, ast.IsNot)):
            neg = isinstance(op, ast.IsNot)
            # type(x) is int
            if isinstance(an, ast.Call) and isinstance(an.func, ast.Name) and an.func.id == "type" and isinstance(bn, ast.Name) and bn.id in TYPE_NAMES:
                r = f"py.typeIs({self.expr(an.args[0], scope)}, {js_str(bn.id)})"
                return f"!{r}" if neg else r
            if isinstance(bn, ast.Constant) and bn.value is None:
                return f"({a} {'!=' if neg else '=='} null)"
            if isinstance(an, ast.Constant) and an.value is None:
                return f"({b} {'!=' if neg else '=='} null)"
            return f"{'!' if neg else ''}py.is({a}, {b})"
        if isinstance(op, ast.In):
            return f"py.contains({b}, {a})"
        if isinstance(op, ast.NotIn):
            return f"py.notIn({b}, {a})"
        return f"py.{CMPOPS[type(op)]}({a}, {b})"

    def iterable(self, e, scope):
        return f"py.iter({self.expr(e, scope)})"

    def index(self, sl, scope):
        if isinstance(sl, ast.Tuple):
            return f"py.T({', '.join(self.expr(x, scope) for x in sl.elts)})"
        return self.expr(sl, scope)

    def const(self, v):
        if v is None:
            return "null"
        if isinstance(v, bool):
            return "true" if v else "false"
        if isinstance(v, int):
            if abs(v) >= 2 ** 53:
                raise Unsupported(f"{self.module}: integer literal {v} exceeds 2^53")
            return str(v)
        if isinstance(v, float):
            if v != v:
                return "NaN"
            if v in (float("inf"), float("-inf")):
                return "Infinity" if v > 0 else "-Infinity"
            if v == int(v):
                # an integral float literal must stay a float (repr 1.0, 1e+16, -0.0): a PyFloat constant
                text = "-0" if math.copysign(1, v) < 0 and v == 0 else repr(v)
                name = "$F" + re.sub(r"[^0-9A-Za-z]", lambda m: {"-": "m", "+": "p", ".": "_"}[m.group(0)], text)
                self.float_consts[name] = text
                return name
            return repr(v)
        if isinstance(v, str):
            return js_str(v)
        if isinstance(v, bytes):
            return "Buffer.from(" + json.dumps(list(v)) + ")"
        raise Unsupported(f"{self.module}: constant {v!r}")

    def expr(self, e, scope) -> str:
        if isinstance(e, ast.Constant):
            return self.const(e.value)
        if isinstance(e, ast.Name):
            return self.name_load(e.id, scope, e)
        if isinstance(e, ast.JoinedStr):
            parts = []
            for v in e.values:
                if isinstance(v, ast.Constant):
                    parts.append(js_str(v.value))
                else:
                    parts.append(self.formatted(v, scope))
            if not parts:
                return '""'
            return "(" + " + ".join(parts) + ")" if len(parts) > 1 else parts[0]
        if isinstance(e, ast.FormattedValue):
            return self.formatted(e, scope)
        if isinstance(e, ast.List):
            return "[" + ", ".join(self.elt(x, scope) for x in e.elts) + "]"
        if isinstance(e, ast.Tuple):
            if any(isinstance(x, ast.Starred) for x in e.elts):
                return "py.tuple([" + ", ".join(self.elt(x, scope) for x in e.elts) + "])"
            return "py.T(" + ", ".join(self.expr(x, scope) for x in e.elts) + ")"
        if isinstance(e, ast.Set):
            if any(isinstance(x, ast.Starred) for x in e.elts):
                return "py.set([" + ", ".join(self.elt(x, scope) for x in e.elts) + "])"
            # CPython turns a display of 3+ constants into BUILD_SET 0 + a frozenset constant + SET_UPDATE:
            # the set is merged from the frozenset's table, which lays it out differently from adding
            # the items one by one. py.SC takes that path.
            fn = "py.SC" if len(e.elts) >= 3 and all(folds_to_constant(x) for x in e.elts) else "py.S"
            return fn + "(" + ", ".join(self.expr(x, scope) for x in e.elts) + ")"
        if isinstance(e, ast.Dict):
            parts = []
            for k, v in zip(e.keys, e.values):
                if k is None:
                    parts.append(f"{{spread: {self.expr(v, scope)}}}")
                else:
                    parts.append(f"[{self.expr(k, scope)}, {self.expr(v, scope)}]")
            return "py.dict(" + ", ".join(parts) + ")"
        if isinstance(e, ast.BinOp):
            op = BINOPS.get(type(e.op))
            if op is None:
                self.fail(e, "operator")
            return f"py.{op}({self.expr(e.left, scope)}, {self.expr(e.right, scope)})"
        if isinstance(e, ast.UnaryOp):
            if isinstance(e.op, ast.Not):
                return f"!({self.test(e.operand, scope)})"
            if isinstance(e.op, ast.USub):
                if isinstance(e.operand, ast.Constant) and isinstance(e.operand.value, (int, float)) and not isinstance(e.operand.value, bool):
                    return self.const(-e.operand.value)
                return f"py.neg({self.expr(e.operand, scope)})"
            if isinstance(e.op, ast.UAdd):
                return f"py.pos({self.expr(e.operand, scope)})"
            self.fail(e, "unary operator")
        if isinstance(e, ast.BoolOp):
            vals = [self.expr(v, scope) for v in e.values]
            acc = vals[-1]
            for v in reversed(vals[:-1]):
                t = self.new_tmp()
                if isinstance(e.op, ast.Or):
                    acc = f"(({t}) => py.bool({t}) ? {t} : {acc})({v})"
                else:
                    acc = f"(({t}) => !py.bool({t}) ? {t} : {acc})({v})"
            return acc
        if isinstance(e, ast.Compare):
            return self.compare(e, scope)
        if isinstance(e, ast.IfExp):
            return f"({self.test(e.test, scope)} ? {self.expr(e.body, scope)} : {self.expr(e.orelse, scope)})"
        if isinstance(e, ast.Call):
            return self.call(e, scope)
        if isinstance(e, ast.Attribute):
            return self.attribute(e, scope)
        if isinstance(e, ast.Subscript):
            if isinstance(e.slice, ast.Slice):
                s = e.slice
                parts = [self.expr(s.lower, scope) if s.lower else "null", self.expr(s.upper, scope) if s.upper else "null"]
                if s.step:
                    parts.append(self.expr(s.step, scope))
                return f"py.slice({self.expr(e.value, scope)}, {', '.join(parts)})"
            return f"py.getitem({self.expr(e.value, scope)}, {self.index(e.slice, scope)})"
        if isinstance(e, ast.Lambda):
            return self.lam(e, scope)
        if isinstance(e, (ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp)):
            return self.comprehension(e, scope)
        if isinstance(e, ast.Starred):
            self.fail(e, "starred expression here")
        if isinstance(e, ast.Yield):
            return "(yield " + (self.expr(e.value, scope) if e.value else "null") + ")"
        self.fail(e, f"expression {type(e).__name__}")

    def elt(self, x, scope):
        if isinstance(x, ast.Starred):
            return "..." + self.iterable(x.value, scope)
        return self.expr(x, scope)

    def formatted(self, v: ast.FormattedValue, scope):
        val = self.expr(v.value, scope)
        if v.conversion == ord("r"):
            val = f"py.repr({val})"
        elif v.conversion == ord("s"):
            val = f"py.str({val})"
        elif v.conversion == ord("a"):
            self.fail(v, "!a conversion")
        if v.format_spec is None:
            return f"py.format({val})"
        spec = self.expr(v.format_spec, scope)
        return f"py.format({val}, {spec})"

    def lam(self, e: ast.Lambda, scope):
        params, captured = self.params_js(e.args, scope)
        names = [a.arg for a in e.args.posonlyargs + e.args.args + e.args.kwonlyargs]
        if e.args.vararg:
            names.append(e.args.vararg.arg)
        if e.args.kwarg:
            names.append(e.args.kwarg.arg)
        inner = Scope("function", names, scope)
        body = self.expr(e.body, inner)
        f = f"(({', '.join(params)}) => {body})"
        if captured:
            f = f"(({', '.join(c for c, _ in captured)}) => {f})({', '.join(v for _, v in captured)})"
        return f

    def comprehension(self, e, scope):
        inner = Scope("comp", [], scope)
        for g in e.generators:
            inner.names |= set(assigned_names([ast.Assign(targets=[g.target], value=ast.Constant(None))]))
        first = self.expr(e.generators[0].iter, scope)
        it0 = self.new_tmp()
        lines = []
        depth = 0
        for i, g in enumerate(e.generators):
            if g.is_async:
                self.fail(e, "async comprehension")
            v = self.new_tmp()
            src = it0 if i == 0 else self.expr(g.iter, inner)
            lines.append(f"for (const {v} of py.iter({src})) {{")
            depth += 1
            names = assigned_names([ast.Assign(targets=[g.target], value=ast.Constant(None))])
            if names:
                lines.append("let " + ", ".join(js_name(n) for n in names) + ";")
            lines += [x.strip() for x in self.assign(g.target, v, inner, 0)]
            for cond in g.ifs:
                lines.append(f"if (!({self.test(cond, inner)})) continue;")
        if isinstance(e, ast.GeneratorExp):
            lines.append(f"yield {self.expr(e.elt, inner)};")
            body = " ".join(lines) + " }" * depth
            return f"(function* ({it0}) {{ {body} }})({first})"
        r = self.new_tmp()
        if isinstance(e, ast.ListComp):
            lines.append(f"{r}.push({self.expr(e.elt, inner)});")
            init = "[]"
        elif isinstance(e, ast.SetComp):
            lines.append(f"{r}.add({self.expr(e.elt, inner)});")
            init = "py.set()"
        else:
            lines.append(f"{r}.set({self.expr(e.key, inner)}, {self.expr(e.value, inner)});")
            init = "py.dict()"
        body = " ".join(lines) + " }" * depth
        return f"(({it0}) => {{ const {r} = {init}; {body} return {r}; }})({first})"

    def attribute(self, e: ast.Attribute, scope):
        base = e.value
        if isinstance(base, ast.Name) and self.import_name(base.id, scope):
            if base.id in self.imports_ns:
                return f"{js_name(base.id)}.{e.attr}"
            if base.id in SHIM_MODULES and base.id in self.shims:
                if (base.id, e.attr) in SHIM_ATTRS:
                    return SHIM_ATTRS[(base.id, e.attr)]
                return f"{base.id}.{e.attr}"
            if base.id in self.from_names and self.name_kind.get(base.id) == "module":
                return f"{self.from_names[base.id]}.{e.attr}"
            if base.id in TYPE_NAMES and base.id not in self.from_names:
                if base.id == "dict" and e.attr == "fromkeys":
                    return "py.fromkeys"
                return f"((...a) => py.M.{e.attr}(...a))"
        return f"py.getattr({self.expr(base, scope)}, {js_str(e.attr)})"

    def call(self, e: ast.Call, scope):
        kw = {}
        kw_spread = []
        for k in e.keywords:
            if k.arg is None:
                kw_spread.append(self.expr(k.value, scope))
            else:
                kw[k.arg] = self.expr(k.value, scope)
        has_star = any(isinstance(a, ast.Starred) for a in e.args)
        pos = [self.elt(a, scope) for a in e.args]

        def kw_obj():
            items = [f"{js_str(k)}: {v}" for k, v in kw.items()] + [f"...py.kwargs({s})" for s in kw_spread]
            return "{" + ", ".join(items) + "}"

        def runtime_call(fn):
            args = list(pos)
            if kw or kw_spread:
                args.append(f"py.KW({kw_obj()})")
            return f"{fn}({', '.join(args)})"

        def py_call(fn):
            if not kw and not kw_spread:
                return f"{fn}({', '.join(pos)})"
            return f"py.call({fn}, [{', '.join(pos)}], {kw_obj()})"

        f = e.func
        if isinstance(f, ast.Name) and scope.defines(f.id) is None:
            name = f.id
            if name == "super":
                return "super"
            if name == "isinstance":
                return f"py.isinstance({self.expr(e.args[0], scope)}, {self.type_arg(e.args[1], scope)})"
            if name in self.from_names:
                kind = self.name_kind.get(name)
                target = self.from_names[name]
                if kind == "class":
                    return f"new {target}({', '.join(pos)})" if not kw else f"py.construct({target}, [{', '.join(pos)}], {kw_obj()})"
                if target.startswith("py.") or kind in ("func",):
                    return runtime_call(target)
                return py_call(target)
            if name in EXCEPTIONS:
                return f"new {BUILTINS[name]}({', '.join(pos)})"
            if name in BUILTINS:
                return runtime_call(BUILTINS[name])
            self.fail(e, f"call of unknown name {name}")
        if isinstance(f, ast.Name):
            owner = scope.defines(f.id)
            if owner is not None and owner.kind == "module" and f.id in self.classes:
                return f"new {js_name(f.id)}({', '.join(pos)})" if not kw else f"py.construct({js_name(f.id)}, [{', '.join(pos)}], {kw_obj()})"
            if owner is not None and owner.kind == "module" and f.id in self.from_names:
                target = self.from_names[f.id]
                kind = self.name_kind.get(f.id)
                if kind == "class":
                    return f"new {target}({', '.join(pos)})" if not kw else f"py.construct({target}, [{', '.join(pos)}], {kw_obj()})"
                if target.startswith("py.") or kind == "func":
                    return runtime_call(target)
                return py_call(target)
            return py_call(js_name(f.id))
        if isinstance(f, ast.Attribute):
            base = f.value
            # super().method(...)
            if isinstance(base, ast.Call) and isinstance(base.func, ast.Name) and base.func.id == "super":
                return f"super.{f.attr}({', '.join(pos)})"
            if isinstance(base, ast.Name) and self.import_name(base.id, scope):
                if base.id in self.imports_ns:
                    target = f"{js_name(base.id)}.{f.attr}"
                    return py_call(target)
                if base.id in SHIM_MODULES and base.id in self.shims:
                    if (base.id, f.attr) in SHIM_ATTRS:
                        return runtime_call(SHIM_ATTRS[(base.id, f.attr)])
                    return runtime_call(f"{base.id}.{f.attr}")
                if base.id in self.from_names and self.name_kind.get(base.id) == "module":
                    return runtime_call(f"{self.from_names[base.id]}.{f.attr}")
                if base.id in TYPE_NAMES and base.id not in self.from_names:
                    if base.id == "dict" and f.attr == "fromkeys":
                        return runtime_call("py.fromkeys")
                    return runtime_call(f"py.M.{f.attr}")
            obj = self.expr(base, scope)
            args = [obj] + list(pos)
            if kw or kw_spread:
                args.append(f"py.KW({kw_obj()})")
            if has_star:
                pass
            return f"py.M.{f.attr}({', '.join(args)})"
        callee = self.expr(f, scope)
        return py_call(f"({callee})")

    def type_arg(self, t, scope):
        if isinstance(t, ast.Tuple):
            return "py.T(" + ", ".join(self.type_arg(x, scope) for x in t.elts) + ")"
        if isinstance(t, ast.Name) and t.id in TYPE_NAMES and scope.defines(t.id) is None:
            return js_str(t.id)
        return self.expr(t, scope)


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    modules = sys.argv[3:] or sorted(p.stem for p in src.glob("*.py") if p.stem != "__init__")
    silicon = {p.stem for p in src.glob("*.py")}
    out.mkdir(parents=True, exist_ok=True)
    failed = []
    for m in modules:
        try:
            js = Transpiler(m, (src / f"{m}.py").read_text(encoding="utf-8"), silicon).transpile()
        except Unsupported as err:
            failed.append(str(err))
            continue
        (out / f"{m}.js").write_text(js, encoding="utf-8")
    for f in failed:
        print("unsupported:", f, file=sys.stderr)
    print(f"{len(modules) - len(failed)}/{len(modules)} modules written to {out}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
