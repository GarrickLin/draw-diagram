// Python semantics for JavaScript: the runtime the transpiled silicon-canvas modules run on.
//
// tools/port/transpile.py turns each Python module into a JS module whose every operation that
// differs between the languages goes through a function here: truthiness, equality, ordering,
// arithmetic, indexing, iteration, dict/set/tuple, string and container methods, builtins and
// exceptions. The aim is results identical to CPython 3.14, so this file follows CPython's
// algorithms where JS's differ (sum, round, sort, set order, float repr, str methods).
//
// Value model:
//   None -> null (undefined is read as None too)    bool -> boolean
//   int -> number with an integral value             float -> number, or PyFloat when integral
//   str -> string    list -> Array    tuple -> Tuple (Array subclass)
//   dict -> PyDict (insertion ordered)    set/frozenset -> PySet (CPython table order, pyset.js)
// An integral float such as 2.0 can't be a bare JS number, which would print as "2"; it is a
// PyFloat. Every arithmetic helper returns a PyFloat when Python's result is a float with an
// integral value, so str(), repr(), format() and json.dumps() print what Python prints.

import { PySet, pyhash, setEquality } from "./pyset.js";
import { TITLECASE } from "./titlecase.js";
export { PySet, pyhash };

// ─── Numbers ─────────────────────────────────────────────────────

export class PyFloat {
  constructor(v) {
    this.v = v;
  }
  valueOf() {
    return this.v;
  }
}

/** A float result: a PyFloat when integral, else the number itself. */
export function fl(x) {
  return Number.isInteger(x) ? new PyFloat(x) : x;
}
/** A float literal from source. */
export const F = fl;

export function isNum(v) {
  return typeof v === "number" || typeof v === "boolean" || v instanceof PyFloat;
}
export function isFloat(v) {
  return v instanceof PyFloat || (typeof v === "number" && !Number.isInteger(v));
}
export function isIntLike(v) {
  return typeof v === "boolean" || (typeof v === "number" && Number.isInteger(v));
}
/** Numeric value of a bool, int or float. */
export function nv(v) {
  if (typeof v === "number") return v;
  if (v instanceof PyFloat) return v.v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

// ─── Exceptions ──────────────────────────────────────────────────

export class BaseException extends Error {
  constructor(...args) {
    super();
    this.__init__(...args);
  }
  __init__(...args) {
    this.args = tuple(args);
    this.message = args.length ? pystr(args[0]) : "";
  }
  get name() {
    return this.constructor.__pyname__ || this.constructor.name;
  }
  __str__() {
    if (this.args.length === 0) return "";
    if (this.args.length === 1) return pystr(this.args[0]);
    return repr(this.args);
  }
  toString() {
    return `${this.name}: ${this.__str__()}`;
  }
}
export class Exception extends BaseException {}
export class ValueError extends Exception {}
export class TypeError_ extends Exception {}
TypeError_.__pyname__ = "TypeError";
export class LookupError extends Exception {}
export class KeyError extends LookupError {
  __str__() {
    return this.args.length === 1 ? repr(this.args[0]) : super.__str__();
  }
}
export class IndexError extends LookupError {}
export class ArithmeticError extends Exception {}
export class ZeroDivisionError extends ArithmeticError {}
export class OverflowError extends ArithmeticError {}
export class ImportError extends Exception {}
export class OSError extends Exception {}
export class RuntimeError extends Exception {}
export class AttributeError extends Exception {}
export class StopIteration extends Exception {}
export class NotImplementedError extends RuntimeError {}
export class AssertionError extends Exception {}
export class RecursionError extends RuntimeError {}

/** Whether a caught JS value matches one of the Python exception classes. */
export function excMatch(e, types) {
  for (const t of types) {
    if (e instanceof t) return true;
    // errors raised by the JS engine itself
    if (t === TypeError_ && e instanceof TypeError) return true;
    if (t === RecursionError && e instanceof RangeError) return true;
    if ((t === Exception || t === BaseException) && e instanceof Error) return true;
  }
  return false;
}

// ─── Tuples, dicts ───────────────────────────────────────────────

export class Tuple extends Array {
  static get [Symbol.species]() {
    return Array;
  }
}

// new Tuple(n) then index writes: far cheaper than push on an Array subclass
function tupleOf(arr) {
  const n = arr.length;
  const t = new Tuple(n);
  for (let i = 0; i < n; i++) t[i] = arr[i];
  return t;
}

export function tuple(items = []) {
  if (items instanceof Tuple) return items;
  return tupleOf(Array.isArray(items) ? items : [...iter(items)]);
}

export function T(...items) {
  return tupleOf(items);
}

const TUPLE_KEY = Symbol("tuple key");

/** The key a dict stores a value under: Python treats 1, 1.0 and True as one key. */
export function hashKey(v) {
  switch (typeof v) {
    case "string":
      return "s" + v;
    case "number":
      return Object.is(v, -0) ? "n0" : "n" + v;
    case "boolean":
      return v ? "n1" : "n0";
    case "undefined":
      return "N";
  }
  if (v === null) return "N";
  if (v instanceof PyFloat) return Object.is(v.v, -0) ? "n0" : "n" + v.v;
  if (v instanceof Tuple) {
    // a tuple never changes once built, so its key is computed once
    let k = v[TUPLE_KEY];
    if (k === undefined) {
      k = "t[";
      for (let i = 0; i < v.length; i++) k += (i ? "," : "") + hashKey(v[i]);
      k += "]";
      v[TUPLE_KEY] = k;
    }
    return k;
  }
  if (v instanceof PySet && v.frozen) return "f[" + [...v].map(hashKey).sort().join(",") + "]";
  if (Array.isArray(v)) throw new TypeError_("unhashable type: 'list'");
  if (v instanceof PyDict) throw new TypeError_("unhashable type: 'dict'");
  if (v instanceof PySet) throw new TypeError_("unhashable type: 'set'");
  return "O" + objId(v);
}
const ids = new WeakMap();
let nextId = 1;
function objId(o) {
  if (!ids.has(o)) ids.set(o, nextId++);
  return ids.get(o);
}

export class PyDict {
  constructor(entries) {
    this.map = new Map();
    // bumped on every write; lib/engine/fast caches mirrors of a dict against it
    this.mods = 0;
    if (entries) for (const [k, v] of entries) this.set(k, v);
  }
  get size() {
    return this.map.size;
  }
  set(k, v) {
    const h = hashKey(k);
    const e = this.map.get(h);
    this.mods++;
    if (e) e[1] = v;
    else this.map.set(h, [k, v]);
    return this;
  }
  has(k) {
    return this.map.has(hashKey(k));
  }
  getEntry(k) {
    return this.map.get(hashKey(k));
  }
  item(k) {
    const e = this.map.get(hashKey(k));
    if (e) return e[1];
    return this.__missing__(k);
  }
  __missing__(k) {
    throw new KeyError(k);
  }
  get(k, d = null) {
    const e = this.map.get(hashKey(k));
    return e ? e[1] : d;
  }
  delete(k) {
    const h = hashKey(k);
    if (!this.map.has(h)) throw new KeyError(k);
    this.mods++;
    this.map.delete(h);
  }
  *keys() {
    for (const e of this.map.values()) yield e[0];
  }
  *values() {
    for (const e of this.map.values()) yield e[1];
  }
  *entries() {
    for (const e of this.map.values()) yield T(e[0], e[1]);
  }
  [Symbol.iterator]() {
    return this.keys();
  }
  copy() {
    const d = new PyDict();
    for (const [h, e] of this.map) d.map.set(h, [e[0], e[1]]);
    return d;
  }
}

export class DefaultDict extends PyDict {
  constructor(factory = null, entries) {
    super(entries);
    this.default_factory = factory;
  }
  __missing__(k) {
    if (this.default_factory === null) throw new KeyError(k);
    const v = this.default_factory();
    this.set(k, v);
    return v;
  }
  copy() {
    const d = new DefaultDict(this.default_factory);
    for (const [h, e] of this.map) d.map.set(h, [e[0], e[1]]);
    return d;
  }
}

export class Counter extends PyDict {
  __missing__() {
    return 0;
  }
  copy() {
    const d = new Counter();
    for (const [h, e] of this.map) d.map.set(h, [e[0], e[1]]);
    return d;
  }
  most_common(n = null) {
    const items = sorted(new DictView(this, "items"), KW({ key: (it) => it[1], reverse: true }));
    return n === null ? items : items.slice(0, Math.max(0, nv(n)));
  }
  elements() {
    const out = [];
    for (const [k, v] of this.map.values()) for (let i = 0; i < nv(v); i++) out.push(k);
    return out;
  }
  total() {
    return sum([...this.values()]);
  }
  /** Counter.update: a mapping adds its counts, any other iterable counts its elements. */
  addCounts(other, sign = 1) {
    if (other instanceof PyDict) for (const [k, v] of other.entries()) this.set(k, add(this.get(k, 0), sign === 1 ? v : neg(v)));
    else for (const k of iter(other)) this.set(k, add(this.get(k, 0), sign));
  }
}
// Counter methods reached through py.M (callOwn skips other dict internals)
const COUNTER_METHODS = new Set(["most_common", "elements", "total"]);

/** dict.keys() / values() / items(): re-iterable, sized views as in Python. */
export class DictView {
  constructor(d, kind) {
    this.d = d;
    this.kind = kind;
  }
  [Symbol.iterator]() {
    return this.kind === "keys" ? this.d.keys() : this.kind === "values" ? this.d.values() : this.d.entries();
  }
  __len__() {
    return this.d.size;
  }
  __contains__(x) {
    if (this.kind === "keys") return this.d.has(x);
    if (this.kind === "items") {
      if (!(x instanceof Tuple) || x.length !== 2) return false;
      const e = this.d.getEntry(x[0]);
      return !!e && eq(e[1], x[1]);
    }
    for (const v of this.d.values()) if (eq(v, x)) return true;
    return false;
  }
}

/** Build a dict literal: pairs [k, v], or {spread: mapping} for **mapping. */
export function dict(...parts) {
  const d = new PyDict();
  for (const p of parts) {
    if (p && !Array.isArray(p) && Object.hasOwn(p, "spread")) dictUpdate(d, p.spread);
    else d.set(p[0], p[1]);
  }
  return d;
}

export function defaultdict(factory = null, ...rest) {
  const d = new DefaultDict(factory);
  if (rest.length) dictUpdate(d, rest[0]);
  return d;
}

export function counter(iterable = null) {
  const c = new Counter();
  if (iterable === null || iterable === undefined) return c;
  if (iterable instanceof PyDict) {
    for (const [k, v] of iterable.entries()) c.set(k, v);
    return c;
  }
  for (const x of iter(iterable)) c.set(x, add(c.get(x, 0), 1));
  return c;
}

export function set(items = null) {
  return new PySet(items);
}
export function frozenset(items = null) {
  return new PySet(items, true);
}
/** Set literal {a, b}: BUILD_SET adds the items in order. */
export function S(...items) {
  return new PySet(items);
}
/** A set display of 3+ constants: built as CPython runs it, a frozenset constant merged into set(). */
export function SC(...items) {
  return new PySet(new PySet(items, true));
}

export class Deque {
  constructor(items = null) {
    this.items = items === null || items === undefined ? [] : [...iter(items)];
  }
  __len__() {
    return this.items.length;
  }
  [Symbol.iterator]() {
    return this.items[Symbol.iterator]();
  }
  append(x) {
    this.items.push(x);
    return null;
  }
  appendleft(x) {
    this.items.unshift(x);
    return null;
  }
  popleft() {
    if (!this.items.length) throw new IndexError("pop from an empty deque");
    return this.items.shift();
  }
  pop() {
    if (!this.items.length) throw new IndexError("pop from an empty deque");
    return this.items.pop();
  }
  extend(it) {
    for (const x of iter(it)) this.items.push(x);
    return null;
  }
}
export function deque(items = null) {
  return new Deque(items);
}

export class Range {
  constructor(start, stop, step = 1) {
    if (stop === undefined) {
      stop = start;
      start = 0;
    }
    for (const v of [start, stop, step]) {
      if (!isIntLike(v)) throw new TypeError_(`'${typeName(v)}' object cannot be interpreted as an integer`);
    }
    if (nv(step) === 0) throw new ValueError("range() arg 3 must not be zero");
    this.start = nv(start);
    this.stop = nv(stop);
    this.step = nv(step);
  }
  __len__() {
    const { start, stop, step } = this;
    const n = step > 0 ? Math.ceil((stop - start) / step) : Math.ceil((start - stop) / -step);
    return Math.max(0, n);
  }
  *[Symbol.iterator]() {
    const { start, stop, step } = this;
    if (step > 0) for (let i = start; i < stop; i += step) yield i;
    else for (let i = start; i > stop; i += step) yield i;
  }
}
export function range(a, b, c) {
  return new Range(a, b, c);
}

/** Keyword arguments for runtime functions and methods: f(x, KW({key})). */
export class Kw {
  constructor(obj) {
    this.kw = obj;
  }
}
export function KW(obj) {
  return new Kw(obj);
}
export function splitKw(args) {
  if (args.length && args[args.length - 1] instanceof Kw) return [args.slice(0, -1), args[args.length - 1].kw];
  return [args, {}];
}

// ─── Types ───────────────────────────────────────────────────────

export function typeName(v) {
  if (v === null || v === undefined) return "NoneType";
  switch (typeof v) {
    case "boolean":
      return "bool";
    case "number":
      return Number.isInteger(v) ? "int" : "float";
    case "string":
      return "str";
    case "function":
      return v.prototype && v.prototype.constructor === v && /^class\b/.test(Function.prototype.toString.call(v)) ? "type" : "function";
  }
  if (v instanceof PyFloat) return "float";
  if (v instanceof Tuple) return "tuple";
  if (Array.isArray(v)) return "list";
  if (v instanceof Counter) return "Counter";
  if (v instanceof DefaultDict) return "collections.defaultdict";
  if (v instanceof PyDict) return "dict";
  if (v instanceof PySet) return v.frozen ? "frozenset" : "set";
  if (v instanceof Range) return "range";
  if (v instanceof DictView) return "dict_" + v.kind;
  if (v instanceof BaseException) return v.name;
  return v.constructor?.__pyname__ || v.constructor?.name || "object";
}

/** isinstance(v, t): t is a type name ("dict", "int", ...), a class, or a tuple of those. */
export function isinstance(v, t) {
  if (t instanceof Tuple || Array.isArray(t)) return t.some((x) => isinstance(v, x));
  if (typeof t === "function") return v instanceof t || (t === TypeError_ && v instanceof TypeError);
  switch (t) {
    case "dict":
      return v instanceof PyDict;
    case "list":
      return Array.isArray(v) && !(v instanceof Tuple);
    case "tuple":
      return v instanceof Tuple;
    case "set":
      return v instanceof PySet && !v.frozen;
    case "frozenset":
      return v instanceof PySet && v.frozen;
    case "str":
      return typeof v === "string";
    case "int":
      return isIntLike(v);
    case "float":
      return isFloat(v);
    case "bool":
      return typeof v === "boolean";
    case "NoneType":
      return v === null || v === undefined;
  }
  throw new TypeError_("isinstance() arg 2 must be a type, a tuple of types, or a union");
}

/** type(v) is t, for t a builtin type name: exact type, so a bool is not an int. */
export function typeIs(v, t) {
  if (t === "int") return typeof v === "number" && Number.isInteger(v);
  if (t === "float") return isFloat(v);
  if (t === "dict") return v instanceof PyDict && !(v instanceof DefaultDict) && !(v instanceof Counter);
  return isinstance(v, t);
}

export function type(v) {
  return { __name__: typeName(v) };
}

// ─── Truthiness, identity, equality, ordering ────────────────────

function isSetView(v) {
  return v instanceof DictView && v.kind !== "values";
}

export function bool(v) {
  if (v === null || v === undefined) return false;
  switch (typeof v) {
    case "boolean":
      return v;
    case "number":
      return v !== 0 && !Number.isNaN(v) ? true : Number.isNaN(v);
    case "string":
      return v.length > 0;
    case "function":
      return true;
  }
  if (v instanceof PyFloat) return v.v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof PyDict || v instanceof PySet) return v.size > 0;
  if (typeof v.__bool__ === "function") return v.__bool__();
  if (typeof v.__len__ === "function") return v.__len__() > 0;
  return true;
}

