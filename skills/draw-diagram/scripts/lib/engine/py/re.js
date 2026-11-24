// Python's `re` module on top of JS RegExp.
//
// Patterns are translated once and cached. The translation keeps Python's meaning where the two
// engines differ:
//   \w \W \d \D \b \B   Unicode-aware for str patterns in Python; ASCII in JS
//   $                   end, or before a final newline (without MULTILINE)
//   \A \Z               string anchors
//   (?P<n>...) (?P=n)   named groups
//   identity escapes    Python accepts \- \# \  \& \~ ...; JS's `u` mode only syntax characters
//   { }                 a brace that isn't a quantifier is a literal
// Every pattern gets the `u` flag (code-point matching, as Python) and `d` (group offsets).
// Iteration follows _sre: after an empty match the next match must advance.

import { PyDict, T, ValueError, TypeError_, Kw, iter, pystr, typeName, nv } from "./runtime.js";

export const I = 2;
export const IGNORECASE = 2;
export const M = 8;
export const MULTILINE = 8;
export const S = 16;
export const DOTALL = 16;
export const X = 64;
export const VERBOSE = 64;
export const A = 256;
export const ASCII = 256;
export const U = 32;
export const UNICODE = 32;
export const NOFLAG = 0;

export class error extends ValueError {}

const WORD = "\\p{L}\\p{N}\\p{Mn}\\p{Mc}\\p{Pc}";
const SYNTAX = new Set("^$\\.*+?()[]{}|/".split(""));

