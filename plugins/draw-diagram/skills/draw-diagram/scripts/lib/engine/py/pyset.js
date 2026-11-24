// CPython 3.14's set, ported for iteration order.
//
// A Python set iterates in hash-table slot order. For keys whose hash is fixed (ints, floats,
// bools, None, tuples of those) that order is the same on every run and often differs from
// insertion order: {3, 1, 2} iterates 1, 2, 3. Code that iterates such a set without sorting
// depends on it, so this file reproduces Objects/setobject.c: the table, linear probing with
// perturbation, the resize rules, and the paths of construction, merge, union, intersection
// and difference, each of which fills the table in its own order.
//
// Strings hash with SipHash-1-3 keyed by PYTHONHASHSEED. Here the key is the one PYTHONHASHSEED=0
// gives (all zeros), so a set of strings iterates as CPython run with PYTHONHASHSEED=0. Code that
// depends on that order gives seed-dependent results in CPython too; this port matches seed 0.

const P = (1n << 61n) - 1n; // _PyHASH_MODULUS
const BITS = 61n;
const U64 = (1n << 64n) - 1n;
const MINSIZE = 8;
const LINEAR_PROBES = 9;
const PERTURB_SHIFT = 5n;
const DUMMY = Symbol("dummy");
const HASH_NONE = 4238894112n;
const HASH_INF = 314159n;
const XXPRIME_1 = 11400714785074694791n;
const XXPRIME_2 = 14029467366897019727n;
const XXPRIME_5 = 2870177450012600261n;

const toSigned = (u) => (u >= 1n << 63n ? u - (1n << 64n) : u);
const toUnsigned = (s) => s & U64;
// masks stay below 2^31, so (i * 5 + 1 + perturb) & mask only needs perturb's low 32 bits
const low32 = (u) => Number(BigInt.asUintN(32, u));
function nextSlot(i, perturb, mask) {
  return (i * 5 + 1 + low32(perturb)) & mask;
}

function hashInt(n) {
  let h = n >= 0n ? n % P : -(-n % P);
  if (h === -1n) h = -2n;
  return h;
}

/** _Py_HashDouble. */
function hashDouble(v) {
  if (!Number.isFinite(v)) {
    if (Number.isNaN(v)) return 0n;
    return v > 0 ? HASH_INF : -HASH_INF;
  }
  if (Number.isInteger(v)) return hashInt(BigInt(v));
  // frexp: v = m * 2^e, 0.5 <= |m| < 1
  let e = 0;
  let m = v;
  if (m !== 0) {
    e = Math.floor(Math.log2(Math.abs(m))) + 1;
    m = m / 2 ** e;
    while (Math.abs(m) >= 1) {
      m /= 2;
      e += 1;
    }
    while (Math.abs(m) < 0.5) {
      m *= 2;
      e -= 1;
    }
  }
  let sign = 1n;
  if (m < 0) {
    sign = -1n;
    m = -m;
  }
  let x = 0n;
  while (m) {
    x = ((x << 28n) & P) | (x >> (BITS - 28n));
    m *= 268435456.0;
    e -= 28;
    const y = Math.trunc(m);
    m -= y;
    x += BigInt(y);
    if (x >= P) x -= P;
  }
  const eb = e >= 0 ? BigInt(e) % BITS : BITS - 1n - (BigInt(-1 - e) % BITS);
  x = ((x << eb) & P) | (x >> (BITS - eb));
  x = toUnsigned(x * sign);
  if (x === U64) x = U64 - 1n;
  return toSigned(x);
}

const rotl = (x, b) => ((x << b) | (x >> (64n - b))) & U64;

