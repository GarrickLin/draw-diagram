// 字宽表：Liberation Sans（与 Helvetica、Arial 字宽相同）的字符宽度，单位 1/1000 em。
//
// draw.io 显示西文用 Helvetica，所以方框尺寸和换行都按这张表算。Python 版面引擎通过
// silicon.patch 读同一份 data/widths.json，两边测出的宽度完全相同。
//
// 规则和 draw.io 自带的 shared/semantic/text-width.js 一致：ASCII 查表；宽字符（中日韩、
// 全角符号、emoji）按 1 em；其余字符先查补充表，查不到按小写字母 n 的宽度。

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let table = null;

function load() {
  if (table === null) {
    table = JSON.parse(readFileSync(join(__dirname, "..", "data", "widths.json"), "utf8"));
  }
  return table;
}

/** 与 draw.io text-width.js 的 isWide 相同。 */
export function isWide(code) {
  return (code >= 0x1100 && code <= 0x115F) || (code >= 0x2E80 && code <= 0xA4CF) ||
    (code >= 0xAC00 && code <= 0xD7A3) || (code >= 0xF900 && code <= 0xFAFF) ||
    (code >= 0xFE30 && code <= 0xFE4F) || (code >= 0xFF00 && code <= 0xFF60) ||
    (code >= 0xFFE0 && code <= 0xFFE6) || code >= 0x1F000;
}

/**
 * 一行文字的宽度，单位 1/1000 em。
 * @param {string} text
 * @param {boolean} [bold]
 */
export function textEm(text, bold = false) {
  const t = load();
  const style = bold ? t.bold : t.regular;
  const fallback = style.ascii[t.fallback.codePointAt(0) - 32];
  let em = 0;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (code >= 32 && code <= 126) {
      em += style.ascii[code - 32];
    } else if (isWide(code)) {
      em += t.unitsPerEm * t.wideEm;
    } else if (Object.hasOwn(style.extra, ch)) {
      em += style.extra[ch];
    } else if (code < 32) {
      // 控制字符不占宽度
    } else {
      em += fallback;
    }
  }
  return em;
}

/**
 * 一行文字在给定字号下的宽度，单位 px。
 * @param {string} text
 * @param {number} fontSize
 * @param {boolean} [bold]
 */
export function textWidth(text, fontSize, bold = false) {
  return (textEm(text, bold) * fontSize) / load().unitsPerEm;
}