/** `a is b`. */
export function is(a, b) {
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (a instanceof PyFloat && b instanceof PyFloat) return a === b;
  return a === b;
}

export function eq(a, b) {
  if (a === b) return true;
  if (isNum(a) && isNum(b)) return nv(a) === nv(b);
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || (a instanceof Tuple) !== (b instanceof Tuple) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!(a[i] === b[i] || eq(a[i], b[i]))) return false;
    return true;
  }
  if (a instanceof PyDict) {
    if (!(b instanceof PyDict) || a.size !== b.size) return false;
    for (const [h, e] of a.map) {
      const o = b.map.get(h);
      if (!o || !(e[1] === o[1] || eq(e[1], o[1]))) return false;
    }
    return true;
  }
  // sets, frozensets and keys/items views compare as sets (dictview_richcompare for the views)
  if (setLike(a) && setLike(b)) return sizeOf(a) === sizeOf(b) && containedIn(a, b);
  if (a instanceof Range && b instanceof Range) return eq(list(a), list(b));
  return false;
}
export function ne(a, b) {
  return !eq(a, b);
}
setEquality(eq);

function strLt(a, b) {
  if (!/[\ud800-\udfff]/.test(a) && !/[\ud800-\udfff]/.test(b)) return a < b;
  const x = [...a];
  const y = [...b];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const p = x[i].codePointAt(0);
    const q = y[i].codePointAt(0);
    if (p !== q) return p < q;
  }
  return x.length < y.length;
}

// <, <=, >, >= between sets and set-like dict views: containment (all_contained_in)
const setLike = (v) => v instanceof PySet || isSetView(v);
function sizeOf(v) {
  return v instanceof PySet ? v.size : v.__len__();
}
function containedIn(a, b) {
  for (const x of a) if (!(b instanceof PySet ? b.has(x) : b.__contains__(x))) return false;
  return true;
}
function setCompare(a, b, op) {
  const la = sizeOf(a);
  const lb = sizeOf(b);
  switch (op) {
    case "lt":
      return la < lb && containedIn(a, b);
    case "le":
      return la <= lb && containedIn(a, b);
    case "gt":
      return la > lb && containedIn(b, a);
    case "ge":
      return la >= lb && containedIn(b, a);
  }
}

export function lt(a, b) {
  if (typeof a === "number" && typeof b === "number") return a < b;
  if (setLike(a) && setLike(b)) return setCompare(a, b, "lt");
  if (typeof a === "string" && typeof b === "string") return strLt(a, b);
  if (isNum(a) && isNum(b)) return nv(a) < nv(b);
  if (Array.isArray(a) && Array.isArray(b) && (a instanceof Tuple) === (b instanceof Tuple)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (!(a[i] === b[i] || eq(a[i], b[i]))) return lt(a[i], b[i]);
    }
    return a.length < b.length;
  }
  if (a instanceof PySet && b instanceof PySet) return a.size < b.size && a.issubset(b);
  throw new TypeError_(`'<' not supported between instances of '${typeName(a)}' and '${typeName(b)}'`);
}
export function gt(a, b) {
  if (typeof a === "number" && typeof b === "number") return a > b;
  if (setLike(a) && setLike(b)) return setCompare(a, b, "gt");
  try {
    return lt(b, a);
  } catch (e) {
    if (e instanceof TypeError_) throw new TypeError_(`'>' not supported between instances of '${typeName(a)}' and '${typeName(b)}'`);
    throw e;
  }
}
export function le(a, b) {
  if (typeof a === "number" && typeof b === "number") return a <= b;
  if (isNum(a) && isNum(b)) return nv(a) <= nv(b);
  if (setLike(a) && setLike(b)) return setCompare(a, b, "le");
  if (typeof a === "string" && typeof b === "string") return a === b || strLt(a, b);
  if (Array.isArray(a) && Array.isArray(b)) return eq(a, b) || lt(a, b);
  throw new TypeError_(`'<=' not supported between instances of '${typeName(a)}' and '${typeName(b)}'`);
}
export function ge(a, b) {
  if (typeof a === "number" && typeof b === "number") return a >= b;
  if (setLike(a) && setLike(b)) return setCompare(a, b, "ge");
  return le(b, a);
}

/** Total order for sorting: Python's sort only ever asks `<`. */
function cmp(a, b) {
  return lt(a, b) ? -1 : lt(b, a) ? 1 : 0;
}

