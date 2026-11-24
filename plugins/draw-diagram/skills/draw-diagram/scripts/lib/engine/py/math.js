// Python's math module. hypot() and dist() port CPython's vector_norm, which is more exact
// than JS's Math.hypot and can differ from it in the last bit.

import { fl, nv, isIntLike, ValueError, TypeError_, iter, typeName } from "./runtime.js";

export const pi = Math.PI;
export const e = Math.E;
export const tau = 2 * Math.PI;
export const inf = Infinity;
export const nan = NaN;

function num(x) {
  if (typeof x === "number" || typeof x === "boolean" || (x && x.constructor && x.constructor.name === "PyFloat")) return nv(x);
  throw new TypeError_(`must be real number, not ${typeName(x)}`);
}

export function ceil(x) {
  if (isIntLike(x)) return nv(x);
  const v = num(x);
  if (!Number.isFinite(v)) throw new ValueError(Number.isNaN(v) ? "cannot convert float NaN to integer" : "cannot convert float infinity to integer");
  return Math.ceil(v) || 0;
}
export function floor(x) {
  if (isIntLike(x)) return nv(x);
  const v = num(x);
  if (!Number.isFinite(v)) throw new ValueError(Number.isNaN(v) ? "cannot convert float NaN to integer" : "cannot convert float infinity to integer");
  return Math.floor(v) || 0;
}
export function trunc(x) {
  return Math.trunc(num(x)) || 0;
}
export function sqrt(x) {
  const v = num(x);
  if (v < 0) throw new ValueError("expected a nonnegative input, got " + v);
  return fl(Math.sqrt(v));
}
export function sin(x) {
  return fl(Math.sin(num(x)));
}
export function cos(x) {
  return fl(Math.cos(num(x)));
}
export function tan(x) {
  return fl(Math.tan(num(x)));
}
export function atan2(y, x) {
  return fl(Math.atan2(num(y), num(x)));
}
export function atan(x) {
  return fl(Math.atan(num(x)));
}
export function exp(x) {
  return fl(Math.exp(num(x)));
}
export function log(x, base) {
  const v = num(x);
  if (v <= 0) throw new ValueError("expected a positive input");
  return fl(base === undefined ? Math.log(v) : Math.log(v) / Math.log(num(base)));
}
export function log2(x) {
  return fl(Math.log2(num(x)));
}
export function log10(x) {
  return fl(Math.log10(num(x)));
}
export function fabs(x) {
  return fl(Math.abs(num(x)));
}
export function isfinite(x) {
  return Number.isFinite(num(x));
}
export function isinf(x) {
  const v = num(x);
  return v === Infinity || v === -Infinity;
}
export function isnan(x) {
  return Number.isNaN(num(x));
}
export function copysign(x, y) {
  const a = Math.abs(num(x));
  const b = num(y);
  return fl(b < 0 || Object.is(b, -0) ? -a : a);
}
export function radians(x) {
  return fl((num(x) * Math.PI) / 180);
}
export function degrees(x) {
  return fl((num(x) * 180) / Math.PI);
}
export function isclose(a, b, ...rest) {
  const kw = rest.length && rest[rest.length - 1]?.kw ? rest[rest.length - 1].kw : {};
  const rel = kw.rel_tol === undefined ? 1e-9 : num(kw.rel_tol);
  const abs = kw.abs_tol === undefined ? 0 : num(kw.abs_tol);
  const x = num(a);
  const y = num(b);
  if (x === y) return true;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const d = Math.abs(y - x);
  return d <= Math.abs(rel * y) || d <= Math.abs(rel * x) || d <= abs;
}
export function prod(it) {
  let p = 1;
  let isF = false;
  for (const x of iter(it)) {
    if (!isIntLike(x)) isF = true;
    p *= num(x);
  }
  return isF ? fl(p) : p;
}
export function fsum(it) {
  // Shewchuk's exact partials, as math.fsum
  const partials = [];
  for (const v of iter(it)) {
    let x = num(v);
    let i = 0;
    for (let y of partials) {
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo) partials[i++] = lo;
      x = hi;
    }
    partials.length = i;
    partials.push(x);
  }
  let hi = 0;
  if (partials.length) {
    let n = partials.length - 1;
    hi = partials[n];
    let lo = 0;
    while (n > 0) {
      const x = hi;
      const y = partials[--n];
      hi = x + y;
      const yr = hi - x;
      lo = y - yr;
      if (lo) break;
    }
    if (n > 0 && ((lo < 0 && partials[n - 1] < 0) || (lo > 0 && partials[n - 1] > 0))) {
      const y = lo * 2;
      const x = hi + y;
      const yr = x - hi;
      if (y === yr) hi = x;
    }
  }
  return fl(hi);
}

