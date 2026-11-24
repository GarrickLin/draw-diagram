#!/usr/bin/env node
// Python vs JS engine parity: every request goes to tools/port/bridge.py (CPython) and to the
// transpiled JS engine, and the two answers must be the same bytes.
//
// Cases: every spec under tests/upstream/silicon-canvas and tests/draw-diagram/fixtures, in English
// and Chinese, plus seeded random variants of each (nodes dropped, edges reversed, labels
// rewritten, ...). A variant may be invalid; then both engines must reject it the same way.
//
//   node tests/port/parity.mjs [--variants N] [--seed S] [--filter text] [--jobs J] [--json]
//
// Needs the reference CPython 3.14 with Pillow (DRAW_DIAGRAM_PYTHON or ~/.cache/draw-diagram/venv/bin/python).

import { spawn } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { cpus, homedir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PYTHON = process.env.DRAW_DIAGRAM_PYTHON || join(homedir(), ".cache", "draw-diagram", "venv", "bin", "python");
export const BRIDGE = join(ROOT, "tools", "port", "bridge.py");
const BATCH = join(ROOT, "tests", "port", "bridge_batch.py");
// The JS engine hashes strings as CPython does with PYTHONHASHSEED=0, so the reference runs with
// that seed. -I would ignore PYTHONHASHSEED (it implies -E): -s -P give the rest of its isolation.
export const PYTHON_FLAGS = ["-s", "-P", "-B"];
export const PYTHON_ENV = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", PYTHONHASHSEED: "0", PYTHONUTF8: "1" };

// ─── specs ───────────────────────────────────────────────────────

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}

/** Every spec file: {name, spec, description}. */
export function specs() {
  const out = [];
  for (const dir of [join(ROOT, "tests", "upstream", "silicon-canvas"), join(ROOT, "tests", "draw-diagram", "fixtures")]) {
    for (const p of walk(dir)) {
      let d;
      try {
        d = JSON.parse(readFileSync(p, "utf8"));
      } catch {
        continue;
      }
      const spec = d && typeof d.spec === "object" && d.spec ? d.spec : d;
      if (!spec || !Array.isArray(spec.nodes)) continue;
      out.push({ name: relative(ROOT, p), spec, description: d.description || spec.title || "diagram" });
    }
  }
  return out;
}

// ─── seeded variants ─────────────────────────────────────────────

function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (n) => Math.floor(next() * n);
  next.pick = (xs) => xs[next.int(xs.length)];
  next.shuffle = (xs) => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = next.int(i + 1);
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  };
  return next;
}

const WORDS = ["Cache", "Fabric", "Arbiter", "Queue", "Tensor Core", "DMA", "Crossbar", "Scheduler", "SRAM", "Router", "Decoder", "Buffer"];
const ZH = ["缓存", "互连", "仲裁器", "队列", "张量核", "直接存储访问", "交叉开关", "调度器", "片上存储", "路由器"];

const MUTATIONS = {
  shuffleNodes: (s, r) => r.shuffle(s.nodes),
  shuffleEdges: (s, r) => s.edges?.length && r.shuffle(s.edges),
  dropEdge: (s, r) => s.edges?.length && s.edges.splice(r.int(s.edges.length), 1),
  dropNode: (s, r) => {
    if (s.nodes.length < 3) return;
    const [n] = s.nodes.splice(r.int(s.nodes.length), 1);
    if (s.edges) s.edges = s.edges.filter((e) => e.source !== n.id && e.target !== n.id);
  },
  reverseEdge: (s, r) => {
    if (!s.edges?.length) return;
    const e = r.pick(s.edges);
    [e.source, e.target] = [e.target, e.source];
  },
  relabel: (s, r) => {
    const n = r.pick(s.nodes);
    n.label = r() < 0.5 ? `${r.pick(WORDS)} ${r.int(16)}` : r.pick(ZH) + r.int(8);
  },
  longLabel: (s, r) => {
    const n = r.pick(s.nodes);
    n.label = Array.from({ length: 3 + r.int(6) }, () => r.pick(WORDS)).join(" ");
  },
  addNode: (s, r) => {
    const base = r.pick(s.nodes);
    const id = `n_fuzz_${r.int(1e6)}`;
    s.nodes.push({ ...base, id, label: `${r.pick(WORDS)} ${r.int(9)}` });
    if (s.edges) s.edges.push({ ...(s.edges[0] || {}), source: base.id, target: id, label: r() < 0.5 ? "" : "data" });
  },
  duplicateEdge: (s, r) => s.edges?.length && s.edges.push({ ...r.pick(s.edges), label: r.pick(WORDS).toLowerCase() }),
  changeKind: (s, r) => {
    const kinds = [...new Set(s.nodes.map((n) => n.kind).filter(Boolean))];
    if (kinds.length) r.pick(s.nodes).kind = r.pick(kinds);
  },
  ungroup: (s, r) => {
    const n = r.pick(s.nodes);
    delete n.group;
  },
  retitle: (s, r) => {
    s.title = `${r.pick(WORDS)} ${r.pick(WORDS)} Overview`;
  },
};

