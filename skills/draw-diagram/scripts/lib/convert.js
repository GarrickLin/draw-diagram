// Mermaid / PlantUML / draw.io CSV / draw.io XML 转 .drawio。
//
// 输出是 .drawio 文件的完整内容：<mxfile> 里包一页 <mxGraphModel>。
// 全部在本进程内完成，不启动浏览器，不访问网络。

import { convertSource } from "../vendor/drawio/convert/index.js";
import { repairDiagramXml } from "../vendor/drawio/repair-xml.js";

/** 能处理的输入格式。 */
export const FORMATS = ["xml", "mermaid", "plantuml", "csv"];

const UNSUPPORTED_HINT =
  "Only flowchart, sequenceDiagram and erDiagram Mermaid convert offline. " +
  "Rewrite it as one of those, or author the diagram as draw.io XML.";

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 把一页 mxGraphModel 包成 .drawio 文件。已经是 mxfile 的原样返回。
 * @param {string} modelXml
 * @param {string} [name]
 * @returns {string}
 */
export function wrapAsMxFile(modelXml, name = "Page-1") {
  const trimmed = modelXml.trim();
  if (trimmed.startsWith("<mxfile")) {
    return trimmed + "\n";
  }
  return (
    '<mxfile host="draw-diagram" type="device">\n' +
    `  <diagram id="page-1" name="${escapeAttr(name)}">\n` +
    "    " + trimmed + "\n" +
    "  </diagram>\n" +
    "</mxfile>\n"
  );
}

/**
 * 判断输入格式。显式传入的优先。
 * @param {string} source
 * @param {string} [format]
 * @returns {"xml"|"mermaid"|"plantuml"|"csv"}
 */
export function detectFormat(source, format) {
  if (format && format !== "auto") {
    const f = format.toLowerCase();
    if (!FORMATS.includes(f)) {
      throw new Error(`Unknown format "${format}". Use one of: ${FORMATS.join(", ")}, auto.`);
    }
    return f;
  }

  const text = source.trim();
  // XML 前后可能夹着代码围栏或说明文字，修复步骤会删掉它们，所以只看有没有根标签
  if (/<mxfile[\s>]|<mxGraphModel[\s>]/.test(text)) {
    return "xml";
  }
  if (/^\s*@start\w+/m.test(text)) {
    return "plantuml";
  }
  // draw.io CSV：先是 # 开头的配置行（# label: 等），再是逗号分隔的表头。
  // 没有配置行的纯 CSV 不自动识别，否则一段写错头部的 Mermaid 会被当成 CSV 转出一张无意义的图。
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (/^\s*#/.test(lines[0] || "")) {
    const firstData = lines.find((l) => !/^\s*#/.test(l)) || "";
    if (firstData.includes(",")) {
      return "csv";
    }
  }
  // 其余一律按 Mermaid 处理：转换器自己读头部，错拼的类型会得到带修正建议的报错
  return "mermaid";
}

/**
 * 生成 .drawio 文件内容。
 *
 * @param {string} source
 * @param {{format?: string, name?: string}} [options]
 * @returns {Promise<{content: string, format: string, type?: string, warnings: string[]}>}
 * @throws {Error} 语法错误、不支持的类型、无法识别的输入
 */
export async function createDrawio(source, options = {}) {
  if (typeof source !== "string" || source.trim() === "") {
    throw new Error("The input is empty.");
  }

  const format = detectFormat(source, options.format);
  const name = options.name || "Page-1";

  if (format === "xml") {
    const { xml, repairs } = repairDiagramXml(source);
    if (!/<mxGraphModel[\s>]/.test(xml)) {
      throw new Error("The XML has no <mxGraphModel>. Start from the skeleton in references/xml-essentials.md.");
    }
    if (!/<mxCell\s+id="0"/.test(xml) || !/<mxCell\s+id="1"/.test(xml)) {
      throw new Error(
        'The XML is missing the root cells <mxCell id="0"/> and <mxCell id="1" parent="0"/>; ' +
          "without them draw.io shows a blank page."
      );
    }
    return {
      content: wrapAsMxFile(xml, name),
      format,
      warnings: repairs.map((r) => "repaired: " + r),
    };
  }

  const result = await convertSource(format, source, {});

  if (result.error) {
    throw new Error(result.error);
  }
  if (result.fallback) {
    throw new Error(`"${result.type || format}" diagrams cannot be converted offline. ${UNSUPPORTED_HINT}`);
  }

  return {
    content: wrapAsMxFile(result.xml, name),
    format,
    type: result.type,
    warnings: result.warnings || [],
  };
}