/** CPython's siphash13 (Python/pyhash.c) with k0 = k1 = 0, over bytes. */
function siphash13(bytes) {
  let v0 = 0x736f6d6570736575n;
  let v1 = 0x646f72616e646f6dn;
  let v2 = 0x6c7967656e657261n;
  let v3 = 0x7465646279746573n;
  const round = () => {
    v0 = (v0 + v1) & U64;
    v2 = (v2 + v3) & U64;
    v1 = rotl(v1, 13n) ^ v0;
    v3 = rotl(v3, 16n) ^ v2;
    v0 = rotl(v0, 32n);
    v2 = (v2 + v1) & U64;
    v0 = (v0 + v3) & U64;
    v1 = rotl(v1, 17n) ^ v2;
    v3 = rotl(v3, 21n) ^ v0;
    v2 = rotl(v2, 32n);
  };
  const n = bytes.length;
  let i = 0;
  for (; i + 8 <= n; i += 8) {
    let m = 0n;
    for (let j = 7; j >= 0; j--) m = (m << 8n) | BigInt(bytes[i + j]);
    v3 ^= m;
    round();
    v0 ^= m;
  }
  let t = BigInt(n & 0xff) << 56n;
  for (let j = n - i - 1; j >= 0; j--) t |= BigInt(bytes[i + j]) << BigInt(8 * j);
  v3 ^= t;
  round();
  v0 ^= t;
  v2 ^= 0xffn;
  round();
  round();
  round();
  return v0 ^ v1 ^ v2 ^ v3;
}

/** hash(str): the bytes are the string's storage, 1, 2 or 4 bytes per code point (PEP 393). */
function hashString(s) {
  if (s.length === 0) return 0n;
  const cps = [];
  let max = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    cps.push(c);
    if (c > max) max = c;
  }
  const kind = max <= 0xff ? 1 : max <= 0xffff ? 2 : 4;
  const bytes = new Uint8Array(cps.length * kind);
  for (let i = 0; i < cps.length; i++) for (let k = 0; k < kind; k++) bytes[i * kind + k] = (cps[i] >> (8 * k)) & 0xff;
  const h = toSigned(siphash13(bytes));
  return h === -1n ? -2n : h;
}

const objHashes = new WeakMap();
let nextObj = 1n;
// a tuple never changes once built, so its hash is computed once
const TUPLE_HASH = Symbol("tuple hash");
const strHashes = new Map();

function hashNumber(v) {
  // |v| < 2^53 < the modulus 2^61 - 1, so the hash of a safe integer is itself
  if (Number.isSafeInteger(v)) return v === -1 ? -2n : BigInt(v);
  return Number.isInteger(v) ? hashInt(BigInt(v)) : hashDouble(v);
}

/** hash(v) as a signed 64-bit BigInt. */
export function pyhash(v) {
  if (v === null || v === undefined) return HASH_NONE;
  switch (typeof v) {
    case "boolean":
      return v ? 1n : 0n;
    case "number":
      return hashNumber(v);
    case "string": {
      let h = strHashes.get(v);
      if (h === undefined) {
        h = hashString(v);
        if (strHashes.size < 1 << 20) strHashes.set(v, h);
      }
      return h;
    }
  }
  if (v.constructor && v.constructor.name === "PyFloat") return hashNumber(v.v);
  if (Array.isArray(v) && v.constructor.name === "Tuple") {
    const cached = v[TUPLE_HASH];
    if (cached !== undefined) return cached;
    const h = hashTuple(v);
    v[TUPLE_HASH] = h;
    return h;
  }
  return hashOther(v);
}

function hashTuple(v) {
  {
    let acc = XXPRIME_5;
    for (const item of v) {
      const lane = toUnsigned(pyhash(item));
      acc = (acc + lane * XXPRIME_2) & U64;
      acc = ((acc << 31n) | (acc >> 33n)) & U64;
      acc = (acc * XXPRIME_1) & U64;
    }
    acc = (acc + (BigInt(v.length) ^ (XXPRIME_5 ^ 3527539n))) & U64;
    if (acc === U64) acc = 1546275796n;
    return toSigned(acc);
  }
}

function hashOther(v) {
  if (v instanceof PySet && v.frozen) {
    // frozenset_hash (Objects/setobject.c); empty and dummy slots cancel out of the xor
    const shuffle = (h) => (((h ^ 89869747n) ^ (h << 16n)) * 3644798167n) & U64;
    let hash = 0n;
    for (const k of v) hash ^= shuffle(toUnsigned(pyhash(k)));
    hash ^= (BigInt(v.size + 1) * 1927868237n) & U64;
    hash ^= (hash >> 11n) ^ (hash >> 25n);
    hash = (hash * 69069n + 907133923n) & U64;
    if (hash === U64) hash = 590923713n;
    return toSigned(hash);
  }
  if (Array.isArray(v) || v instanceof PySet || (v && v.map instanceof Map)) {
    throw new TypeError(`unhashable type: '${Array.isArray(v) ? "list" : v instanceof PySet ? "set" : "dict"}'`);
  }
  if (!objHashes.has(v)) objHashes.set(v, nextObj++);
  return objHashes.get(v);
}