export function contains(container, item) {
  if (container instanceof PyDict || container instanceof PySet) return container.has(item);
  if (typeof container === "string") {
    if (typeof item !== "string") throw new TypeError_(`'in <string>' requires string as left operand, not ${typeName(item)}`);
    return container.includes(item);
  }
  if (Array.isArray(container)) {
    for (const x of container) if (x === item || eq(x, item)) return true;
    return false;
  }
  if (container instanceof DictView) return container.__contains__(item);
  if (container instanceof Range) {
    if (!isIntLike(item) && !(item instanceof PyFloat)) return false;
    const v = nv(item);
    if (!Number.isInteger(v)) return false;
    const { start, stop, step } = container;
    if (step > 0 ? v < start || v >= stop : v > start || v <= stop) return false;
    return (v - start) % step === 0;
  }
  if (container === null || container === undefined) throw new TypeError_("argument of type 'NoneType' is not iterable");
  if (typeof container.__contains__ === "function") return container.__contains__(item);
  for (const x of iter(container)) if (eq(x, item)) return true;
  return false;
}
export function notIn(container, item) {
  return !contains(container, item);
}

// ─── Arithmetic ──────────────────────────────────────────────────

function numOp(a, b, sym) {
  if (!isNum(a) || !isNum(b)) throw new TypeError_(`unsupported operand type(s) for ${sym}: '${typeName(a)}' and '${typeName(b)}'`);
}
const bothInt = (a, b) => isIntLike(a) && isIntLike(b);

// Ints are JS numbers. Beyond 2^53 a result may have lost digits that Python's int keeps: there
// the exact value is computed with BigInt, and a result JS can't hold exactly raises instead of
// going on wrong (the silicon modules stay far below 2^53).
function exactInt(r, exact) {
  if (r <= Number.MAX_SAFE_INTEGER && r >= -Number.MAX_SAFE_INTEGER) return r;
  const e = exact();
  if (Number.isFinite(r) && BigInt(r) === e) return r;
  throw new OverflowError(`integer result ${e} is beyond what a JS number holds exactly`);
}
const big = (v) => BigInt(nv(v));

export function add(a, b) {
  if (typeof a === "number" && typeof b === "number" && Number.isInteger(a) && Number.isInteger(b)) return exactInt(a + b, () => big(a) + big(b));
  if (typeof a === "string" && typeof b === "string") return a + b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if ((a instanceof Tuple) !== (b instanceof Tuple)) throw new TypeError_(`can only concatenate ${typeName(a)} (not "${typeName(b)}") to ${typeName(a)}`);
    return a instanceof Tuple ? tuple([...a, ...b]) : [...a, ...b];
  }
  numOp(a, b, "+");
  return bothInt(a, b) ? exactInt(nv(a) + nv(b), () => big(a) + big(b)) : fl(nv(a) + nv(b));
}
export function sub(a, b) {
  if (typeof a === "number" && typeof b === "number" && Number.isInteger(a) && Number.isInteger(b)) return exactInt(a - b, () => big(a) - big(b));
  if (a instanceof PySet && b instanceof PySet) return a.difference(b);
  if (isSetView(a) || isSetView(b)) {
    const r = viewToSet(a);
    r.difference_update(b);
    return r;
  }
  numOp(a, b, "-");
  return bothInt(a, b) ? exactInt(nv(a) - nv(b), () => big(a) - big(b)) : fl(nv(a) - nv(b));
}
export function mul(a, b) {
  // + 0: Python ints have no -0 (JS gives 0 * -5 === -0)
  if (typeof a === "number" && typeof b === "number" && Number.isInteger(a) && Number.isInteger(b)) return exactInt(a * b + 0, () => big(a) * big(b));
  if (typeof a === "string" && isIntLike(b)) return nv(b) > 0 ? a.repeat(nv(b)) : "";
  if (typeof b === "string" && isIntLike(a)) return mul(b, a);
  if (Array.isArray(a) && isIntLike(b)) {
    const out = [];
    for (let i = 0; i < nv(b); i++) out.push(...a);
    return a instanceof Tuple ? tuple(out) : out;
  }
  if (Array.isArray(b) && isIntLike(a)) return mul(b, a);
  numOp(a, b, "*");
  return bothInt(a, b) ? exactInt(nv(a) * nv(b) + 0, () => big(a) * big(b)) : fl(nv(a) * nv(b));
}
export function truediv(a, b) {
  if (a && typeof a.__truediv__ === "function") return a.__truediv__(b);
  numOp(a, b, "/");
  if (nv(b) === 0) throw new ZeroDivisionError(bothInt(a, b) ? "division by zero" : "float division by zero");
  return fl(nv(a) / nv(b));
}
export function floordiv(a, b) {
  numOp(a, b, "//");
  const x = nv(a);
  const y = nv(b);
  if (y === 0) throw new ZeroDivisionError(bothInt(a, b) ? "integer division or modulo by zero" : "float floor division by zero");
  if (bothInt(a, b)) return Math.floor(x / y) + 0;
  return fl(floatDivMod(x, y)[0]);
}
const copysign0 = (v) => (v < 0 || Object.is(v, -0) ? -0 : 0);
/** _float_div_mod (Objects/floatobject.c): [floordiv, mod] of two floats. */
function floatDivMod(vx, wx) {
  let mod = vx % wx; // fmod
  let div = (vx - mod) / wx;
  if (mod) {
    if (wx < 0 !== mod < 0) {
      mod += wx;
      div -= 1.0;
    }
  } else {
    mod = copysign0(wx);
  }
  let floordiv;
  if (div) {
    floordiv = Math.floor(div);
    if (div - floordiv > 0.5) floordiv += 1.0;
  } else {
    floordiv = copysign0(vx / wx);
  }
  return [floordiv, mod];
}
export function mod(a, b) {
  if (typeof a === "string") throw new NotImplementedError("printf-style formatting is not supported");
  numOp(a, b, "%");
  const x = nv(a);
  const y = nv(b);
  if (y === 0) throw new ZeroDivisionError(bothInt(a, b) ? "integer modulo by zero" : "float modulo by zero");
  if (bothInt(a, b)) {
    const r = x % y;
    return (r !== 0 && r < 0 !== y < 0 ? r + y : r) + 0;
  }
  return fl(floatDivMod(x, y)[1]);
}
export function pow(a, b) {
  numOp(a, b, "**");
  if (bothInt(a, b) && nv(b) >= 0) return exactInt(nv(a) ** nv(b), () => big(a) ** big(b));
  return fl(nv(a) ** nv(b));
}
export function neg(a) {
  if (typeof a === "number") return Number.isInteger(a) ? 0 - a : -a; // an int: no -0
  if (a instanceof PyFloat) return fl(-a.v);
  if (typeof a === "boolean") return 0 - nv(a);
  throw new TypeError_(`bad operand type for unary -: '${typeName(a)}'`);
}
export function pos(a) {
  if (typeof a === "boolean") return nv(a);
  return a;
}
// Set operators with a dict view on either side (Objects/dictobject.c dictviews_*)
function viewToSet(v) {
  if (v instanceof DictView && v.kind === "keys" && v.d.constructor === PyDict) return new PySet(v.d);
  return new PySet(v);
}
function viewIntersect(self, other) {
  if (!isSetView(self)) [self, other] = [other, self];
  const lenSelf = self.__len__();
  if (other instanceof PySet && !other.frozen && lenSelf <= other.size) return other.intersection(self);
  if (isSetView(other) && other.__len__() > lenSelf) [self, other] = [other, self];
  const result = new PySet();
  for (const k of iter(other)) if (self.__contains__(k)) result.add(k);
  return result;
}

export function bitand(a, b) {
  if (a instanceof PySet && b instanceof PySet) return a.intersection(b);
  if (isSetView(a) || isSetView(b)) return viewIntersect(a, b);
  if (typeof a === "boolean" && typeof b === "boolean") return a && b;
  return nv(a) & nv(b);
}
export function bitor(a, b) {
  if (a instanceof PySet && b instanceof PySet) return a.union(b);
  if (isSetView(a) || isSetView(b)) {
    const r = viewToSet(a);
    r.update(b);
    return r;
  }
  if (a instanceof PyDict && b instanceof PyDict) {
    const d = a.copy();
    dictUpdate(d, b);
    return d;
  }
  if (typeof a === "boolean" && typeof b === "boolean") return a || b;
  return nv(a) | nv(b);
}
export function bitxor(a, b) {
  // the set itself, not a copy: its table order decides the result's
  if (setLike(a) && setLike(b)) return (a instanceof PySet ? a : viewToSet(a)).symmetric_difference(b);
  if (typeof a === "boolean" && typeof b === "boolean") return a !== b;
  return nv(a) ^ nv(b);
}
export function lshift(a, b) {
  return exactInt(nv(a) * 2 ** nv(b), () => big(a) << big(b));
}
export function rshift(a, b) {
  return Math.floor(nv(a) / 2 ** nv(b));
}

// In-place operators: lists, sets and dicts change in place, as in Python.
export function iadd(a, b) {
  if (Array.isArray(a) && !(a instanceof Tuple)) {
    for (const x of iter(b)) a.push(x);
    return a;
  }
  return add(a, b);
}
export function isub(a, b) {
  if (a instanceof PySet && b instanceof PySet) {
    a.difference_update(b);
    return a;
  }
  return sub(a, b);
}
export function ior(a, b) {
  if (a instanceof PySet && b instanceof PySet) {
    a.update(b);
    return a;
  }
  if (a instanceof PyDict) {
    dictUpdate(a, b);
    return a;
  }
  return bitor(a, b);
}
export function ixor(a, b) {
  if (a instanceof PySet && setLike(b)) {
    a.symmetric_difference_update(b);
    return a;
  }
  return bitxor(a, b);
}
export function iand(a, b) {
  if (a instanceof PySet && b instanceof PySet) {
    a.intersection_update(b);
    return a;
  }
  return bitand(a, b);
}
export function imul(a, b) {
  if (Array.isArray(a) && !(a instanceof Tuple) && isIntLike(b)) {
    const items = [...a];
    a.length = 0;
    for (let i = 0; i < nv(b); i++) a.push(...items);
    return a;
  }
  return mul(a, b);
}

// ─── Indexing and slicing ────────────────────────────────────────

const hasSurrogates = (s) => /[\ud800-\udfff]/.test(s);

function normIndex(i, n, what) {
  if (!isIntLike(i)) throw new TypeError_(`${what} indices must be integers or slices, not ${typeName(i)}`);
  i = nv(i);
  const j = i < 0 ? i + n : i;
  if (j < 0 || j >= n) throw new IndexError(`${what} index out of range`);
  return j;
}

