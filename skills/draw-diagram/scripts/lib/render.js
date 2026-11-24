// 用 diagram-render 的 WASM 版本把 .drawio 渲染成 SVG 或 PNG，也提供它的语法检查。
//
// WASM 读不到文件和系统字体：随包的 8 个 Liberation 字体按固定顺序传进去；图里有随包字体没有的
// 字符（中文等）时，再找一个本机的中日韩字体传进去，找不到就照常出图，但汉字会显示成方框。
// 整个过程不访问网络。

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = join(dirname(fileURLToPath(import.meta.url)), "..", "vendor", "diagram-render");
const WASM = join(HERE, "diagram_render.wasm");
const FONTS = join(HERE, "fonts");

// raster.rs FILES 的顺序
const BUNDLED = [
  "LiberationSans-Regular.ttf",
  "LiberationSans-Bold.ttf",
  "LiberationSans-Italic.ttf",
  "LiberationSans-BoldItalic.ttf",
  "LiberationSerif-Regular.ttf",
  "LiberationSerif-Bold.ttf",
  "LiberationMono-Regular.ttf",
  "LiberationMono-Bold.ttf",
];

/**
 * 常见的中日韩字体位置。环境变量 DRAW_DIAGRAM_CJK_FONT 优先；设成 none 表示不找系统字体
 * （测试用，也可以用来确认图在没有中文字体的机器上的样子）。
 */
function cjkCandidates() {
  const list = [];
  const env = process.env.DRAW_DIAGRAM_CJK_FONT;
  if (env === "none") return list;
  if (env) list.push(env);
  if (process.platform === "darwin") {
    list.push("/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc", "/System/Library/Fonts/STHeiti Medium.ttc", "/Library/Fonts/Arial Unicode.ttf");
  } else if (process.platform === "win32") {
    const win = process.env.WINDIR || "C:\\Windows";
    list.push(join(win, "Fonts", "msyh.ttc"), join(win, "Fonts", "msyh.ttf"), join(win, "Fonts", "simhei.ttf"), join(win, "Fonts", "simsun.ttc"));
  } else {
    const r = spawnSync("fc-match", ["-f", "%{file}", "sans-serif:lang=zh-cn"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) list.push(r.stdout.trim());
    list.push(
      "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
      "/usr/share/fonts/wenquanyi/wqy-microhei/wqy-microhei.ttc",
      "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
    );
  }
  return list;
}

/** 第一个存在的中日韩字体文件，没有则 null。 */
export function findCjkFont() {
  return cjkCandidates().find((p) => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  }) ?? null;
}

/** 文字里有没有随包 Liberation 字体覆盖不到的字符（只看中日韩和全角）。 */
export function needsCjk(text) {
  return /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/.test(text);
}

let instance = null;

async function load(cjk) {
  if (instance && instance.cjk === cjk) return instance;
  const { instance: inst } = await WebAssembly.instantiate(readFileSync(WASM), {});
  const x = inst.exports;
  const put = (bytes) => {
    const ptr = x.alloc(bytes.length);
    new Uint8Array(x.memory.buffer, ptr, bytes.length).set(bytes);
    return ptr;
  };
  const addFont = (kind, bytes) => {
    const ptr = put(bytes);
    const bad = x.add_font(kind, ptr, bytes.length);
    x.dealloc(ptr, bytes.length);
    return bad === 0;
  };
  for (const f of BUNDLED) {
    if (!addFont(0, readFileSync(join(FONTS, f)))) throw new Error(`The bundled font ${f} is damaged.`);
  }
  let cjkLoaded = false;
  if (cjk) {
    try {
      cjkLoaded = addFont(1, readFileSync(cjk));
    } catch {
      cjkLoaded = false;
    }
  }
  const take = () => {
    const meta = JSON.parse(Buffer.from(new Uint8Array(x.memory.buffer, x.meta_ptr(), x.meta_len())).toString("utf8"));
    const out = Buffer.from(new Uint8Array(x.memory.buffer, x.out_ptr(), x.out_len()));
    return { meta, out };
  };
  const call = (fn, text, page, ...args) => {
    const src = Buffer.from(text, "utf8");
    const pg = Buffer.from(page ?? "", "utf8");
    const p = put(src);
    const q = put(pg);
    const code = fn === "render" ? x.render(p, src.length, ...args, q, pg.length) : x.check(p, src.length, q, pg.length);
    x.dealloc(p, src.length);
    x.dealloc(q, pg.length);
    return { ok: code === 0, ...take() };
  };
  instance = { cjk, cjkLoaded, call };
  return instance;
}

/**
 * 渲染一张图。
 * @param {string} text .drawio 文件内容
 * @param {{to?: "png"|"svg", scale?: number, page?: string}} [options]
 * @returns {Promise<{ok: boolean, out: Buffer, meta: object, cjk: {needed: boolean, font: string|null}}>}
 */
export async function render(text, { to = "png", scale = 0, page } = {}) {
  const needed = needsCjk(text);
  const font = needed ? findCjkFont() : null;
  const r = await load(font);
  const result = r.call("render", text, page, to === "png" ? 1 : 0, scale);
  return { ...result, cjk: { needed, font: needed && r.cjkLoaded ? font : null } };
}

/**
 * diagram-render 自己的检查：XML 能否读、页面是否存在、悬空连线、近似画出的图形等。
 * @param {string} text
 * @param {{page?: string}} [options]
 */
export async function check(text, { page } = {}) {
  const r = await load(null);
  return r.call("check", text, page);
}