let eqFn = (a, b) => a === b;
/** The runtime installs Python equality here (avoids an import cycle). */
export function setEquality(fn) {
  eqFn = fn;
}

export class PySet {
  constructor(items = null, frozen = false) {
    this.frozen = frozen;
    this._init();
    if (items !== null && items !== undefined) this._updateLocal(items);
  }

  _init() {
    // bumped on every write; lib/engine/fast caches mirrors of a set against it
    this.mods = (this.mods ?? 0) + 1;
    this.mask = MINSIZE - 1;
    this.keys = new Array(MINSIZE);
    this.hashes = new Array(MINSIZE).fill(0n);
    this.fill = 0;
    this.used = 0;
    this.finger = 0;
  }

  get size() {
    return this.used;
  }

  // ─── table primitives ──────────────────────────────────────────

  _lookkey(key, hash) {
    let mask = this.mask;
    let i = low32(hash) & mask;
    let perturb = toUnsigned(hash);
    for (;;) {
      let probes = i + LINEAR_PROBES <= mask ? LINEAR_PROBES : 0;
      let j = i;
      do {
        const k = this.keys[j];
        if (k === undefined && this.hashes[j] === 0n) return j;
        if (k !== DUMMY && k !== undefined && this.hashes[j] === hash && (k === key || eqFn(k, key))) return j;
        j++;
      } while (probes--);
      perturb >>= PERTURB_SHIFT;
      i = nextSlot(i, perturb, mask);
    }
  }

  _insertClean(keys, hashes, mask, key, hash) {
    let perturb = toUnsigned(hash);
    let i = low32(hash) & mask;
    for (;;) {
      if (keys[i] === undefined) {
        keys[i] = key;
        hashes[i] = hash;
        return;
      }
      if (i + LINEAR_PROBES <= mask) {
        for (let j = 1; j <= LINEAR_PROBES; j++) {
          if (keys[i + j] === undefined) {
            keys[i + j] = key;
            hashes[i + j] = hash;
            return;
          }
        }
      }
      perturb >>= PERTURB_SHIFT;
      i = nextSlot(i, perturb, mask);
    }
  }

  _resize(minused) {
    let newsize = MINSIZE;
    while (newsize <= minused) newsize <<= 1;
    const oldKeys = this.keys;
    const oldHashes = this.hashes;
    if (newsize === MINSIZE && oldKeys.length === MINSIZE && this.fill === this.used) return;
    this.keys = new Array(newsize);
    this.hashes = new Array(newsize).fill(0n);
    this.mask = newsize - 1;
    if (this.fill !== this.used) this.fill = this.used;
    for (let i = 0; i < oldKeys.length; i++) {
      const k = oldKeys[i];
      if (k !== undefined && k !== DUMMY) this._insertClean(this.keys, this.hashes, this.mask, k, oldHashes[i]);
    }
  }

  _addEntry(key, hash) {
    for (;;) {
      const mask = this.mask;
      let i = low32(hash) & mask;
      let freeslot = -1;
      let perturb = toUnsigned(hash);
      for (;;) {
        let probes = i + LINEAR_PROBES <= mask ? LINEAR_PROBES : 0;
        let j = i;
        let found = -2;
        do {
          const k = this.keys[j];
          if (k === undefined && this.hashes[j] === 0n) {
            found = j;
            break;
          }
          if (this.hashes[j] === hash && k !== DUMMY) {
            if (k === key || eqFn(k, key)) return;
          } else if (k === DUMMY) {
            freeslot = j;
          }
          j++;
        } while (probes--);
        if (found >= 0) {
          if (freeslot < 0) {
            this.mods++;
            this.fill++;
            this.used++;
            this.keys[found] = key;
            this.hashes[found] = hash;
            if (this.fill * 5 < mask * 3) return;
            this._resize(this.used > 50000 ? this.used * 2 : this.used * 4);
            return;
          }
          this.mods++;
          this.used++;
          this.keys[freeslot] = key;
          this.hashes[freeslot] = hash;
          return;
        }
        perturb >>= PERTURB_SHIFT;
        i = nextSlot(i, perturb, mask);
      }
    }
  }

