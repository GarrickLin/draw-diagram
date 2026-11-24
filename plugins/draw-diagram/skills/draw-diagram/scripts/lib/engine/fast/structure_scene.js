// Hand-written fast paths for structure_scene.build.
//
// The transpiled astar spends its time hashing tuples and going through Python operators: one
// layout makes ~50 searches over a 450×365 grid with a 65k-point obstacle set. This version
// does the same search on plain numbers. It is a drop-in for the generic function the
// transpiler generates and keeps every observable result:
// - same heap algorithm and the same (f, cost, (x, y, d)) ordering, so ties pop in the same
//   order and the same path comes out;
// - the Python sets and dicts it reads are mirrored into number-keyed JS structures, cached
//   against their modification counters;
// - anything outside the shapes it was written for (non-integer coordinates, a start that
//   isn't a tuple, a set that isn't a set) goes to the generic function.
// tests/port/fast.test.js runs both on random grids and compares the paths.

import * as py from "../py/runtime.js";

const OFF = 2 ** 20;
const W = 2 ** 21;
const LIMIT = OFF - 64;

/** An int-valued coordinate as a JS integer, or undefined if Python wouldn't treat it as one. */
function intOf(v) {
  if (typeof v === "number") return Number.isSafeInteger(v) && Math.abs(v) < LIMIT ? v : undefined;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof py.PyFloat) return intOf(v.v);
  return undefined;
}

/** A Python number as a JS number (for comparisons), or undefined. */
function numOf(v) {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof py.PyFloat) return v.v;
  return undefined;
}

const pointKey = (x, y) => (x + OFF) * W + (y + OFF);
/** a unit segment from (x, y) to the right (dir 0) or down (dir 1) */
const segKey = (x, y, dir) => pointKey(x, y) * 2 + dir;

/** (x, y) with int-valued coordinates, as [x, y]; undefined otherwise. */
function intPoint(t) {
  if (!(t instanceof py.Tuple) || t.length !== 2) return undefined;
  const x = intOf(t[0]);
  const y = intOf(t[1]);
  return x === undefined || y === undefined ? undefined : [x, y];
}

/** The segKey of a stored ((x0, y0), (x1, y1)) if a sorted unit-segment query can equal it. */
function storedSegKey(k) {
  if (!(k instanceof py.Tuple) || k.length !== 2) return undefined;
  const a = intPoint(k[0]);
  const b = intPoint(k[1]);
  if (!a || !b) return undefined;
  if (a[1] === b[1] && b[0] === a[0] + 1) return segKey(a[0], a[1], 0);
  if (a[0] === b[0] && b[1] === a[1] + 1) return segKey(a[0], a[1], 1);
  return undefined; // not a sorted unit segment: no query can match it
}

const mirrors = new WeakMap();
function mirror(obj, build) {
  const m = mirrors.get(obj);
  if (m && m.mods === obj.mods && m.build === build) return m.data;
  const data = build(obj);
  mirrors.set(obj, { mods: obj.mods, build, data });
  return data;
}

function pointSet(set) {
  const out = new Set();
  for (const k of set) {
    const p = intPoint(k);
    if (p) out.add(pointKey(p[0], p[1]));
  }
  return out;
}

function segmentSet(set) {
  const out = new Set();
  for (const k of set) {
    const s = storedSegKey(k);
    if (s !== undefined) out.add(s);
  }
  return out;
}

function segmentValues(dict) {
  const out = new Map();
  for (const [k, v] of dict.map.values()) {
    const s = storedSegKey(k);
    if (s !== undefined) out.set(s, v);
  }
  return out;
}

