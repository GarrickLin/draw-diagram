// Loads diagram_render.wasm with no npm packages and renders .drawio files.
// Usage: node render-wasm.mjs <wasm> <fonts-dir> <input.drawio> <out.png|out.svg> [--cjk <font>]

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILES = [
  "LiberationSans-Regular.ttf",
  "LiberationSans-Bold.ttf",
  "LiberationSans-Italic.ttf",
  "LiberationSans-BoldItalic.ttf",
  "LiberationSerif-Regular.ttf",
  "LiberationSerif-Bold.ttf",
  "LiberationMono-Regular.ttf",
  "LiberationMono-Bold.ttf",
];

export async function load(wasmPath, fontsDir, extraFonts = []) {
  const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {});
  const x = instance.exports;

  const put = (bytes) => {
    const ptr = x.alloc(bytes.length);
    new Uint8Array(x.memory.buffer, ptr, bytes.length).set(bytes);
    return ptr;
  };
  const addFont = (kind, bytes) => {
    const ptr = put(bytes);
    const bad = x.add_font(kind, ptr, bytes.length);
    x.dealloc(ptr, bytes.length);
    if (bad) throw new Error("not a font");
  };
  for (const f of FILES) addFont(0, readFileSync(join(fontsDir, f)));
  for (const f of extraFonts) addFont(1, readFileSync(f));

  const take = () => {
    const meta = JSON.parse(Buffer.from(new Uint8Array(x.memory.buffer, x.meta_ptr(), x.meta_len())).toString("utf8"));
    const out = Buffer.from(new Uint8Array(x.memory.buffer, x.out_ptr(), x.out_len()));
    return { meta, out };
  };

  return {
    render(text, { to = "svg", scale = 0, page } = {}) {
      const src = Buffer.from(text, "utf8");
      const pg = Buffer.from(page ?? "", "utf8");
      const p = put(src), q = put(pg);
      const code = x.render(p, src.length, to === "png" ? 1 : 0, scale, q, pg.length);
      x.dealloc(p, src.length); x.dealloc(q, pg.length);
      return { ok: code === 0, ...take() };
    },
    check(text, { page } = {}) {
      const src = Buffer.from(text, "utf8");
      const pg = Buffer.from(page ?? "", "utf8");
      const p = put(src), q = put(pg);
      const code = x.check(p, src.length, q, pg.length);
      x.dealloc(p, src.length); x.dealloc(q, pg.length);
      return { ok: code === 0, meta: take().meta };
    },
  };
}

if (process.argv[1] && process.argv[1].endsWith("render-wasm.mjs")) {
  const [wasm, fonts, input, output, ...rest] = process.argv.slice(2);
  const cjk = rest[0] === "--cjk" ? [rest[1]] : [];
  const t0 = performance.now();
  const r = await load(wasm, fonts, cjk);
  const t1 = performance.now();
  const res = r.render(readFileSync(input, "utf8"), { to: output.endsWith(".png") ? "png" : "svg" });
  const t2 = performance.now();
  if (res.ok) writeFileSync(output, res.out);
  console.log(JSON.stringify({ ...res.meta, bytes: res.out.length, load_ms: Math.round(t1 - t0), render_ms: Math.round(t2 - t1) }));
}