  _discardEntry(key, hash) {
    const j = this._lookkey(key, hash);
    if (this.keys[j] === undefined) return false;
    this.mods++;
    this.keys[j] = DUMMY;
    this.hashes[j] = -1n;
    this.used--;
    return true;
  }

  _merge(other) {
    if (other === this || other.used === 0) return;
    this.mods++;
    if ((this.fill + other.used) * 5 >= this.mask * 3) this._resize((this.used + other.used) * 2);
    if (this.fill === 0 && this.mask === other.mask && other.fill === other.used) {
      for (let i = 0; i <= other.mask; i++) {
        if (other.keys[i] !== undefined) {
          this.keys[i] = other.keys[i];
          this.hashes[i] = other.hashes[i];
        }
      }
      this.fill = other.fill;
      this.used = other.used;
      return;
    }
    if (this.fill === 0) {
      this.fill = other.used;
      this.used = other.used;
      for (let i = 0; i <= other.mask; i++) {
        const k = other.keys[i];
        if (k !== undefined && k !== DUMMY) this._insertClean(this.keys, this.hashes, this.mask, k, other.hashes[i]);
      }
      return;
    }
    for (let i = 0; i <= other.mask; i++) {
      const k = other.keys[i];
      if (k !== undefined && k !== DUMMY) this._addEntry(k, other.hashes[i]);
    }
  }

  _updateDict(d) {
    const n = d.size;
    if ((this.fill + n) * 5 >= this.mask * 3) this._resize((this.used + n) * 2);
    for (const k of d.keys()) this._addEntry(k, pyhash(k));
  }

  _updateLocal(other) {
    if (other instanceof PySet) return this._merge(other);
    // PyDict_CheckExact: only a plain dict, not defaultdict or Counter
    if (other && other.constructor && other.constructor.name === "PyDict") return this._updateDict(other);
    for (const k of iterOf(other)) this._addEntry(k, pyhash(k));
  }

  // ─── Python API ────────────────────────────────────────────────

  add(key) {
    this._addEntry(key, pyhash(key));
  }
  has(key) {
    const j = this._lookkey(key, pyhash(key));
    return this.keys[j] !== undefined;
  }
  /** discard; returns whether it was there */
  delete(key) {
    return this._discardEntry(key, pyhash(key));
  }
  *[Symbol.iterator]() {
    for (let i = 0; i <= this.mask; i++) {
      const k = this.keys[i];
      if (k !== undefined && k !== DUMMY) yield k;
    }
  }
  copy(frozen = this.frozen) {
    const s = new PySet(null, frozen);
    s._merge(this);
    return s;
  }
  clear() {
    this._init();
  }
  pop() {
    if (this.used === 0) return { empty: true };
    let i = this.finger & this.mask;
    while (this.keys[i] === undefined || this.keys[i] === DUMMY) {
      i++;
      if (i > this.mask) i = 0;
    }
    const key = this.keys[i];
    this.mods++;
    this.keys[i] = DUMMY;
    this.hashes[i] = -1n;
    this.used--;
    this.finger = i + 1;
    return { key };
  }
  update(...others) {
    for (const o of others) {
      if (o === this) continue;
      this._updateLocal(o);
    }
  }
  union(...others) {
    const r = this.copy();
    for (const o of others) {
      if (o === this) continue;
      r._updateLocal(o);
    }
    return r;
  }
  intersection(...others) {
    if (others.length === 0) return this.copy();
    let r = this;
    for (const o of others) r = intersect(r, o);
    return r === this ? this.copy() : r;
  }
  difference(...others) {
    if (others.length === 0) return this.copy();
    let r = difference1(this, others[0]);
    for (const o of others.slice(1)) r.difference_update(o);
    return r;
  }
  /** set_symmetric_difference_impl (3.14): set(other), then each key of self, in self's table order, discarded or added */
  symmetric_difference(other) {
    const result = new PySet(other, this.frozen);
    result.symmetric_difference_update(this);
    return result;
  }
  /** set_symmetric_difference_update: other's keys (as a set) discarded from self or added */
  symmetric_difference_update(other) {
    if (other === this) {
      this.clear();
      return;
    }
    const o = other instanceof PySet ? other : new PySet(other);
    for (let i = 0; i <= o.mask; i++) {
      const k = o.keys[i];
      if (k === undefined || k === DUMMY) continue;
      if (!this._discardEntry(k, o.hashes[i])) this._addEntry(k, o.hashes[i]);
    }
  }
  difference_update(...others) {
    for (const o of others) differenceUpdate(this, o);
  }
  intersection_update(...others) {
    let r = this;
    for (const o of others) r = intersect(r, o);
    if (r !== this) {
      this.mods++;
      this.keys = r.keys;
      this.hashes = r.hashes;
      this.mask = r.mask;
      this.fill = r.fill;
      this.used = r.used;
    }
  }
  issubset(other) {
    if (!(other instanceof PySet)) return intersect(this, other).size === this.size;
    if (this.size > other.size) return false;
    for (const k of this) if (!other.has(k)) return false;
    return true;
  }
}

