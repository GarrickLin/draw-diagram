// 在本地 draw.io 形状索引里按关键词查样式。不访问网络。

import { buildTagMap, searchShapesWithMeta } from "../vendor/drawio/shape-search.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let shapeIndex = null;
let shapeTagMap = null;

function loadIndex() {
  if (shapeIndex === null) {
    shapeIndex = JSON.parse(readFileSync(join(__dirname, "..", "data", "shape-index.json"), "utf8"));
    shapeTagMap = buildTagMap(shapeIndex);
  }
  return shapeIndex;
}

function words(text) {
  return String(text).toLowerCase().split(/\W+/).filter((w) => w.length > 0);
}

/** 库内图片的相对路径只在编辑器里能解析，补成绝对地址。 */
function absoluteImageUrls(style) {
  return String(style).replace(/(^|;)image=(?!https?:|data:)\/?/g, "$1image=https://app.diagrams.net/");
}

/**
 * 在本地形状索引里按关键词搜索。
 * @param {string} query
 * @param {number} [limit]
 * @returns {{strong: boolean, results: Array<{title: string, width: number, height: number, style: string}>}}
 */
export function searchShapes(query, limit = 6) {
  if (typeof query !== "string" || query.trim() === "") {
    throw new Error("The query is empty; pass the shape to look up, e.g. \"aws4 lambda\".");
  }
  const index = loadIndex();

  // 和官方 find-shapes.js 一样先做严格匹配：查询的每个词都要是形状的 tag。
  // 形状的第一个 tag 是库名，所以 "aws4 lambda" 只会命中 aws4 库。
  const terms = words(query);
  const exact = index
    .filter((shape) => {
      const tags = words(shape.tags || "");
      return terms.every((t) => tags.includes(t));
    })
    .slice(0, limit);

  let strong = true;
  let results = exact;
  if (exact.length === 0) {
    // 没有严格命中时退回 MCP 服务端的模糊算法，由调用方判断结果是否合用
    const fuzzy = searchShapesWithMeta(index, shapeTagMap, query, limit);
    strong = false;
    results = fuzzy.results;
  }

  return {
    strong,
    results: results.map((r) => ({
      title: r.title,
      width: r.w,
      height: r.h,
      style: absoluteImageUrls(r.style),
    })),
  };
}