export function getitem(o, k) {
  if (o instanceof PyDict) return o.item(k);
  if (Array.isArray(o)) {
    if (typeof k === "number" && k >= 0 && k < o.length && Number.isInteger(k)) return o[k];
    return o[normIndex(k, o.length, o instanceof Tuple ? "tuple" : "list")];
  }
  if (typeof o === "string") {
    if (hasSurrogates(o)) {
      const cps = [...o];
      return cps[normIndex(k, cps.length, "string")];
    }
    return o[normIndex(k, o.length, "string")];
  }
  if (o instanceof Range) return [...o][normIndex(k, o.__len__(), "range object")];
  if (o instanceof Deque) return o.items[normIndex(k, o.items.length, "deque")];
  if (o && typeof o.__getitem__ === "function") return o.__getitem__(k);
  if (o === null || o === undefined) throw new TypeError_("'NoneType' object is not subscriptable");
  throw new TypeError_(`'${typeName(o)}' object is not subscriptable`);
}

export function setitem(o, k, v) {
  if (o instanceof PyDict) {
    o.set(k, v);
    return;
  }
  if (Array.isArray(o) && !(o instanceof Tuple)) {
    o[normIndex(k, o.length, "list assignment")] = v;
    return;
  }
  throw new TypeError_(`'${typeName(o)}' object does not support item assignment`);
}

export function delitem(o, k) {
  if (o instanceof PyDict) return o.delete(k);
  if (Array.isArray(o) && !(o instanceof Tuple)) return void o.splice(normIndex(k, o.length, "list assignment"), 1);
  throw new TypeError_(`'${typeName(o)}' object doesn't support item deletion`);
}

/** o[k] op= v with o and k evaluated once. */
export function augitem(o, k, op, v) {
  const r = op(getitem(o, k), v);
  setitem(o, k, r);
  return r;
}

function sliceIndices(n, lo, hi, step) {
  step = step === null || step === undefined ? 1 : nv(step);
  if (step === 0) throw new ValueError("slice step cannot be zero");
  const norm = (v, def) => {
    if (v === null || v === undefined) return def;
    if (!isIntLike(v)) throw new TypeError_("slice indices must be integers or None or have an __index__ method");
    v = nv(v);
    if (v < 0) v += n;
    return v;
  };
  let start;
  let stop;
  if (step > 0) {
    start = Math.min(Math.max(norm(lo, 0), 0), n);
    stop = Math.min(Math.max(norm(hi, n), 0), n);
  } else {
    start = Math.min(Math.max(norm(lo, n - 1), -1), n - 1);
    stop = Math.min(Math.max(norm(hi, -1), -1), n - 1);
  }
  return [start, stop, step];
}

export function slice(o, lo, hi, step) {
  const isStr = typeof o === "string";
  const seq = isStr ? (hasSurrogates(o) ? [...o] : o) : Array.isArray(o) ? o : list(o);
  const n = seq.length;
  const [start, stop, st] = sliceIndices(n, lo, hi, step);
  let out;
  if (st === 1) {
    out = seq.slice(start, Math.max(start, stop));
  } else {
    out = [];
    if (st > 0) for (let i = start; i < stop; i += st) out.push(seq[i]);
    else for (let i = start; i > stop; i += st) out.push(seq[i]);
  }
  if (isStr) return Array.isArray(out) ? out.join("") : out;
  return o instanceof Tuple ? tuple(out) : Array.from(out);
}

// ─── Iteration ───────────────────────────────────────────────────

export function iter(o) {
  if (o === null || o === undefined) throw new TypeError_("'NoneType' object is not iterable");
  if (typeof o === "string" || Array.isArray(o)) return o;
  if (o instanceof PyDict) return o.keys();
  if (typeof o[Symbol.iterator] === "function") return o;
  throw new TypeError_(`'${typeName(o)}' object is not iterable`);
}

/** iter(x): a Python iterator, i.e. a JS iterator next() can be called on. */
export function pyiter(o) {
  const it = iter(o)[Symbol.iterator]();
  if (typeof it[Symbol.iterator] !== "function") it[Symbol.iterator] = function () {
    return this;
  };
  return it;
}

export function next(it, ...dflt) {
  if (typeof it.next !== "function") throw new TypeError_(`'${typeName(it)}' object is not an iterator`);
  const r = it.next();
  if (r.done) {
    if (dflt.length) return dflt[0];
    throw new StopIteration();
  }
  return r.value;
}

/** a, b = x  →  unpack(x, 2);  a, *b, c = x  →  unpack(x, 2, 1). */
export function unpack(o, n, star = -1) {
  const items = Array.isArray(o) ? o : [...iter(o)];
  if (star < 0) {
    if (items.length !== n) {
      if (items.length < n) throw new ValueError(`not enough values to unpack (expected ${n}, got ${items.length})`);
      throw new ValueError(`too many values to unpack (expected ${n})`);
    }
    return items;
  }
  if (items.length < n) throw new ValueError(`not enough values to unpack (expected at least ${n}, got ${items.length})`);
  const after = n - star;
  return [...items.slice(0, star), items.slice(star, items.length - after), ...items.slice(items.length - after)];
}

export function len(o) {
  if (typeof o === "string") return hasSurrogates(o) ? [...o].length : o.length;
  if (Array.isArray(o)) return o.length;
  if (o instanceof PyDict || o instanceof PySet) return o.size;
  if (o && typeof o.__len__ === "function") return o.__len__();
  throw new TypeError_(`object of type '${typeName(o)}' has no len()`);
}

export function list(o = null) {
  if (o === null) return [];
  return Array.from(iter(o));
}

export function* enumerate(o, ...rest) {
  const [pos, kw] = splitKw(rest);
  let i = nv(kw.start ?? pos[0] ?? 0);
  for (const x of iter(o)) yield T(i++, x);
}

export function* zip(...args) {
  const [its, kw] = splitKw(args);
  const iters = its.map((x) => iter(x)[Symbol.iterator]());
  if (!iters.length) return;
  for (;;) {
    const row = new Tuple();
    for (let k = 0; k < iters.length; k++) {
      const r = iters[k].next();
      if (r.done) {
        if (kw.strict && (k > 0 || iters.slice(1).some((it) => !it.next().done))) throw new ValueError("zip() argument lengths differ");
        return;
      }
      row.push(r.value);
    }
    yield row;
  }
}

export function reversed(o) {
  if (o instanceof PyDict) return [...o.keys()].reverse()[Symbol.iterator]();
  const items = Array.isArray(o) ? [...o] : typeof o === "string" ? [...o] : o instanceof Range ? [...o] : null;
  if (items === null) throw new TypeError_(`'${typeName(o)}' object is not reversible`);
  return items.reverse()[Symbol.iterator]();
}

export function* map(f, ...its) {
  if (its.length === 1) {
    for (const x of iter(its[0])) yield f(x);
    return;
  }
  for (const row of zip(...its)) yield f(...row);
}

export function* filter(f, it) {
  for (const x of iter(it)) if (f === null ? bool(x) : bool(f(x))) yield x;
}

export function any(it) {
  for (const x of iter(it)) if (bool(x)) return true;
  return false;
}
export function all(it) {
  for (const x of iter(it)) if (!bool(x)) return false;
  return true;
}

// ─── Builtins ────────────────────────────────────────────────────

export function abs(x) {
  if (typeof x === "number") return Math.abs(x);
  if (x instanceof PyFloat) return fl(Math.abs(x.v));
  if (typeof x === "boolean") return nv(x);
  throw new TypeError_(`bad operand type for abs(): '${typeName(x)}'`);
}

/** sum() as CPython 3.12+ computes it: exact ints, then Neumaier-compensated floats. */
export function sum(it, ...rest) {
  const [pos, kw] = splitKw(rest);
  let result = kw.start ?? pos[0] ?? 0;
  if (typeof result === "string") throw new TypeError_("sum() can't sum strings [use ''.join(seq) instead]");
  const src = iter(it)[Symbol.iterator]();
  if (isIntLike(result)) {
    let i = nv(result);
    for (;;) {
      const r = src.next();
      if (r.done) return i;
      if (isIntLike(r.value)) {
        i += nv(r.value);
        continue;
      }
      result = add(i, r.value);
      break;
    }
  }
  if (isFloat(result)) {
    let hi = nv(result);
    let lo = 0;
    for (;;) {
      const r = src.next();
      if (r.done) return fl(lo && Number.isFinite(lo) ? hi + lo : hi);
      const x = r.value;
      if (isNum(x)) {
        const v = nv(x);
        const t = hi + v;
        if (Math.abs(hi) >= Math.abs(v)) lo += hi - t + v;
        else lo += v - t + hi;
        hi = t;
        continue;
      }
      result = add(fl(lo && Number.isFinite(lo) ? hi + lo : hi), x);
      break;
    }
  }
  for (;;) {
    const r = src.next();
    if (r.done) return result;
    result = add(result, r.value);
  }
}

function minmax(args, isMax) {
  const [pos, kw] = splitKw(args);
  const key = kw.key ?? null;
  const hasDefault = Object.hasOwn(kw, "default");
  const items = pos.length === 1 ? iter(pos[0]) : pos;
  let best;
  let bestKey;
  let first = true;
  for (const x of items) {
    const k = key === null ? x : key(x);
    if (first) {
      best = x;
      bestKey = k;
      first = false;
    } else if (isMax ? gt(k, bestKey) : lt(k, bestKey)) {
      best = x;
      bestKey = k;
    }
  }
  if (first) {
    if (hasDefault) return kw.default;
    throw new ValueError(`${isMax ? "max" : "min"}() iterable argument is empty`);
  }
  return best;
}
export function max(...args) {
  return minmax(args, true);
}
export function min(...args) {
  return minmax(args, false);
}

/** sorted(iterable, key=None, reverse=False): stable, ordered by Python's `<`. */
export function sorted(...args) {
  const [pos, kw] = splitKw(args);
  const items = list(pos[0]);
  sortList(items, kw.key ?? null, kw.reverse ?? false);
  return items;
}
function sortList(items, key, reverse) {
  const keyed = items.map((x) => [key === null ? x : key(x), x]);
  // list.sort(reverse=True) reverses, sorts stably, reverses back: equal items keep their order
  if (reverse) keyed.reverse();
  keyed.sort((a, b) => cmp(a[0], b[0]));
  if (reverse) keyed.reverse();
  for (let i = 0; i < items.length; i++) items[i] = keyed[i][1];
}

