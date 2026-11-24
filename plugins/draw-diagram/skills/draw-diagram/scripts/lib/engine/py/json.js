// Python's json: dumps() byte for byte as CPython prints, loads() keeping int vs float.

import { PyDict, PyFloat, Tuple, fl, nv, isIntLike, floatRepr, sorted, TypeError_, ValueError, splitKw, typeName, KW } from "./runtime.js";
import { PySet } from "./pyset.js";

const ESC = { '"': '\\"', "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" };

function encodeString(s, ensureAscii) {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ESC[ch]) out += ESC[ch];
    else if (c < 0x20) out += "\\u" + c.toString(16).padStart(4, "0");
    else if (ensureAscii && c > 0x7e) {
      if (c > 0xffff) {
        const v = c - 0x10000;
        out += "\\u" + (0xd800 | (v >> 10)).toString(16) + "\\u" + (0xdc00 | (v & 0x3ff)).toString(16);
      } else {
        out += "\\u" + c.toString(16).padStart(4, "0");
      }
    } else out += ch;
  }
  return out + '"';
}

function floatStr(x, allowNan) {
  if (Number.isNaN(x)) {
    if (!allowNan) throw new ValueError("Out of range float values are not JSON compliant: nan");
    return "NaN";
  }
  if (x === Infinity) return "Infinity";
  if (x === -Infinity) return "-Infinity";
  return floatRepr(x);
}

function keyStr(k) {
  if (typeof k === "string") return k;
  if (k === true) return "true";
  if (k === false) return "false";
  if (k === null || k === undefined) return "null";
  if (k instanceof PyFloat) return floatStr(k.v, true);
  if (typeof k === "number") return Number.isInteger(k) ? String(k) : floatStr(k, true);
  throw new TypeError_(`keys must be str, int, float, bool or None, not ${typeName(k)}`);
}

export function dumps(obj, ...rest) {
  const [, kw] = splitKw(rest);
  const ensureAscii = kw.ensure_ascii ?? true;
  const sortKeys = kw.sort_keys ?? false;
  const indent = kw.indent ?? null;
  const allowNan = kw.allow_nan ?? true;
  let [itemSep, keySep] = kw.separators ? [...kw.separators] : indent === null ? [", ", ": "] : [",", ": "];
  const ind = indent === null ? null : typeof indent === "string" ? indent : " ".repeat(nv(indent));
  const seen = new Set();
  const enc = (v, level) => {
    if (v === null || v === undefined) return "null";
    if (v === true) return "true";
    if (v === false) return "false";
    if (typeof v === "string") return encodeString(v, ensureAscii);
    if (v instanceof PyFloat) return floatStr(v.v, allowNan);
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : floatStr(v, allowNan);
    if (Array.isArray(v)) {
      if (!v.length) return "[]";
      if (seen.has(v)) throw new ValueError("Circular reference detected");
      seen.add(v);
      const parts = v.map((x) => enc(x, level + 1));
      seen.delete(v);
      return wrap("[", "]", parts, level);
    }
    if (v instanceof PyDict) {
      if (!v.size) return "{}";
      if (seen.has(v)) throw new ValueError("Circular reference detected");
      seen.add(v);
      let items = [...v.entries()];
      if (sortKeys) items = sorted(items.map(([k, x]) => [k, x]), KW({ key: (it) => it[0] }));
      const parts = items.map(([k, x]) => encodeString(keyStr(k), ensureAscii) + keySep + enc(x, level + 1));
      seen.delete(v);
      return wrap("{", "}", parts, level);
    }
    throw new TypeError_(`Object of type ${typeName(v)} is not JSON serializable`);
  };
  const wrap = (open, close, parts, level) => {
    if (ind === null) return open + parts.join(itemSep) + close;
    const inner = "\n" + ind.repeat(level + 1);
    return open + inner + parts.join(itemSep + inner) + "\n" + ind.repeat(level) + close;
  };
  return enc(obj, 0);
}

/** json.loads: objects become dicts (later duplicates overwrite in place), "2.0" stays a float. */
export function loads(s) {
  if (typeof s !== "string") s = new TextDecoder().decode(s);
  let i = 0;
  const ws = () => {
    while (i < s.length && " \t\n\r".includes(s[i])) i++;
  };
  const fail = (msg) => {
    throw new ValueError(`${msg}: line 1 column ${i + 1} (char ${i})`);
  };
  const value = () => {
    ws();
    const c = s[i];
    if (c === "{") {
      i++;
      const d = new PyDict();
      ws();
      if (s[i] === "}") {
        i++;
        return d;
      }
      for (;;) {
        ws();
        if (s[i] !== '"') fail("Expecting property name enclosed in double quotes");
        const k = string();
        ws();
        if (s[i] !== ":") fail("Expecting ':' delimiter");
        i++;
        d.set(k, value());
        ws();
        if (s[i] === ",") {
          i++;
          continue;
        }
        if (s[i] === "}") {
          i++;
          return d;
        }
        fail("Expecting ',' delimiter");
      }
    }
    if (c === "[") {
      i++;
      const a = [];
      ws();
      if (s[i] === "]") {
        i++;
        return a;
      }
      for (;;) {
        a.push(value());
        ws();
        if (s[i] === ",") {
          i++;
          continue;
        }
        if (s[i] === "]") {
          i++;
          return a;
        }
        fail("Expecting ',' delimiter");
      }
    }
    if (c === '"') return string();
    if (s.startsWith("true", i)) {
      i += 4;
      return true;
    }
    if (s.startsWith("false", i)) {
      i += 5;
      return false;
    }
    if (s.startsWith("null", i)) {
      i += 4;
      return null;
    }
    if (s.startsWith("NaN", i)) {
      i += 3;
      return NaN;
    }
    if (s.startsWith("Infinity", i)) {
      i += 8;
      return Infinity;
    }
    if (s.startsWith("-Infinity", i)) {
      i += 9;
      return -Infinity;
    }
    const m = /^-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(s.slice(i, i + 400));
    if (!m) fail("Expecting value");
    i += m[0].length;
    if (m[1] === undefined && m[2] === undefined) return Number(m[0]);
    return fl(Number(m[0]));
  };
  const string = () => {
    i++;
    let out = "";
    for (;;) {
      const j = s.indexOf('"', i);
      const k = s.indexOf("\\", i);
      if (j < 0) fail("Unterminated string starting at");
      if (k < 0 || j < k) {
        out += s.slice(i, j);
        i = j + 1;
        return out;
      }
      out += s.slice(i, k);
      const e = s[k + 1];
      i = k + 2;
      if (e === "u") {
        out += String.fromCharCode(parseInt(s.slice(i, i + 4), 16));
        i += 4;
      } else {
        out += { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" }[e] ?? fail("Invalid \\escape");
      }
    }
  };
  const v = value();
  ws();
  if (i !== s.length) fail("Extra data");
  return v;
}

export function load(stream) {
  return loads(stream.read());
}

export { PySet, Tuple, isIntLike };