// ─── vector_norm (Modules/mathmodule.c) ──────────────────────────

const SPLIT = 134217729; // 2^27 + 1
function split(x) {
  const t = SPLIT * x;
  const hi = t - (t - x);
  return [hi, x - hi];
}
/** Exact product as hi + lo (Dekker's mul12, error free like CPython's fma version). */
function mulExact(x, y) {
  const [xh, xl] = split(x);
  const [yh, yl] = split(y);
  const p = xh * yh;
  const q = xh * yl + xl * yh;
  const z = p + q;
  const zz = p - z + q + xl * yl;
  return [z, zz];
}
function fastSum(a, b) {
  const x = a + b;
  return [x, a - x + b];
}
function frexpE(x) {
  if (x === 0 || !Number.isFinite(x)) return 0;
  let e = Math.floor(Math.log2(Math.abs(x))) + 1;
  let m = Math.abs(x) / 2 ** e;
  while (m >= 1) {
    m /= 2;
    e++;
  }
  while (m < 0.5) {
    m *= 2;
    e--;
  }
  return e;
}
const DBL_MIN = 2.2250738585072014e-308;

function vectorNorm(vec, max, foundNan) {
  if (max === Infinity) return max;
  if (foundNan) return NaN;
  if (max === 0 || vec.length <= 1) return max;
  const maxE = frexpE(max);
  if (maxE < -1023) return DBL_MIN * vectorNorm(vec.map((v) => v / DBL_MIN), max / DBL_MIN, foundNan);
  const scale = 2 ** -maxE;
  let csum = 1.0;
  let frac1 = 0.0;
  let frac2 = 0.0;
  for (let x of vec) {
    x *= scale;
    const [prHi, prLo] = mulExact(x, x);
    const [smHi, smLo] = fastSum(csum, prHi);
    csum = smHi;
    frac1 += prLo;
    frac2 += smLo;
  }
  let h = Math.sqrt(csum - 1.0 + (frac1 + frac2));
  const [prHi, prLo] = mulExact(-h, h);
  const [smHi, smLo] = fastSum(csum, prHi);
  csum = smHi;
  frac1 += prLo;
  frac2 += smLo;
  const x = csum - 1.0 + (frac1 + frac2);
  h += x / (2.0 * h);
  return h / scale;
}

export function hypot(...coords) {
  let max = 0;
  let foundNan = false;
  const vec = coords.map((c) => {
    const x = Math.abs(num(c));
    foundNan ||= Number.isNaN(x);
    if (x > max) max = x;
    return x;
  });
  return fl(vectorNorm(vec, max, foundNan));
}

export function dist(p, q) {
  const a = [...iter(p)];
  const b = [...iter(q)];
  if (a.length !== b.length) throw new ValueError("both points must have the same number of dimensions");
  let max = 0;
  let foundNan = false;
  const vec = a.map((px, i) => {
    const x = Math.abs(num(px) - num(b[i]));
    foundNan ||= Number.isNaN(x);
    if (x > max) max = x;
    return x;
  });
  return fl(vectorNorm(vec, max, foundNan));
}