/** round(x[, n]) with CPython's correctly rounded, half-to-even result. */
export function round(x, n = null) {
  if (typeof x === "boolean") x = nv(x);
  if (!isNum(x)) throw new TypeError_(`type ${typeName(x)} doesn't define __round__ method`);
  const int = isIntLike(x);
  const v = nv(x);
  if (n === null || n === undefined) {
    if (int) return v;
    if (!Number.isFinite(v)) throw new ValueError(Number.isNaN(v) ? "cannot convert float NaN to integer" : "cannot convert float infinity to integer");
    // + 0: round(-0.0) is the int 0
    const f = Math.floor(v);
    const d = v - f;
    if (d > 0.5) return f + 1 + 0;
    if (d < 0.5) return f + 0;
    return (f % 2 === 0 ? f : f + 1) + 0;
  }
  n = nv(n);
  if (int) {
    if (n >= 0) return v;
    const p = 10 ** -n;
    const q = Math.floor(v / p);
    const r = v - q * p;
    const half = p / 2;
    let out = r > half || (r === half && q % 2 !== 0) ? (q + 1) * p : q * p;
    return out;
  }
  if (!Number.isFinite(v) || v === 0) return fl(v);
  return fl(roundDigits(v, n));
}
function roundDigits(x, n) {
  if (n > 330) return x;
  if (n < -330) return 0 * x;
  const negative = x < 0;
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(x));
  const bits = buf.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  let mant = bits & 0xfffffffffffffn;
  let e;
  if (expBits === 0) e = -1074;
  else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  let numr = mant;
  let den = 1n;
  if (e >= 0) numr <<= BigInt(e);
  else den <<= BigInt(-e);
  if (n >= 0) numr *= 10n ** BigInt(n);
  else den *= 10n ** BigInt(-n);
  let q = numr / den;
  const r2 = (numr % den) * 2n;
  if (r2 > den || (r2 === den && q % 2n === 1n)) q += 1n;
  const out = Number((negative ? "-" : "") + q.toString() + "e" + -n);
  return out === 0 && negative ? -0 : out;
}

export function int(x = 0, base = null) {
  if (typeof x === "boolean") return nv(x);
  if (typeof x === "number" || x instanceof PyFloat) {
    const v = nv(x);
    if (!Number.isFinite(v)) throw new ValueError(Number.isNaN(v) ? "cannot convert float NaN to integer" : "cannot convert float infinity to integer");
    return Math.trunc(v) || 0;
  }
  if (typeof x === "string") {
    const s = strStrip(x, null, true, true).replace(/(?<=\d)_(?=\d)/g, "");
    const b = base === null ? 10 : nv(base);
    const ok = b === 10 ? /^[+-]?\d+$/.test(s) : b === 16 ? /^[+-]?(0x)?[0-9a-f]+$/i.test(s) : /^[+-]?[0-9a-z]+$/i.test(s);
    if (!ok) throw new ValueError(`invalid literal for int() with base ${b}: ${repr(x)}`);
    return parseInt(s, b);
  }
  throw new TypeError_(`int() argument must be a string, a bytes-like object or a real number, not '${typeName(x)}'`);
}

export function float(x = 0) {
  if (isNum(x)) return fl(nv(x));
  if (typeof x === "string") {
    const s = strStrip(x, null, true, true).toLowerCase().replace(/(?<=\d)_(?=\d)/g, "");
    if (/^[+-]?(inf|infinity)$/.test(s)) return s.startsWith("-") ? -Infinity : Infinity;
    if (/^[+-]?nan$/.test(s)) return NaN;
    if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(s)) return fl(Number(s));
    throw new ValueError(`could not convert string to float: ${repr(x)}`);
  }
  throw new TypeError_(`float() argument must be a string or a real number, not '${typeName(x)}'`);
}

export function ord(c) {
  if (typeof c !== "string" || len(c) !== 1) throw new TypeError_(`ord() expected a character, but string of length ${typeof c === "string" ? len(c) : "?"} found`);
  return c.codePointAt(0);
}
export function chr(i) {
  return String.fromCodePoint(nv(i));
}

// ─── str(), repr(), format() ─────────────────────────────────────

/** repr() of a float: the shortest digits that round-trip, as Python prints them. */
export function floatRepr(x) {
  if (Number.isNaN(x)) return "nan";
  if (x === Infinity) return "inf";
  if (x === -Infinity) return "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const [mant, expStr] = x.toExponential().split("e");
  const exp = Number(expStr);
  const neg = mant.startsWith("-");
  const digits = mant.replace("-", "").replace(".", "");
  if (exp < -4 || exp >= 16) {
    const m = digits.length > 1 ? digits[0] + "." + digits.slice(1) : digits;
    return (neg ? "-" : "") + m + "e" + (exp < 0 ? "-" : "+") + String(Math.abs(exp)).padStart(2, "0");
  }
  let s;
  if (exp >= 0) {
    if (digits.length <= exp + 1) s = digits + "0".repeat(exp + 1 - digits.length) + ".0";
    else s = digits.slice(0, exp + 1) + "." + digits.slice(exp + 1);
  } else {
    s = "0." + "0".repeat(-exp - 1) + digits;
  }
  return (neg ? "-" : "") + s;
}

function numStr(v) {
  if (v instanceof PyFloat) return floatRepr(v.v);
  if (typeof v === "boolean") return v ? "True" : "False";
  if (Number.isInteger(v)) return Math.abs(v) < 2 ** 53 ? String(v) : BigInt(v).toString();
  return floatRepr(v);
}

export function strRepr(s) {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === quote) out += "\\" + ch;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20 || c === 0x7f) out += "\\x" + c.toString(16).padStart(2, "0");
    else if (!isPrintable(ch)) out += c <= 0xff ? "\\x" + c.toString(16).padStart(2, "0") : c <= 0xffff ? "\\u" + c.toString(16).padStart(4, "0") : "\\U" + c.toString(16).padStart(8, "0");
    else out += ch;
  }
  return out + quote;
}
function isPrintable(ch) {
  // str.isprintable: not in categories Cc Cf Cs Co Cn Zl Zp Zs, except space
  if (ch === " ") return true;
  return !/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u.test(ch);
}

export function repr(v) {
  if (v === null || v === undefined) return "None";
  switch (typeof v) {
    case "boolean":
      return v ? "True" : "False";
    case "number":
      return numStr(v);
    case "string":
      return strRepr(v);
    case "function":
      return `<function ${v.name}>`;
  }
  if (v instanceof PyFloat) return floatRepr(v.v);
  if (v instanceof Tuple) return v.length === 1 ? `(${repr(v[0])},)` : `(${v.map(repr).join(", ")})`;
  if (Array.isArray(v)) return `[${v.map(repr).join(", ")}]`;
  if (v instanceof DefaultDict) return `defaultdict(${v.default_factory?.__pyname__ ?? v.default_factory?.name ?? "None"}, ${dictRepr(v)})`;
  if (v instanceof Counter) return v.size ? `Counter(${dictRepr(v)})` : "Counter()";
  if (v instanceof PyDict) return dictRepr(v);
  if (v instanceof PySet) {
    if (!v.size) return v.frozen ? "frozenset()" : "set()";
    const body = `{${[...v].map(repr).join(", ")}}`;
    return v.frozen ? `frozenset(${body})` : body;
  }
  if (v instanceof DictView) return `dict_${v.kind}(${repr(list(v))})`;
  if (v instanceof Range) return v.step === 1 ? `range(${v.start}, ${v.stop})` : `range(${v.start}, ${v.stop}, ${v.step})`;
  if (v instanceof BaseException) return `${v.name}(${v.args.map(repr).join(", ")})`;
  if (typeof v.__repr__ === "function") return v.__repr__();
  return `<${typeName(v)} object>`;
}
function dictRepr(d) {
  return `{${[...d.entries()].map(([k, x]) => `${repr(k)}: ${repr(x)}`).join(", ")}}`;
}

export function pystr(v) {
  if (typeof v === "string") return v;
  if (typeof v === "number" || v instanceof PyFloat) return numStr(v);
  if (v instanceof BaseException) return v.__str__();
  if (v && typeof v.__str__ === "function") return v.__str__();
  return repr(v);
}
export { pystr as str };