// heapq on [f, cost, x, y, d] rows compared as the tuple (f, cost, (x, y, d))
function rowLt(a, b) {
  for (let i = 0; i < 5; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}
function siftdown(heap, startpos, pos) {
  const newitem = heap[pos];
  while (pos > startpos) {
    const parentpos = (pos - 1) >> 1;
    const parent = heap[parentpos];
    if (rowLt(newitem, parent)) {
      heap[pos] = parent;
      pos = parentpos;
      continue;
    }
    break;
  }
  heap[pos] = newitem;
}
function siftup(heap, pos) {
  const endpos = heap.length;
  const startpos = pos;
  const newitem = heap[pos];
  let childpos = 2 * pos + 1;
  while (childpos < endpos) {
    const rightpos = childpos + 1;
    if (rightpos < endpos && !rowLt(heap[childpos], heap[rightpos])) childpos = rightpos;
    heap[pos] = heap[childpos];
    pos = childpos;
    childpos = 2 * pos + 1;
  }
  heap[pos] = newitem;
  siftdown(heap, startpos, pos);
}
function heappush(heap, item) {
  heap.push(item);
  siftdown(heap, 0, heap.length - 1);
}
function heappop(heap) {
  const last = heap.pop();
  if (heap.length) {
    const ret = heap[0];
    heap[0] = last;
    siftup(heap, 0);
    return ret;
  }
  return last;
}

const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const OFFSETS = [-4, -3, -2, -1, 1, 2, 3, 4];
const stateKey = (x, y, d) => pointKey(x, y) * 5 + (d + 1);

/**
 * astar(start, goal, bounds=None, line_color=None) from structure_scene.build.
 * env() returns the closure's [maxx, maxy, blocked, occupied, segment_colors] at call time.
 */
export function astar(generic, env) {
  // DRAW_DIAGRAM_FAST=0 runs the generic transpiled function (tests compare the two)
  if (process.env.DRAW_DIAGRAM_FAST === "0") return generic;
  return function astar(start, goal, bounds = null, line_color = null) {
    const [maxxV, maxyV, blocked, occupied, segmentColors] = env();
    // path points are start plus unit steps: a float or bool start would give floats or ints
    // the generic version keeps, so only plain integers take this path
    const s = start instanceof py.Tuple && typeof start[0] === "number" && typeof start[1] === "number" ? intPoint(start) : undefined;
    const g = intPoint(goal);
    const maxx = numOf(maxxV);
    const maxy = numOf(maxyV);
    let b = null;
    if (py.bool(bounds)) {
      if (Array.isArray(bounds) && bounds.length >= 4) b = bounds.slice(0, 4).map(numOf);
      if (!b || b.some((v) => v === undefined)) b = undefined;
    }
    if (
      !s ||
      !g ||
      maxx === undefined ||
      maxy === undefined ||
      Math.abs(maxx) >= LIMIT ||
      Math.abs(maxy) >= LIMIT ||
      b === undefined ||
      !(blocked instanceof py.PySet) ||
      !(occupied instanceof py.PySet) ||
      !(segmentColors instanceof py.PyDict)
    ) {
      return generic(start, goal, bounds, line_color);
    }
    const blockedKeys = mirror(blocked, pointSet);
    const occupiedKeys = mirror(occupied, segmentSet);
    const colors = py.bool(line_color) ? mirror(segmentColors, segmentValues) : null;
    const [sx, sy] = s;
    const [gx, gy] = g;
    const startKey = pointKey(sx, sy);
    const goalKey = pointKey(gx, gy);

    const initialKey = stateKey(sx, sy, -1);
    const queue = [[Math.abs(sx - gx) + Math.abs(sy - gy), 0, sx, sy, -1]];
    const best = new Map([[initialKey, 0]]);
    const parent = new Map();
    let end = null;
    while (queue.length) {
      const row = heappop(queue);
      const cost = row[1];
      const x = row[2];
      const y = row[3];
      const d = row[4];
      const key = stateKey(x, y, d);
      if (cost !== best.get(key)) continue;
      if (x === gx && y === gy) {
        end = key;
        break;
      }
      for (let nd = 0; nd < 4; nd++) {
        const dx = DIRS[nd][0];
        const dy = DIRS[nd][1];
        const nx = x + dx;
        const ny = y + dy;
        if (!(1 <= nx && nx < maxx && 1 <= ny && ny < maxy)) continue;
        const pk = pointKey(nx, ny);
        if (blockedKeys.has(pk) && pk !== startKey && pk !== goalKey) continue;
        if (b && !(b[0] <= nx && nx <= b[2] && b[1] <= ny && ny <= b[3])) continue;
        // tuple(sorted(((x, y), (nx, ny)))) as a unit segment
        const dir = dx ? 0 : 1;
        const fx = dx ? Math.min(x, nx) : x;
        const fy = dy ? Math.min(y, ny) : y;
        if (occupiedKeys.has(segKey(fx, fy, dir))) continue;
        if (colors) {
          let close = false;
          for (const offset of OFFSETS) {
            const v = colors.get(segKey(fx + (dy ? offset : 0), fy + (dx ? offset : 0), dir));
            if (v !== undefined && py.eq(v, line_color)) {
              close = true;
              break;
            }
          }
          if (close) continue;
        }
        const nc = cost + 1 + (d >= 0 && d !== nd ? 4 : 0);
        const nsKey = stateKey(nx, ny, nd);
        const prev = best.get(nsKey);
        if (nc < (prev === undefined ? Infinity : prev)) {
          best.set(nsKey, nc);
          parent.set(nsKey, [key, x, y, d]);
          heappush(queue, [nc + Math.abs(nx - gx) + Math.abs(ny - gy), nc, nx, ny, nd]);
        }
      }
    }
    if (end === null) return null;
    const points = [];
    // walk back: parent maps a state to [its parent's key, the parent's x, y, d]
    let cur = end;
    let cx = gx;
    let cy = gy;
    while (cur !== initialKey) {
      points.push(py.T(cx, cy));
      const p = parent.get(cur);
      cur = p[0];
      cx = p[1];
      cy = p[2];
    }
    points.push(start);
    points.reverse();
    return points;
  };
}
