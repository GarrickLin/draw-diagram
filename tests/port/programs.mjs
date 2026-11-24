#!/usr/bin/env node
// Semantic parity of the Python → JS port on small programs (tests/port/programs/*.py).
//
// Each program's main() returns a list. CPython runs it; tools/port/transpile.py turns it into JS
// that runs on lib/engine/py; the repr() of every item must be the same string. This checks the
// transpiler and the runtime together, on the language features the silicon modules use.
//
//   node tests/port/programs.mjs [module ...]

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, symlinkSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROGRAMS = join(ROOT, "tests", "port", "programs");
const PYTHON = process.env.DRAW_DIAGRAM_PYTHON || join(homedir(), ".cache", "draw-diagram", "venv", "bin", "python");
const ENGINE = join(ROOT, "plugins", "draw-diagram", "skills", "draw-diagram", "scripts", "lib", "engine");

export const MODULES = readdirSync(PROGRAMS)
  .filter((f) => /^p_\w+\.py$/.test(f))
  .map((f) => f.slice(0, -3))
  .sort();

function must(r, what) {
  if (r.status !== 0) throw new Error(`${what} failed:\n${r.stderr || r.stdout}`);
  return r.stdout;
}

/** {module: {python: [...], js: [...], mismatches: [{index, python, js}]}} */
export async function runPrograms(modules = MODULES) {
  const work = mkdtempSync(join(tmpdir(), "port-programs-"));
  symlinkSync(join(ENGINE, "py"), join(work, "py"));
  mkdirSync(join(work, "gen"));
  must(spawnSync(PYTHON, ["-I", "-B", join(ROOT, "tools", "port", "transpile.py"), PROGRAMS, join(work, "gen"), ...modules], { encoding: "utf8" }), "transpile");
  // PYTHONHASHSEED=0: the JS runtime hashes strings as CPython does with that seed (-I would ignore it)
  const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", PYTHONHASHSEED: "0", PYTHONUTF8: "1" };
  const expected = JSON.parse(must(spawnSync(PYTHON, ["-s", "-P", "-B", join(ROOT, "tests", "port", "run_programs.py"), PROGRAMS, ...modules], { encoding: "utf8", maxBuffer: 1 << 28, env }), "CPython"));
  const py = await import(pathToFileURL(join(ENGINE, "py", "runtime.js")).href);
  const out = {};
  for (const m of modules) {
    let js;
    try {
      const mod = await import(pathToFileURL(join(work, "gen", `${m}.js`)).href);
      js = [...py.iter(mod.main())].map((x) => py.repr(x));
    } catch (e) {
      js = [`<crash ${e?.stack ?? e}>`];
    }
    const python = expected[m];
    const mismatches = [];
    for (let i = 0; i < Math.max(python.length, js.length); i++) {
      if (python[i] !== js[i]) mismatches.push({ index: i, python: python[i], js: js[i] });
    }
    out[m] = { python, js, mismatches };
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const res = await runPrograms(process.argv.length > 2 ? process.argv.slice(2) : MODULES);
  let bad = 0;
  for (const [m, r] of Object.entries(res)) {
    console.log(`${m}: ${r.python.length} items, ${r.mismatches.length} mismatches`);
    for (const x of r.mismatches.slice(0, 6)) {
      bad++;
      console.log(`  [${x.index}]\n    python: ${String(x.python).slice(0, 600)}\n    js:     ${String(x.js).slice(0, 600)}`);
    }
    bad += r.mismatches.length > 6 ? r.mismatches.length - 6 : 0;
  }
  process.exitCode = bad ? 1 : 0;
}