/** format(value, spec), the format-spec mini-language. */
export function format(v, spec = "") {
  if (spec === "") return pystr(v);
  const m = /^(?:(.)?([<>^=]))?([+\- ])?(z)?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/su.exec(spec);
  if (!m) throw new ValueError(`Invalid format specifier '${spec}' for object of type '${typeName(v)}'`);
  let [, fill, align, sign, , , zero, width, group, prec, type] = m;
  let s;
  if (typeof v === "string") {
    if (type && type !== "s") throw new ValueError(`Unknown format code '${type}' for object of type 'str'`);
    s = prec !== undefined ? [...v].slice(0, Number(prec)).join("") : v;
  } else if (!isNum(v)) {
    s = pystr(v);
  } else {
    const x = nv(v);
    const isF = isFloat(v);
    if (type === undefined && prec === undefined) {
      s = numStr(typeof v === "boolean" ? nv(v) : v);
    } else if (type === "d" || (type === undefined && !isF && prec === undefined)) {
      if (isF) throw new ValueError(`Unknown format code 'd' for object of type 'float'`);
      s = String(Math.abs(x));
      if (x < 0) s = "-" + s;
    } else if (type === "x" || type === "X" || type === "o" || type === "b") {
      if (isF) throw new ValueError(`Unknown format code '${type}' for object of type 'float'`);
      s = Math.abs(x).toString(type === "o" ? 8 : type === "b" ? 2 : 16);
      if (type === "X") s = s.toUpperCase();
      if (x < 0) s = "-" + s;
    } else if (type === "g" || type === "G" || type === undefined) {
      const p = prec === undefined ? (type === undefined ? null : 6) : Math.max(1, Number(prec));
      s = p === null ? numStr(v) : formatG(x, p, type === undefined && isF);
      if (type === "G") s = s.toUpperCase();
    } else if (type === "f" || type === "F") {
      s = fixedHalfEven(x, prec === undefined ? 6 : Number(prec));
      if (type === "F") s = s.toUpperCase();
    } else if (type === "%") {
      s = fixedHalfEven(x * 100, prec === undefined ? 6 : Number(prec)) + "%";
    } else if (type === "e" || type === "E") {
      s = expHalfEven(x, prec === undefined ? 6 : Number(prec));
      if (type === "E") s = s.toUpperCase();
    } else {
      s = numStr(v);
    }
    if (group) {
      const negative = s.startsWith("-");
      const body = negative ? s.slice(1) : s;
      const [ip, fp] = body.split(".");
      s = (negative ? "-" : "") + ip.replace(/\B(?=(\d{3})+(?!\d))/g, group) + (fp !== undefined ? "." + fp : "");
    }
    if (sign === "+" && !s.startsWith("-")) s = "+" + s;
    if (sign === " " && !s.startsWith("-")) s = " " + s;
  }
  if (width !== undefined) {
    const w = Number(width);
    const n = Math.max(0, w - len(s));
    if (zero && !align && isNum(v)) {
      const signed = /^[+\- ]/.test(s);
      s = (signed ? s[0] : "") + "0".repeat(n) + (signed ? s.slice(1) : s);
    } else {
      const f = fill ?? (zero && !align ? "0" : " ");
      const a = align ?? (zero ? "=" : isNum(v) ? ">" : "<");
      if (a === "<") s = s + f.repeat(n);
      else if (a === ">") s = f.repeat(n) + s;
      else if (a === "^") s = f.repeat(Math.floor(n / 2)) + s + f.repeat(n - Math.floor(n / 2));
      else if (a === "=") {
        const signed = /^[+\- ]/.test(s);
        s = (signed ? s[0] : "") + f.repeat(n) + (signed ? s.slice(1) : s);
      }
    }
  }
  return s;
}
// Float formatting as CPython does it (correctly rounded, half to even on the exact binary value):
// a finite double is exactly N × 10^k for integers N, k, so rounding is exact BigInt arithmetic.
const F64 = new DataView(new ArrayBuffer(8));
/** |x| = N × 10^k exactly; [N, k] for finite nonzero x. */
function exactDecimal(x) {
  F64.setFloat64(0, Math.abs(x));
  const hi = F64.getUint32(0);
  const lo = F64.getUint32(4);
  const expField = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e;
  if (expField === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = expField - 1075;
  }
  if (e >= 0) return [m << BigInt(e), 0];
  return [m * 5n ** BigInt(-e), e]; // m / 2^k = m·5^k / 10^k
}
/** N × 10^k rounded half-even to a multiple of 10^target; returns the multiple's count. */
function roundTo(N, k, target) {
  if (target <= k) return N * 10n ** BigInt(k - target);
  const d = 10n ** BigInt(target - k);
  const q = N / d;
  const r2 = (N % d) * 2n;
  return r2 > d || (r2 === d && q % 2n === 1n) ? q + 1n : q;
}
const negSign = (x) => (x < 0 || Object.is(x, -0) ? "-" : "");
function fixedHalfEven(x, p) {
  if (!Number.isFinite(x)) return floatRepr(x);
  if (x === 0) return negSign(x) + "0" + (p ? "." + "0".repeat(p) : "");
  const [N, k] = exactDecimal(x);
  let digits = roundTo(N, k, -p).toString().padStart(p + 1, "0");
  if (p) digits = digits.slice(0, -p) + "." + digits.slice(-p);
  return negSign(x) + digits;
}
/** [mantissa digits (p + 1 of them), decimal exponent] of x rounded to p + 1 significant digits */
function sigDigits(x, p) {
  const [N, k] = exactDecimal(x);
  let exp = N.toString().length - 1 + k;
  let q = roundTo(N, k, exp - p);
  if (q.toString().length > p + 1) {
    exp += 1;
    q /= 10n;
  }
  return [q.toString(), exp];
}
function expHalfEven(x, p) {
  if (!Number.isFinite(x)) return floatRepr(x);
  if (x === 0) return negSign(x) + "0" + (p ? "." + "0".repeat(p) : "") + "e+00";
  const [digits, exp] = sigDigits(x, p);
  const mant = digits[0] + (p ? "." + digits.slice(1) : "");
  return negSign(x) + mant + "e" + (exp < 0 ? "-" : "+") + String(Math.abs(exp)).padStart(2, "0");
}
/** %g: precision p significant digits; `general` is the no-type float form (keeps ".0"). */
function formatG(x, p, general) {
  if (!Number.isFinite(x)) return floatRepr(x);
  if (x === 0) return Object.is(x, -0) ? "-0" : general ? "0.0" : "0";
  const e = expHalfEven(x, p - 1);
  const exp = Number(e.split("e")[1]);
  let s;
  if (exp < -4 || exp >= p) {
    let [mm, ee] = e.split("e");
    if (mm.includes(".")) mm = mm.replace(/0+$/, "").replace(/\.$/, "");
    s = mm + "e" + ee;
  } else {
    s = fixedHalfEven(x, Math.max(0, p - 1 - exp));
    if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
    if (general && !s.includes(".") && !s.includes("e")) s += ".0";
  }
  return s;
}

// ─── Functions, calls, attributes ────────────────────────────────

/** Record a transpiled function's Python parameters, for keyword calls. */
export function sig(fn, params, opts = {}) {
  fn.__pyparams = params;
  if (opts.kwarg) fn.__pykwarg = true;
  if (opts.vararg) fn.__pyvararg = params.length;
  return fn;
}

/** f bound to o, keeping the Python signature call() needs. */
export function bindPy(f, o) {
  const b = f.bind(o);
  if (f.__pyparams) b.__pyparams = f.__pyparams;
  if (f.__pykwarg) b.__pykwarg = f.__pykwarg;
  if (f.__pyvararg !== undefined) b.__pyvararg = f.__pyvararg;
  return b;
}

/** f(*pos, **kw) for a transpiled (or runtime) callable. */
export function call(f, pos, kw = {}) {
  if (typeof f !== "function") {
    if (f && typeof f.__call__ === "function") return call(bindPy(f.__call__, f), pos, kw);
    throw new TypeError_(`'${typeName(f)}' object is not callable`);
  }
  const names = Object.keys(kw);
  if (!names.length) return f(...pos);
  const params = f.__pyparams;
  if (!params) return f(...pos, KW(kw));
  const args = [...pos];
  let extra = null;
  for (const k of names) {
    const i = params.indexOf(k);
    if (i < 0 || (f.__pyvararg !== undefined && i >= f.__pyvararg && false)) {
      if (!f.__pykwarg) throw new TypeError_(`${f.name}() got an unexpected keyword argument '${k}'`);
      extra ??= new PyDict();
      extra.set(k, kw[k]);
      continue;
    }
    if (i < pos.length) throw new TypeError_(`${f.name}() got multiple values for argument '${k}'`);
    while (args.length < i) args.push(undefined);
    args[i] = kw[k];
  }
  if (f.__pykwarg) {
    while (args.length < params.length) args.push(undefined);
    args.push(extra ?? new PyDict());
  }
  return f(...args);
}

/** new C(*pos, **kw) for a class. */
export function construct(C, pos, kw = {}) {
  if (!Object.keys(kw).length) return new C(...pos);
  const init = C.prototype.__init__;
  if (!init || !init.__pyparams) throw new TypeError_(`${C.name}() takes no keyword arguments`);
  const params = init.__pyparams;
  const args = [...pos];
  for (const [k, v] of Object.entries(kw)) {
    const i = params.indexOf(k);
    if (i < 0) throw new TypeError_(`${C.name}() got an unexpected keyword argument '${k}'`);
    while (args.length < i) args.push(undefined);
    args[i] = v;
  }
  return new C(...args);
}

/** A **mapping argument as a plain object of keywords. */
export function kwargs(mapping) {
  const out = {};
  for (const [k, v] of iter(mapping instanceof PyDict ? mapping.entries() : mapping)) {
    if (typeof k !== "string") throw new TypeError_("keywords must be strings");
    out[k] = v;
  }
  return out;
}

/** obj.name for values that aren't modules (exceptions, matches, paths, class instances). */
export function getattr(o, name, ...dflt) {
  if (o !== null && o !== undefined && typeof o === "object" && name in o && !(o instanceof PyDict) && !Array.isArray(o)) {
    const v = o[name];
    return typeof v === "function" ? bindPy(v, o) : v;
  }
  if (o !== null && o !== undefined && typeof o === "object" && typeof o.__getattr__ === "function") return o.__getattr__(name);
  if (o !== null && o !== undefined && Object.hasOwn(METHODS, name)) return (...args) => METHODS[name](o, ...args);
  if (dflt.length) return dflt[0];
  throw new AttributeError(`'${typeName(o)}' object has no attribute '${name}'`);
}
export function hasattr(o, name) {
  try {
    getattr(o, name);
    return true;
  } catch (e) {
    if (e instanceof AttributeError) return false;
    throw e;
  }
}
export function setattr(o, name, v) {
  o[name] = v;
}

/** functools.lru_cache(fn): memoised by the arguments' dict keys. */
export function lru_cache(fn) {
  const cache = new Map();
  const wrapped = function (...args) {
    const k = args.map(hashKey).join("\u0000");
    if (cache.has(k)) return cache.get(k);
    const v = fn(...args);
    cache.set(k, v);
    return v;
  };
  if (fn.__pyparams) wrapped.__pyparams = fn.__pyparams;
  Object.defineProperty(wrapped, "name", { value: fn.name });
  wrapped.cache_clear = () => cache.clear();
  return wrapped;
}

// ─── Methods of the builtin types ────────────────────────────────

export function dictUpdate(d, other, kw = {}) {
  if (other instanceof PyDict) for (const [k, v] of other.entries()) d.set(k, v);
  else if (other !== null && other !== undefined) {
    for (const pair of iter(other)) {
      const [k, v] = unpack(pair, 2);
      d.set(k, v);
    }
  }
  for (const k of Object.keys(kw)) d.set(k, kw[k]);
}

const PY_SPACE = new Set([..."\t\n\v\f\r\x1c\x1d\x1e\x1f \x85\xa0            \u2028\u2029  　"]);
const isPySpace = (ch) => PY_SPACE.has(ch);

export function strStrip(s, chars, left, right) {
  const cps = [...s];
  const strip = chars === null || chars === undefined ? isPySpace : (c) => chars.includes(c);
  let i = 0;
  let j = cps.length;
  if (left) while (i < j && strip(cps[i])) i++;
  if (right) while (j > i && strip(cps[j - 1])) j--;
  return cps.slice(i, j).join("");
}

function strSplit(s, sep = null, maxsplit = -1) {
  maxsplit = nv(maxsplit);
  if (sep === null || sep === undefined) {
    const out = [];
    const cps = [...s];
    let i = 0;
    const n = cps.length;
    while (i < n) {
      while (i < n && isPySpace(cps[i])) i++;
      if (i >= n) break;
      if (maxsplit >= 0 && out.length === maxsplit) {
        let j = n;
        while (j > i && isPySpace(cps[j - 1])) j--;
        out.push(cps.slice(i, j).join(""));
        return out;
      }
      let j = i;
      while (j < n && !isPySpace(cps[j])) j++;
      out.push(cps.slice(i, j).join(""));
      i = j;
    }
    return out;
  }
  if (sep === "") throw new ValueError("empty separator");
  const parts = s.split(sep);
  if (maxsplit >= 0 && parts.length > maxsplit + 1) return [...parts.slice(0, maxsplit), parts.slice(maxsplit).join(sep)];
  return parts;
}