// Changes that usually make the spec invalid: the engines must reject (or crash on) them alike.
const BREAKING = {
  danglingEdge: (s, r) => s.edges && s.edges.push({ ...(s.edges[0] || {}), source: r.pick(s.nodes).id, target: "n_missing" }),
  duplicateId: (s, r) => s.nodes.length > 1 && (s.nodes[1].id = s.nodes[0].id),
  noLabel: (s, r) => delete r.pick(s.nodes).label,
  numericLabel: (s, r) => (r.pick(s.nodes).label = r.int(100)),
  nullField: (s, r) => (r.pick(s.nodes)[r.pick(["kind", "group", "detail", "origin"])] = null),
  missingGroup: (s, r) => (r.pick(s.nodes).group = "g_missing"),
  noEdges: (s) => delete s.edges,
  emptyNodes: (s) => {
    s.nodes = [];
    s.edges = [];
  },
  edgesNotList: (s) => (s.edges = {}),
  badOrigin: (s, r) => (r.pick(s.nodes).origin = "invented"),
  selfLoop: (s, r) => {
    const n = r.pick(s.nodes);
    s.edges?.push({ ...(s.edges[0] || {}), source: n.id, target: n.id });
  },
  unknownCategory: (s) => (s.category = "poster"),
};

function variant(spec, seed) {
  const r = rng(seed);
  const s = structuredClone(spec);
  const applied = [];
  const n = 1 + r.int(3);
  for (let i = 0; i < n; i++) {
    if (!Array.isArray(s.nodes) || !s.nodes.length) break;
    const table = r() < 0.2 ? BREAKING : MUTATIONS;
    const name = r.pick(Object.keys(table));
    try {
      table[name](s, r);
      applied.push(name);
    } catch {
      // the spec no longer has the shape this change needs (edges is {}, ...): skip it
    }
  }
  return { spec: s, applied };
}

const FEEDBACK = [
  "Make the memory path more prominent and move the host interface to the left.",
  "把 L2 和内存控制器画在一起，标签改成中文。",
  "Remove the debug block; keep everything else.",
  "Show it as a photorealistic 3D product render instead.",
  "",
];

// Descriptions for prepare alone: what decides the representation, and edge cases of the request.
export const DESCRIPTIONS = [
  "A block diagram of a GPU: host interface, command processor, four compute clusters, shared L2 and memory controllers.",
  "画一张 SoC 架构图：CPU 簇、GPU、NPU、片上互连、DDR 控制器和外设总线。",
  "Photorealistic 3D render of a chip package on a circuit board with a heat spreader, studio lighting.",
  "芯片封装的剖面渲染图，要有材质和光照效果。",
  "An exploded isometric illustration of a server rack with GPUs.",
  "State machine for a DMA engine: IDLE, FETCH, TRANSFER, DONE, ERROR, with retry from ERROR.",
  "Timing diagram of a valid/ready handshake with back-pressure over eight cycles.",
  "Flash attention dataflow: Q, K, V tiles, online softmax, output accumulation.",
  "",
  "x",
  "Diagram ".repeat(400),
  "A pipeline: fetch → decode → execute → writeback, with a forwarding path. 中文 English mixed 🙂",
];

/** The cases: [{id, description, language, spec?, revise?}]. */
export function cases({ variants = 2, seed = 1, filter = "" } = {}) {
  const out = [];
  for (const [i, description] of DESCRIPTIONS.entries()) {
    if (filter && !"description".includes(filter)) continue;
    for (const language of ["en", "zh", ""]) out.push({ id: `description ${i} ${language || "default"}`, description, language, spec: null });
  }
  for (const { name, spec, description } of specs()) {
    if (filter && !name.includes(filter)) continue;
    out.push({ id: `${name} en`, description, language: "en", spec });
    out.push({ id: `${name} zh`, description, language: "zh", spec });
    for (let v = 0; v < variants; v++) {
      const vs = (seed * 1000003 + out.length * 7919 + v) >>> 0;
      const { spec: s, applied } = variant(spec, vs);
      const c = { id: `${name} variant ${vs} [${applied.join(",")}]`, description, language: v % 2 ? "zh" : "en", spec: s };
      // every other variant is also revised: feedback on its layout, then a further variant compiled
      if (v % 2 === 0) {
        const r = rng(vs);
        const next = variant(s, vs + 1);
        c.revise = { feedback: r.pick(FEEDBACK), lock_structure: r() < 0.5, spec: next.spec };
        c.id += ` revise [${next.applied.join(",")}]`;
      }
      out.push(c);
    }
  }
  return out;
}

// ─── the two engines ─────────────────────────────────────────────

