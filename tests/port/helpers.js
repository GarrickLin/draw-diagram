// tests/port 共用：CPython 参考环境。
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ENGINE = join(ROOT, "skills", "draw-diagram", "scripts", "lib", "engine");
/** The CPython the port follows (3.14 with Pillow): DRAW_DIAGRAM_PYTHON or the phase-1 venv. */
export const PYTHON = process.env.DRAW_DIAGRAM_PYTHON || join(homedir(), ".cache", "draw-diagram", "venv", "bin", "python");
export const SILICON = join(ROOT, "tools", "port", "silicon");
/** Skip reason when there's no reference CPython; these tests compare against it. */
export const skipWithoutPython = existsSync(PYTHON) ? false : `no reference CPython at ${PYTHON}`;