function strRsplit(s, sep = null, maxsplit = -1) {
  maxsplit = nv(maxsplit);
  if (maxsplit < 0) return strSplit(s, sep, -1);
  if (sep === null || sep === undefined) {
    const parts = strSplit(s, null, -1);
    if (parts.length <= maxsplit + 1) return parts;
    // keep the original spacing of the head
    const tail = parts.slice(parts.length - maxsplit);
    let head = strStrip(s, null, false, true);
    for (let k = tail.length - 1; k >= 0; k--) {
      head = strStrip(head.slice(0, head.length - tail[k].length), null, false, true);
    }
    return [head, ...tail];
  }
  const parts = s.split(sep);
  if (parts.length <= maxsplit + 1) return parts;
  return [parts.slice(0, parts.length - maxsplit).join(sep), ...parts.slice(parts.length - maxsplit)];
}

function strSplitlines(s, keepends = false) {
  const out = [];
  const re = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    out.push(s.slice(last, keepends ? m.index + m[0].length : m.index));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

// str.casefold beyond toLowerCase (full case folding of the characters that differ)
const CASEFOLD = { ß: "ss", ẞ: "ss", ſ: "s", ς: "σ", ﬁ: "fi", ﬂ: "fl", ﬀ: "ff", ﬃ: "ffi", ﬄ: "ffl", ﬅ: "st", ﬆ: "st", İ: "i̇", ϐ: "β", ϑ: "θ", ϕ: "φ", ϖ: "π", ϰ: "κ", ϱ: "ρ", ϵ: "ε", ẛ: "ṡ", µ: "μ", ŉ: "ʼn", ǰ: "ǰ", ΐ: "ΐ", ΰ: "ΰ", և: "եւ", ẖ: "ẖ", ẗ: "ẗ", ẘ: "ẘ", ẙ: "ẙ", ẚ: "aʾ" };
function casefold(s) {
  let out = "";
  for (const ch of s) out += CASEFOLD[ch] ?? ch.toLowerCase();
  return out;
}

function strIndex(s, sub, start = 0, end = null, raise = true) {
  if (hasSurrogates(s) || hasSurrogates(sub)) {
    const a = [...s];
    const [st, en] = sliceIndices(a.length, start, end, 1);
    const hay = a.slice(st, Math.max(st, en)).join("");
    const i = hay.indexOf(sub);
    if (i < 0) {
      if (raise) throw new ValueError("substring not found");
      return -1;
    }
    return st + [...hay.slice(0, i)].length;
  }
  const [st, en] = sliceIndices(s.length, start, end, 1);
  if (st > s.length) {
    if (raise) throw new ValueError("substring not found");
    return -1;
  }
  const i = s.slice(st, Math.max(st, en)).indexOf(sub);
  if (i < 0) {
    if (raise) throw new ValueError("substring not found");
    return -1;
  }
  return st + i;
}

function listIndex(a, x, start = 0, end = null) {
  const [st, en] = sliceIndices(a.length, start, end, 1);
  for (let i = st; i < en; i++) if (a[i] === x || eq(a[i], x)) return i;
  throw new ValueError(`${repr(x)} is not in list`);
}

function strJoin(sep, items) {
  const parts = [];
  for (const x of iter(items)) {
    if (typeof x !== "string") throw new TypeError_(`sequence item ${parts.length}: expected str instance, ${typeName(x)} found`);
    parts.push(x);
  }
  return parts.join(sep);
}

function strReplace(s, old, nw, count = -1) {
  count = nv(count);
  if (count < 0) {
    if (old === "") return [...s].length ? nw + [...s].join(nw) + nw : nw;
    return s.split(old).join(nw);
  }
  let out = "";
  let rest = s;
  for (let i = 0; i < count; i++) {
    if (old === "") {
      out += nw;
      if (!rest.length) return out;
      const ch = [...rest][0];
      out += ch;
      rest = rest.slice(ch.length);
      continue;
    }
    const j = rest.indexOf(old);
    if (j < 0) break;
    out += rest.slice(0, j) + nw;
    rest = rest.slice(j + old.length);
  }
  return out + rest;
}

function strCount(s, sub, start = 0, end = null) {
  const a = [...s];
  const [st, en] = sliceIndices(a.length, start, end, 1);
  const hay = a.slice(st, Math.max(st, en)).join("");
  if (sub === "") return [...hay].length + 1;
  return hay.split(sub).length - 1;
}

function hasCased(s) {
  return /[\p{Lu}\p{Ll}\p{Lt}]/u.test(s);
}

function noMethod(o, name) {
  return new AttributeError(`'${typeName(o)}' object has no attribute '${name}'`);
}

/** Methods of the builtin types, called as M.name(receiver, ...args, [KW]). */
const METHODS = Object.create(null);

function callOwn(o, name, args) {
  if (o instanceof Counter && COUNTER_METHODS.has(name)) return o[name](...args);
  if (o !== null && o !== undefined && typeof o === "object" && !(o instanceof PyDict) && !Array.isArray(o)) {
    const f = o[name];
    if (typeof f === "function") {
      if (f.__pyparams) {
        const [pos, kw] = splitKw(args);
        return call(bindPy(f, o), pos, kw);
      }
      return f.apply(o, args);
    }
    if (typeof o.__getattr__ === "function") {
      const g = o.__getattr__(name);
      const [pos, kw] = splitKw(args);
      return call(g, pos, kw);
    }
  }
  throw noMethod(o, name);
}

export const M = new Proxy(METHODS, {
  get(target, name) {
    if (typeof name !== "string") return undefined;
    if (Object.hasOwn(target, name)) return target[name];
    return (o, ...args) => callOwn(o, name, args);
  },
});

function def(name, impl) {
  METHODS[name] = impl;
}

const isList = (o) => Array.isArray(o) && !(o instanceof Tuple);
const isStr = (o) => typeof o === "string";

def("get", (o, ...a) => (o instanceof PyDict ? o.get(a[0], a.length > 1 ? a[1] : null) : callOwn(o, "get", a)));
def("items", (o, ...a) => (o instanceof PyDict ? new DictView(o, "items") : callOwn(o, "items", a)));
def("keys", (o, ...a) => (o instanceof PyDict ? new DictView(o, "keys") : callOwn(o, "keys", a)));
def("values", (o, ...a) => (o instanceof PyDict ? new DictView(o, "values") : callOwn(o, "values", a)));
def("setdefault", (o, k, d = null) => {
  if (!(o instanceof PyDict)) return callOwn(o, "setdefault", [k, d]);
  const e = o.getEntry(k);
  if (e) return e[1];
  o.set(k, d);
  return d;
});
def("update", (o, ...args) => {
  const [pos, kw] = splitKw(args);
  if (o instanceof Counter) {
    if (pos.length) o.addCounts(pos[0]);
    if (Object.keys(kw).length) o.addCounts(new PyDict(Object.entries(kw)));
    return null;
  }
  if (o instanceof PyDict) {
    dictUpdate(o, pos[0] ?? null, kw);
    return null;
  }
  if (o instanceof PySet) {
    o.update(...pos);
    return null;
  }
  return callOwn(o, "update", args);
});
def("pop", (o, ...a) => {
  if (o instanceof PyDict) {
    const e = o.getEntry(a[0]);
    if (e) {
      o.delete(a[0]);
      return e[1];
    }
    if (a.length > 1) return a[1];
    throw new KeyError(a[0]);
  }
  if (isList(o)) {
    if (!o.length) throw new IndexError("pop from empty list");
    const i = a.length ? normIndex(a[0], o.length, "pop") : o.length - 1;
    return o.splice(i, 1)[0];
  }
  if (o instanceof PySet) {
    const r = o.pop();
    if (r.empty) throw new KeyError("pop from an empty set");
    return r.key;
  }
  return callOwn(o, "pop", a);
});
def("popitem", (o) => {
  const last = [...o.map.keys()].pop();
  if (last === undefined) throw new KeyError("popitem(): dictionary is empty");
  const [k, v] = o.map.get(last);
  o.mods++;
  o.map.delete(last);
  return T(k, v);
});
def("copy", (o, ...a) => {
  if (o instanceof PyDict || o instanceof PySet) return o.copy();
  if (isList(o)) return [...o];
  return callOwn(o, "copy", a);
});
def("clear", (o, ...a) => {
  if (o instanceof PySet) o.clear();
  else if (o instanceof PyDict) {
    o.mods++;
    o.map.clear();
  }
  else if (isList(o)) o.length = 0;
  else return callOwn(o, "clear", a);
  return null;
});
def("append", (o, x) => {
  if (isList(o)) {
    o.push(x);
    return null;
  }
  return callOwn(o, "append", [x]);
});
def("extend", (o, it) => {
  if (isList(o)) {
    const items = [...iter(it)];
    for (const x of items) o.push(x);
    return null;
  }
  return callOwn(o, "extend", [it]);
});
def("insert", (o, i, x) => {
  let j = nv(i);
  if (j < 0) j = Math.max(0, j + o.length);
  o.splice(Math.min(j, o.length), 0, x);
  return null;
});
def("remove", (o, x) => {
  if (o instanceof PySet) {
    if (!o.delete(x)) throw new KeyError(x);
    return null;
  }
  for (let i = 0; i < o.length; i++) {
    if (o[i] === x || eq(o[i], x)) {
      o.splice(i, 1);
      return null;
    }
  }
  throw new ValueError("list.remove(x): x not in list");
});
def("discard", (o, x) => {
  o.delete(x);
  return null;
});
def("add", (o, ...a) => {
  if (o instanceof PySet) {
    o.add(a[0]);
    return null;
  }
  return callOwn(o, "add", a);
});
def("sort", (o, ...args) => {
  const [, kw] = splitKw(args);
  sortList(o, kw.key ?? null, kw.reverse ?? false);
  return null;
});
def("reverse", (o) => {
  o.reverse();
  return null;
});
def("count", (o, ...a) => {
  if (isStr(o)) return strCount(o, ...a);
  let n = 0;
  for (const y of o) if (y === a[0] || eq(y, a[0])) n++;
  return n;
});
def("index", (o, ...a) => (isStr(o) ? strIndex(o, ...a) : Array.isArray(o) ? listIndex(o, ...a) : callOwn(o, "index", a)));
def("find", (o, ...a) => (isStr(o) ? strIndex(o, a[0], a[1] ?? 0, a[2] ?? null, false) : callOwn(o, "find", a)));
def("rfind", (o, sub, start = 0, end = null) => {
  const a = [...o];
  const [st, en] = sliceIndices(a.length, start, end, 1);
  const hay = a.slice(st, Math.max(st, en)).join("");
  const i = hay.lastIndexOf(sub);
  return i < 0 ? -1 : st + [...hay.slice(0, i)].length;
});
def("union", (o, ...a) => o.union(...a));
def("intersection", (o, ...a) => o.intersection(...a));
def("difference", (o, ...a) => o.difference(...a));
def("difference_update", (o, ...a) => {
  o.difference_update(...a);
  return null;
});
def("intersection_update", (o, ...a) => {
  o.intersection_update(...a);
  return null;
});
def("issubset", (o, other) => o.issubset(other instanceof PySet ? other : new PySet(other)));
def("issuperset", (o, other) => (other instanceof PySet ? other : new PySet(other)).issubset(o));
def("isdisjoint", (o, other) => {
  for (const x of iter(other)) if (o.has(x)) return false;
  return true;
});
def("join", (o, ...a) => (isStr(o) ? strJoin(o, a[0]) : callOwn(o, "join", a)));
def("strip", (o, chars = null) => strStrip(o, chars, true, true));
def("lstrip", (o, chars = null) => strStrip(o, chars, true, false));
def("rstrip", (o, chars = null) => strStrip(o, chars, false, true));
def("split", (o, ...args) => {
  if (!isStr(o)) return callOwn(o, "split", args);
  const [pos, kw] = splitKw(args);
  return strSplit(o, kw.sep ?? pos[0] ?? null, kw.maxsplit ?? pos[1] ?? -1);
});
def("rsplit", (o, ...args) => {
  const [pos, kw] = splitKw(args);
  return strRsplit(o, kw.sep ?? pos[0] ?? null, kw.maxsplit ?? pos[1] ?? -1);
});
def("splitlines", (o, keepends = false) => strSplitlines(o, keepends));
def("partition", (o, sep) => {
  const i = o.indexOf(sep);
  return i < 0 ? T(o, "", "") : T(o.slice(0, i), sep, o.slice(i + sep.length));
});
def("rpartition", (o, sep) => {
  const i = o.lastIndexOf(sep);
  return i < 0 ? T("", "", o) : T(o.slice(0, i), sep, o.slice(i + sep.length));
});
def("startswith", (o, prefix, start = 0, end = null) => {
  const sub = slice(o, start, end);
  if (Array.isArray(prefix)) return prefix.some((p) => sub.startsWith(p));
  return sub.startsWith(prefix);
});
def("endswith", (o, suffix, start = 0, end = null) => {
  const sub = slice(o, start, end);
  if (Array.isArray(suffix)) return suffix.some((p) => sub.endsWith(p));
  return sub.endsWith(suffix);
});
def("removeprefix", (o, p) => (o.startsWith(p) ? o.slice(p.length) : o));
def("removesuffix", (o, p) => (p && o.endsWith(p) ? o.slice(0, o.length - p.length) : o));
def("replace", (o, ...a) => (isStr(o) ? strReplace(o, ...a) : callOwn(o, "replace", a)));
def("lower", (o) => o.toLowerCase());
def("upper", (o) => o.toUpperCase());
def("casefold", (o) => casefold(o));
// str.title (do_title): a character after a cased one is lowercased, any other is titlecased
const CASED = /[\p{Lowercase}\p{Uppercase}\p{Lt}]/u;
const titleChar = (c) => TITLECASE[c] ?? c.toUpperCase();
def("title", (o) => {
  let out = "";
  let previousCased = false;
  for (const c of o) {
    out += previousCased ? c.toLowerCase() : titleChar(c);
    previousCased = CASED.test(c);
  }
  return out;
});
def("capitalize", (o) => (o ? titleChar([...o][0]) + [...o].slice(1).join("").toLowerCase() : o));
def("isdigit", (o) => o.length > 0 && /^[\p{Nd}²³¹⁰⁴-⁹₀-₉①-⑨⑴-⑼⒈-⒐⓪⓵-⓽⓿❶-❾➀-➈➊-➒]+$/u.test(o));
def("isdecimal", (o) => o.length > 0 && /^\p{Nd}+$/u.test(o));
def("isnumeric", (o) => o.length > 0 && /^\p{N}+$/u.test(o));
def("isspace", (o) => o.length > 0 && [...o].every(isPySpace));
def("isalpha", (o) => o.length > 0 && /^[\p{L}\p{Nl}]+$/u.test(o));
def("isalnum", (o) => o.length > 0 && /^[\p{L}\p{Nl}\p{N}]+$/u.test(o));
def("isupper", (o) => hasCased(o) && !/[\p{Ll}\p{Lt}]/u.test(o));
def("islower", (o) => hasCased(o) && !/[\p{Lu}\p{Lt}]/u.test(o));
def("isprintable", (o) => [...o].every(isPrintable));
def("zfill", (o, w) => {
  const n = nv(w) - len(o);
  if (n <= 0) return o;
  const signed = o.startsWith("-") || o.startsWith("+");
  return (signed ? o[0] : "") + "0".repeat(n) + (signed ? o.slice(1) : o);
});
def("ljust", (o, w, f = " ") => o + f.repeat(Math.max(0, nv(w) - len(o))));
def("rjust", (o, w, f = " ") => f.repeat(Math.max(0, nv(w) - len(o))) + o);
def("center", (o, w, f = " ") => {
  const n = Math.max(0, nv(w) - len(o));
  const left = Math.floor(n / 2) + (n & nv(w) & 1);
  return f.repeat(left) + o + f.repeat(n - left);
});
def("encode", (o) => new TextEncoder().encode(o));
def("format", (o, ...args) => {
  if (!isStr(o)) return callOwn(o, "format", args);
  const [pos, kw] = splitKw(args);
  let i = 0;
  return o.replace(/\{\{|\}\}|\{([^{}:!]*)(?:!([rs]))?(?::([^{}]*))?\}/g, (m, field, conv, spec) => {
    if (m === "{{") return "{";
    if (m === "}}") return "}";
    let v = field === "" ? pos[i++] : /^\d+$/.test(field) ? pos[Number(field)] : kw[field];
    if (conv === "r") v = repr(v);
    else if (conv === "s") v = pystr(v);
    return format(v, spec ?? "");
  });
});

/** dict.fromkeys(iterable, value=None) */
export function fromkeys(it, v = null) {
  const d = new PyDict();
  for (const k of iter(it)) d.set(k, v);
  return d;
}

/** dict(...) called as a function. */
export function dictCall(...args) {
  const [pos, kw] = splitKw(args);
  const d = new PyDict();
  dictUpdate(d, pos[0] ?? null, kw);
  return d;
}

// ─── Copying ─────────────────────────────────────────────────────

export function deepcopy(v, memo = new Map()) {
  if (v === null || typeof v !== "object" || v instanceof PyFloat) return v;
  if (memo.has(v)) return memo.get(v);
  let out;
  if (v instanceof Tuple) {
    const items = v.map((x) => deepcopy(x, memo));
    if (memo.has(v)) return memo.get(v);
    // a tuple of unchanged items is itself (copy._deepcopy_tuple)
    out = items.every((x, i) => x === v[i]) ? v : tuple(items);
    memo.set(v, out);
  } else if (Array.isArray(v)) {
    out = [];
    memo.set(v, out);
    for (const x of v) out.push(deepcopy(x, memo));
  } else if (v instanceof PyDict) {
    out = v instanceof DefaultDict ? new DefaultDict(v.default_factory) : v instanceof Counter ? new Counter() : new PyDict();
    memo.set(v, out);
    for (const [k, x] of v.entries()) out.set(deepcopy(k, memo), deepcopy(x, memo));
  } else if (v instanceof PySet) {
    // set.__reduce__ rebuilds from list(self): a fresh table filled in iteration order
    out = new PySet([...v].map((x) => deepcopy(x, memo)), v.frozen);
    memo.set(v, out);
  } else if (v instanceof Deque) {
    out = new Deque();
    memo.set(v, out);
    for (const x of v.items) out.items.push(deepcopy(x, memo));
  } else {
    return v;
  }
  return out;
}

export function shallowcopy(v) {
  if (v instanceof PyDict || v instanceof PySet) return v.copy();
  if (isList(v)) return [...v];
  return v;
}

// ─── Boundary conversions ────────────────────────────────────────

/** JS value (e.g. from JSON.parse) → Python values; objects become dicts. */
export function fromJS(v) {
  if (v === undefined) return null;
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(fromJS);
  if (v instanceof PyDict || v instanceof PySet || v instanceof PyFloat) return v;
  const d = new PyDict();
  for (const k of Object.keys(v)) d.set(k, fromJS(v[k]));
  return d;
}

/** Python values → JSON-shaped JS values (dict → object; tuple and set → array). */
export function toJS(v) {
  if (v === undefined || v === null) return null;
  if (v instanceof PyFloat) return v.v;
  if (typeof v !== "object") return v;
  if (Array.isArray(v)) return Array.from(v, toJS);
  if (v instanceof PyDict) {
    const o = {};
    for (const [k, x] of v.entries()) o[typeof k === "string" ? k : pystr(k)] = toJS(x);
    return o;
  }
  if (v instanceof PySet || v instanceof Range || v instanceof Deque || v instanceof DictView) return [...v].map(toJS);
  return v;
}

// ─── More builtins ───────────────────────────────────────────────

/** str(x) called as a function: str() is "". */
export function strCall(...args) {
  return args.length ? pystr(args[0]) : "";
}
export function callable(v) {
  return typeof v === "function" || (v !== null && typeof v === "object" && typeof v.__call__ === "function");
}
export function id(v) {
  return objId(v);
}
export function hashOf(v) {
  // most hashes are 64-bit: give the exact value or nothing (the silicon modules never call hash())
  const h = pyhash(v);
  if (h > BigInt(Number.MAX_SAFE_INTEGER) || h < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new NotImplementedError(`hash() of ${repr(v)} is ${h}, beyond what a JS number holds exactly`);
  }
  return Number(h);
}
export function print(...args) {
  const [pos] = splitKw(args);
  process.stderr.write(pos.map(pystr).join(" ") + "\n");
  return null;
}