class PythonPool {
  constructor(jobs) {
    this.workers = Array.from({ length: jobs }, () => this.start());
    this.idle = [...this.workers];
    this.waiting = [];
  }
  start() {
    const proc = spawn(PYTHON, PYTHON_FLAGS.concat([BATCH, BRIDGE]), { stdio: ["pipe", "pipe", "inherit"], env: PYTHON_ENV });
    const w = { proc, pending: null };
    createInterface({ input: proc.stdout }).on("line", (line) => {
      const p = w.pending;
      w.pending = null;
      this.release(w);
      p(line + "\n");
    });
    return w;
  }
  release(w) {
    const next = this.waiting.shift();
    if (next) next(w);
    else this.idle.push(w);
  }
  async ask(request) {
    const w = this.idle.pop() ?? (await new Promise((res) => this.waiting.push(res)));
    return new Promise((res) => {
      w.pending = res;
      w.proc.stdin.write(JSON.stringify(request) + "\n");
    });
  }
  close() {
    for (const w of this.workers) w.proc.stdin.end();
  }
}

let jsEngine = null;
async function askJs(request) {
  jsEngine ??= await import(join(ROOT, "plugins", "draw-diagram", "skills", "draw-diagram", "scripts", "lib", "engine", "js.js"));
  try {
    return await jsEngine.respond(request);
  } catch (e) {
    // a crash compares by exception type, as bridge_batch.py reports it
    const name = e?.constructor?.__pyname__ ?? (e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RecursionError" : `JS ${e?.constructor?.name}`);
    return JSON.stringify({ crash: name, message: String(e?.message ?? e).slice(0, 300), stack: String(e?.stack ?? "").split("\n").slice(0, 4).join(" | ") }) + "\n";
  }
}

function sameAnswer(py, js) {
  if (py === js) return true;
  // crashes: the exception type must match, the wording may not
  try {
    const a = JSON.parse(py);
    const b = JSON.parse(js);
    return a.crash !== undefined && a.crash === b.crash;
  } catch {
    return false;
  }
}

function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return { at: i, python: a.slice(Math.max(0, i - 80), i + 120), js: b.slice(Math.max(0, i - 80), i + 120) };
}

/** Runs the cases; returns {total, requests, mismatches: [{id, op, ...}]}. */
export async function runParity(list, { jobs = Math.max(1, Math.min(8, cpus().length - 1)), onCase } = {}) {
  if (!existsSync(PYTHON)) throw new Error(`no Python at ${PYTHON}`);
  const pool = new PythonPool(jobs);
  const mismatches = [];
  const byOp = {};
  let requests = 0;
  // A case is a chain of requests, each built from Python's previous answer. Python runs the
  // chains in parallel in the pool; JS answers the same requests in this process.
  const parse = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  };
  const chain = async (c) => {
    const steps = [];
    const ask = async (op, request) => {
      const answer = await pool.ask(request);
      steps.push({ op, request, answer });
      return parse(answer);
    };
    const prep = await ask("prepare", { op: "prepare", description: c.description, language: c.language });
    if (!c.spec || !prep.context) return steps;
    const comp = await ask("compile", { op: "compile", spec: c.spec, context: prep.context });
    if (!c.revise || !comp.layout) return steps;
    const previous = { spec: c.spec, settings: comp.layout.settings, description: c.description };
    const { feedback, lock_structure, spec } = c.revise;
    const prep2 = await ask("revise prepare", { op: "prepare", description: c.description, language: c.language, feedback, previous, lock_structure });
    if (prep2.context) await ask("revise compile", { op: "compile", spec, context: prep2.context });
    return steps;
  };
  const pyAnswers = list.map(chain);
  try {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      for (const { op, request, answer } of await pyAnswers[i]) {
        const js = await askJs(request);
        requests++;
        byOp[op] = (byOp[op] ?? 0) + 1;
        if (!sameAnswer(answer, js)) mismatches.push({ id: c.id, op, ...firstDifference(answer, js) });
        if (op.endsWith("compile")) onCase?.(c, answer.startsWith('{"crash"') ? "crash" : answer.startsWith('{"error"') ? "error" : "layout");
      }
    }
  } finally {
    pool.close();
  }
  return { total: list.length, requests, byOp, mismatches };
}

// ─── CLI ─────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : dflt;
  };
  const list = cases({ variants: Number(opt("--variants", 2)), seed: Number(opt("--seed", 1)), filter: opt("--filter", "") });
  const outcomes = { layout: 0, error: 0, crash: 0 };
  const t0 = Date.now();
  const res = await runParity(list, { jobs: Number(opt("--jobs", 0)) || undefined, onCase: (_c, kind) => outcomes[kind]++ });
  if (args.includes("--json")) console.log(JSON.stringify({ ...res, outcomes }));
  else {
    for (const m of res.mismatches) console.log(`MISMATCH ${m.op} ${m.id}\n  at ${m.at}\n  python: ${m.python}\n  js:     ${m.js}`);
    console.log(`${res.total} cases, ${res.requests} requests ${JSON.stringify(res.byOp)}, ${res.mismatches.length} mismatches; Python outcomes ${JSON.stringify(outcomes)}; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  process.exitCode = res.mismatches.length ? 1 : 0;
}