function iterOf(o) {
  if (o === null || o === undefined) throw new TypeError("'NoneType' object is not iterable");
  if (typeof o === "string" || Array.isArray(o)) return o;
  if (o && o.map instanceof Map && typeof o.keys === "function") return o.keys();
  if (typeof o[Symbol.iterator] === "function") return o;
  throw new TypeError("object is not iterable");
}

/** set_intersection(so, other) */
function intersect(so, other) {
  if (other === so) return so.copy();
  const result = new PySet(null, so.frozen);
  if (other instanceof PySet) {
    let a = so;
    let b = other;
    if (b.size > a.size) [a, b] = [b, a];
    for (let i = 0; i <= b.mask; i++) {
      const k = b.keys[i];
      if (k === undefined || k === DUMMY) continue;
      const h = b.hashes[i];
      const j = a._lookkey(k, h);
      if (a.keys[j] !== undefined) result._addEntry(k, h);
    }
    return result;
  }
  for (const k of iterOf(other)) {
    const h = pyhash(k);
    const j = so._lookkey(k, h);
    if (so.keys[j] !== undefined) {
      result._addEntry(k, h);
      if (result.size >= so.size) break;
    }
  }
  return result;
}

/** set_difference(so, other) */
function difference1(so, other) {
  let otherSize;
  if (other instanceof PySet) otherSize = other.size;
  else if (other && other.constructor && other.constructor.name === "PyDict") otherSize = other.size;
  else {
    const r = so.copy();
    differenceUpdate(r, other);
    return r;
  }
  if (so.size >> 2 > otherSize) {
    const r = so.copy();
    differenceUpdate(r, other);
    return r;
  }
  const result = new PySet(null, so.frozen);
  for (let i = 0; i <= so.mask; i++) {
    const k = so.keys[i];
    if (k === undefined || k === DUMMY) continue;
    const h = so.hashes[i];
    const inOther = other instanceof PySet ? other.keys[other._lookkey(k, h)] !== undefined : other.has(k);
    if (!inOther) result._addEntry(k, h);
  }
  return result;
}

/** set_difference_update_internal(so, other) */
function differenceUpdate(so, other) {
  if (other === so) {
    so.clear();
    return;
  }
  if (other instanceof PySet) {
    let o = other;
    if (o.size >> 3 > so.size) o = intersect(so, o);
    for (let i = 0; i <= o.mask; i++) {
      const k = o.keys[i];
      if (k === undefined || k === DUMMY) continue;
      so._discardEntry(k, o.hashes[i]);
    }
  } else {
    for (const k of iterOf(other)) so._discardEntry(k, pyhash(k));
  }
  if (so.fill - so.used <= Math.floor(so.mask / 4)) return;
  so._resize(so.used > 50000 ? so.used * 2 : so.used * 4);
}