export function translate(pattern, flags = 0) {
  const ascii = (flags & ASCII) !== 0;
  const multiline = (flags & MULTILINE) !== 0;
  const verbose = (flags & VERBOSE) !== 0;
  const w = ascii ? "A-Za-z0-9_" : WORD;
  const d = ascii ? "0-9" : "\\p{Nd}";
  const wordB = `(?:(?<=[${w}])(?![${w}])|(?<![${w}])(?=[${w}]))`;
  const nonWordB = `(?:(?<=[${w}])(?=[${w}])|(?<![${w}])(?![${w}]))`;
  let out = "";
  let i = 0;
  let inClass = false;
  const src = pattern;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (verbose && !inClass) {
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (c === "#") {
        while (i < n && src[i] !== "\n") i++;
        continue;
      }
    }
    if (c === "\\") {
      const e = src[i + 1];
      i += 2;
      if (e === undefined) throw new error("bad escape (end of pattern)");
      switch (e) {
        case "w":
          out += inClass ? w : `[${w}]`;
          continue;
        case "W":
          if (inClass) {
            out += ascii ? "\\W" : "\\P{L}";
            continue;
          }
          out += `[^${w}]`;
          continue;
        case "d":
          out += inClass ? d : `[${d}]`;
          continue;
        case "D":
          out += inClass ? (ascii ? "\\D" : "\\P{Nd}") : `[^${d}]`;
          continue;
        case "s":
        case "S":
          out += "\\" + e;
          continue;
        case "b":
          out += inClass ? "\\x08" : wordB;
          continue;
        case "B":
          out += nonWordB;
          continue;
        case "A":
          out += "(?<![\\s\\S])";
          continue;
        case "Z":
          out += "(?![\\s\\S])";
          continue;
        case "n":
        case "t":
        case "r":
        case "f":
        case "v":
          out += "\\" + e;
          continue;
        case "a":
          out += "\\x07";
          continue;
        case "x":
          out += "\\x" + src.slice(i, i + 2);
          i += 2;
          continue;
        case "u":
          out += "\\u" + src.slice(i, i + 4);
          i += 4;
          continue;
        case "U":
          out += "\\u{" + (src.slice(i, i + 8).replace(/^0+/, "") || "0") + "}";
          i += 8;
          continue;
        case "N": {
          const close = src.indexOf("}", i);
          throw new error(`\\N{${src.slice(i + 1, close)}} is not supported`);
        }
        default:
          if (/[1-9]/.test(e)) {
            let k = e;
            while (/[0-9]/.test(src[i] ?? "")) k += src[i++];
            out += "\\" + k;
            continue;
          }
          if (e === "0") {
            let k = "";
            while (k.length < 2 && /[0-7]/.test(src[i] ?? "")) k += src[i++];
            out += "\\x" + parseInt(k || "0", 8).toString(16).padStart(2, "0");
            continue;
          }
          if (/[A-Za-z]/.test(e)) throw new error(`bad escape \\${e}`);
          if (SYNTAX.has(e) || (inClass && e === "-")) out += "\\" + e;
          else if (e === "\n") out += "\\n";
          else if (e === "\t") out += "\\t";
          else out += e;
          continue;
      }
    }
    if (inClass) {
      if (c === "]") {
        inClass = false;
        out += "]";
      } else if (c === "[") {
        out += "\\[";
      } else {
        out += c;
      }
      i++;
      continue;
    }
    if (c === "[") {
      inClass = true;
      out += "[";
      i++;
      if (src[i] === "^") {
        out += "^";
        i++;
      }
      if (src[i] === "]") {
        out += "\\]";
        i++;
      }
      continue;
    }
    if (c === "(" && src[i + 1] === "?") {
      if (src[i + 2] === "P" && src[i + 3] === "<") {
        out += "(?<";
        i += 4;
        continue;
      }
      if (src[i + 2] === "P" && src[i + 3] === "=") {
        const close = src.indexOf(")", i);
        out += "\\k<" + src.slice(i + 4, close) + ">";
        i = close + 1;
        continue;
      }
      if (src[i + 2] === "#") {
        i = src.indexOf(")", i) + 1;
        continue;
      }
      out += "(?";
      i += 2;
      continue;
    }
    if (c === "$") {
      out += multiline ? "(?=\\n|(?![\\s\\S]))" : "(?=\\n?(?![\\s\\S]))";
      i++;
      continue;
    }
    if (c === "{") {
      const m = /^\{(\d*)(,?)(\d*)\}/.exec(src.slice(i));
      if (m && (m[1] !== "" || (m[2] && m[3] !== ""))) {
        out += m[1] === "" ? `{0,${m[3]}}` : m[0];
        i += m[0].length;
        continue;
      }
      out += "\\{";
      i++;
      continue;
    }
    if (c === "}") {
      out += "\\}";
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Leading inline flags such as (?i) or (?is), which Python allows at the start. */
function inlineFlags(pattern) {
  const m = /^\(\?([aiLmsux]+)\)/.exec(pattern);
  if (!m) return [pattern, 0];
  let f = 0;
  for (const ch of m[1]) f |= { a: ASCII, i: IGNORECASE, m: MULTILINE, s: DOTALL, u: UNICODE, x: VERBOSE, L: 0 }[ch];
  return [pattern.slice(m[0].length), f];
}

const cpLen = (s, from, to) => (/[\ud800-\udfff]/.test(s) ? [...s.slice(from, to)].length : to - from);
function cpToUnit(s, cp) {
  if (!cp || !/[\ud800-\udfff]/.test(s)) return cp;
  let unit = 0;
  for (let k = 0; k < cp && unit < s.length; k++) unit += s.codePointAt(unit) > 0xffff ? 2 : 1;
  return unit;
}
function advanceOne(s, unit) {
  return unit < s.length && s.codePointAt(unit) > 0xffff ? unit + 2 : unit + 1;
}

export class Pattern {
  constructor(pattern, flags = 0) {
    if (typeof pattern !== "string") throw new TypeError_(`first argument must be string or compiled pattern, not ${typeName(pattern)}`);
    this.pattern = pattern;
    const [body, inl] = inlineFlags(pattern);
    flags |= inl;
    this.flags = flags | UNICODE;
    let js = "ud";
    if (flags & IGNORECASE) js += "i";
    if (flags & MULTILINE) js += "m";
    if (flags & DOTALL) js += "s";
    this.source = translate(body, flags);
    this.jsflags = js;
    this.re = new RegExp(this.source, js + "g");
    this.sticky = new RegExp(this.source, js + "y");
    this.groupindex = new PyDict();
    this.groups = new RegExp(this.source + "|", js).exec("").length - 1;
    // named-group numbers, from the JS regexp itself
    const probe = new RegExp(this.source + "|", js).exec("");
    if (probe.groups) {
      const names = Object.keys(probe.groups);
      // map each name to its group number by position in the source
      let gi = 0;
      const order = [];
      for (let k = 0; k < this.source.length; k++) {
        if (this.source[k] === "\\") {
          k++;
          continue;
        }
        if (this.source[k] === "[") {
          // skip classes
          k++;
          while (k < this.source.length && this.source[k] !== "]") {
            if (this.source[k] === "\\") k++;
            k++;
          }
          continue;
        }
        if (this.source[k] === "(") {
          if (this.source[k + 1] !== "?") gi++;
          else if (this.source[k + 2] === "<" && this.source[k + 3] !== "=" && this.source[k + 3] !== "!") {
            gi++;
            order.push([this.source.slice(k + 3, this.source.indexOf(">", k)), gi]);
          }
        }
      }
      for (const [name, idx] of order) if (names.includes(name)) this.groupindex.set(name, idx);
    }
  }

  /** One match at or after `unit`; `mustAdvance` refuses an empty match at `unit`. */
  _find(s, unit, end, anchored, mustAdvance = false) {
    const re = anchored ? this.sticky : this.re;
    const hay = end === null ? s : s.slice(0, end);
    re.lastIndex = unit;
    let m = re.exec(hay);
    if (m && mustAdvance && m[0] === "" && m.index === unit) {
      if (anchored) return null;
      const next = advanceOne(hay, unit);
      if (next > hay.length) return null;
      re.lastIndex = next;
      m = re.exec(hay);
    }
    return m;
  }

  _match(s, pos, endpos, anchored, full) {
    checkStr(s);
    const unit = cpToUnit(s, nv(pos ?? 0));
    const end = endpos === null || endpos === undefined ? null : cpToUnit(s, nv(endpos));
    let m = this._find(s, unit, end, anchored);
    if (m && full) {
      const stop = end ?? s.length;
      if (m.index + m[0].length !== stop) {
        const re = new RegExp(`(?:${this.source})(?![\\s\\S])`, this.jsflags + "y");
        re.lastIndex = unit;
        m = re.exec(end === null ? s : s.slice(0, end));
      }
    }
    return m ? new Match(this, s, m) : null;
  }
  search(string, pos = 0, endpos = null) {
    return this._match(string, pos, endpos, false, false);
  }
  match(string, pos = 0, endpos = null) {
    return this._match(string, pos, endpos, true, false);
  }
  fullmatch(string, pos = 0, endpos = null) {
    return this._match(string, pos, endpos, true, true);
  }
  *finditer(string, pos = 0, endpos = null) {
    checkStr(string);
    let unit = cpToUnit(string, nv(pos ?? 0));
    const end = endpos === null || endpos === undefined ? null : cpToUnit(string, nv(endpos));
    let mustAdvance = false;
    for (;;) {
      const m = this._find(string, unit, end, false, mustAdvance);
      if (!m) return;
      yield new Match(this, string, m);
      const e = m.index + m[0].length;
      mustAdvance = m[0] === "";
      unit = e;
      if (unit > (end ?? string.length)) return;
    }
  }
  findall(string, pos = 0, endpos = null) {
    const out = [];
    for (const m of this.finditer(string, pos, endpos)) {
      if (this.groups === 0) out.push(m.group(0));
      else if (this.groups === 1) out.push(m.group(1) ?? "");
      else out.push(m.groups(""));
    }
    return out;
  }
  sub(repl, string, count = 0) {
    return this.subn(repl, string, count)[0];
  }
  subn(repl, string, count = 0) {
    checkStr(string);
    count = nv(count);
    let out = "";
    let last = 0;
    let n = 0;
    for (const m of this.finditer(string)) {
      if (count > 0 && n >= count) break;
      const [a, b] = [m.m.index, m.m.index + m.m[0].length];
      out += string.slice(last, a);
      out += typeof repl === "function" ? pystr(repl(m)) : expandTemplate(repl, m);
      last = b;
      n++;
    }
    return T(out + string.slice(last), n);
  }
  split(string, maxsplit = 0) {
    checkStr(string);
    maxsplit = nv(maxsplit);
    const out = [];
    let last = 0;
    let n = 0;
    for (const m of this.finditer(string)) {
      if (maxsplit > 0 && n >= maxsplit) break;
      out.push(string.slice(last, m.m.index));
      for (let g = 1; g <= this.groups; g++) out.push(m.group(g));
      last = m.m.index + m.m[0].length;
      n++;
    }
    out.push(string.slice(last));
    return out;
  }
  __repr__() {
    return `re.compile(${JSON.stringify(this.pattern)})`;
  }
}

function checkStr(s) {
  if (typeof s !== "string") throw new TypeError_(`expected string or bytes-like object, got '${typeName(s)}'`);
  return s;
}

function expandTemplate(tpl, m) {
  if (typeof tpl !== "string") throw new TypeError_("expected str instance");
  if (!tpl.includes("\\")) return tpl;
  let out = "";
  for (let i = 0; i < tpl.length; i++) {
    const c = tpl[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const e = tpl[++i];
    if (e === "g") {
      const close = tpl.indexOf(">", i);
      const name = tpl.slice(i + 2, close);
      out += m.group(/^\d+$/.test(name) ? Number(name) : name) ?? "";
      i = close;
    } else if (/[0-9]/.test(e)) {
      let k = e;
      if (/[0-9]/.test(tpl[i + 1] ?? "")) k += tpl[++i];
      out += m.group(Number(k)) ?? "";
    } else if (e === "n") out += "\n";
    else if (e === "t") out += "\t";
    else if (e === "r") out += "\r";
    else if (e === "f") out += "\f";
    else if (e === "v") out += "\v";
    else if (e === "a") out += "\x07";
    else if (e === "\\") out += "\\";
    else if (/[A-Za-z]/.test(e)) throw new error(`bad escape \\${e}`);
    else out += "\\" + e;
  }
  return out;
}

export class Match {
  constructor(pattern, string, m) {
    this.re = pattern;
    this.string = string;
    this.m = m;
    this.lastindex = null;
    this.lastgroup = null;
    // lastindex: the last group that matched, by closing position
    let bestEnd = -1;
    for (let g = 1; g <= pattern.groups; g++) {
      const span = m.indices[g];
      if (span && span[1] >= bestEnd) {
        bestEnd = span[1];
        this.lastindex = g;
      }
    }
    if (this.lastindex !== null) {
      for (const [name, idx] of pattern.groupindex.entries()) if (idx === this.lastindex) this.lastgroup = name;
    }
  }
  __bool__() {
    return true;
  }
  _idx(g) {
    if (typeof g === "string") {
      const idx = this.re.groupindex.get(g, null);
      if (idx === null) throw new IndexError_("no such group");
      return idx;
    }
    g = nv(g);
    if (g < 0 || g > this.re.groups) throw new IndexError_("no such group");
    return g;
  }
  group(...gs) {
    if (gs.length === 0) gs = [0];
    const vals = gs.map((g) => {
      const v = this.m[this._idx(g)];
      return v === undefined ? null : v;
    });
    return vals.length === 1 ? vals[0] : T(...vals);
  }
  groups(dflt = null) {
    const out = [];
    for (let k = 1; k <= this.re.groups; k++) out.push(this.m[k] === undefined ? dflt : this.m[k]);
    return T(...out);
  }
  groupdict(dflt = null) {
    const d = new PyDict();
    for (const [name, idx] of this.re.groupindex.entries()) d.set(name, this.m[idx] === undefined ? dflt : this.m[idx]);
    return d;
  }
  start(g = 0) {
    const span = this.m.indices[this._idx(g)];
    return span ? cpLen(this.string, 0, span[0]) : -1;
  }
  end(g = 0) {
    const span = this.m.indices[this._idx(g)];
    return span ? cpLen(this.string, 0, span[1]) : -1;
  }
  span(g = 0) {
    return T(this.start(g), this.end(g));
  }
  __getitem__(g) {
    return this.group(g);
  }
  expand(tpl) {
    return expandTemplate(tpl, this);
  }
}

class IndexError_ extends Error {}

const cache = new Map();
function pat(p, flags) {
  if (p instanceof Pattern) return p;
  const key = flags + "\u0000" + p;
  let c = cache.get(key);
  if (!c) {
    c = new Pattern(p, flags);
    cache.set(key, c);
  }
  return c;
}

function kwArgs(args, names) {
  const last = args[args.length - 1];
  const pos = last instanceof Kw ? args.slice(0, -1) : args;
  const kw = last instanceof Kw ? last.kw : {};
  return names.map((n, i) => (kw[n] !== undefined ? kw[n] : pos[i]));
}

export function compile(...args) {
  const [p, flags] = kwArgs(args, ["pattern", "flags"]);
  return pat(p, nv(flags ?? 0));
}
export function search(...args) {
  const [p, s, flags] = kwArgs(args, ["pattern", "string", "flags"]);
  return pat(p, nv(flags ?? 0)).search(s);
}
export function match(...args) {
  const [p, s, flags] = kwArgs(args, ["pattern", "string", "flags"]);
  return pat(p, nv(flags ?? 0)).match(s);
}
export function fullmatch(...args) {
  const [p, s, flags] = kwArgs(args, ["pattern", "string", "flags"]);
  return pat(p, nv(flags ?? 0)).fullmatch(s);
}
export function findall(...args) {
  const [p, s, flags] = kwArgs(args, ["pattern", "string", "flags"]);
  return pat(p, nv(flags ?? 0)).findall(s);
}
export function finditer(...args) {
  const [p, s, flags] = kwArgs(args, ["pattern", "string", "flags"]);
  return pat(p, nv(flags ?? 0)).finditer(s);
}
export function sub(...args) {
  const [p, repl, s, count, flags] = kwArgs(args, ["pattern", "repl", "string", "count", "flags"]);
  return pat(p, nv(flags ?? 0)).sub(repl, s, count ?? 0);
}
export function subn(...args) {
  const [p, repl, s, count, flags] = kwArgs(args, ["pattern", "repl", "string", "count", "flags"]);
  return pat(p, nv(flags ?? 0)).subn(repl, s, count ?? 0);
}
export function split(...args) {
  const [p, s, maxsplit, flags] = kwArgs(args, ["pattern", "string", "maxsplit", "flags"]);
  return pat(p, nv(flags ?? 0)).split(s, maxsplit ?? 0);
}

// re.escape: Python 3.7+ escapes only special characters
const SPECIAL = new Set("()[]{}?*+-|^$\\.&~# \t\n\r\v\f".split(""));
export function escape(s) {
  let out = "";
  for (const ch of s) out += SPECIAL.has(ch) ? "\\" + ch : ch;
  return out;
}

export { iter };
