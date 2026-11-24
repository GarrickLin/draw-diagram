// compile：校验 agent 写的规格，计算主图版面，生成 .drawio。

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { UsageError, DiagramError } from "../cli.js";
import { compile } from "../engine/index.js";
import { contentId, readState, writeState, statePath } from "../state.js";
import { wrapAsMxFile } from "../convert.js";
import { publicationToDrawio } from "../layout/publication.js";
import { behaviorToDrawio } from "../layout/behavior.js";
import { algorithmToDrawio } from "../layout/algorithm.js";

const CONVERTERS = {
  publication: publicationToDrawio,
  legacy: publicationToDrawio,
  behavior: behaviorToDrawio,
  algorithm: algorithmToDrawio,
};

/** 文件名：标题转小写连字符，没有可用字符时用 diagram。 */
export function fileName(title) {
  const slug = String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return (slug || "diagram") + ".drawio";
}

function readSpec(path, cwd) {
  let text;
  try {
    text = readFileSync(resolve(cwd, path), "utf8");
  } catch (e) {
    throw new DiagramError(`Can't read the spec ${path}: ${e.code || e.message}`, "input_unreadable");
  }
  // agent 有时会把 JSON 放在代码围栏里
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  try {
    return JSON.parse(fenced ? fenced[1] : text);
  } catch (e) {
    throw new DiagramError(`The spec isn't valid JSON: ${e.message}`, "spec_invalid");
  }
}

function formatIssues(issues) {
  return (issues || []).map((i) => `  - ${i.path} (${i.item}): ${i.problem}`).join("\n");
}

export async function run(opts, io) {
  if (!opts.prep || !opts.spec) throw new UsageError("compile needs --prep <id> and --spec <file>.");
  const prep = readState(io.cwd, "prep", opts.prep);
  const spec = readSpec(opts.spec, io.cwd);

  let layout;
  try {
    ({ layout } = await compile({ spec, context: prep.context }));
  } catch (e) {
    if (e instanceof DiagramError && e.code === "spec_invalid" && e.details?.issues) {
      e.message += "\n" + formatIssues(e.details.issues);
    }
    throw e;
  }

  const convert = CONVERTERS[layout.kind];
  if (!convert) {
    const why = layout.figure.design_limit ? ` ${layout.figure.design_limit}` : "";
    throw new DiagramError(
      `The layout engine couldn't lay this spec out as a diagram.${why} Narrow the scope (fewer nodes, or one subsystem per diagram) or split it, then compile again.`,
      "layout_unavailable",
    );
  }
  const result = await convert(layout);
  const title = layout.spec.title || layout.figure.title || "Diagram";
  const content = wrapAsMxFile(result.xml, title);
  const output = resolve(io.cwd, opts.output || fileName(title));
  writeFileSync(output, content, "utf8");

  const warnings = [...layout.warnings, ...result.warnings];
  const id = contentId({ prep: opts.prep, spec });
  writeState(io.cwd, "out", id, {
    id,
    prep: opts.prep,
    output,
    description: prep.context.description,
    // 版面文档里的设置带着规格最终确定的图类型；按反馈修改时上游要求它不是 auto
    settings: layout.settings,
    spec: layout.spec,
    kind: layout.kind,
    layout_strategy: layout.figure.layout_strategy,
    quality: layout.quality,
    deferred_labels: (layout.label_layout?.deferred_labels || []).map((d) => d.text),
    stats: result.stats,
    warnings,
  });

  const lines = [`${output}: ${layout.kind} (${layout.figure.layout_strategy}), compile ${id}`];
  const s = result.stats;
  lines.push(`  ${s.nodes} nodes, ${s.edges} edges` + (s.containers ? `, ${s.containers} containers` : "") + (s.groups ? `, ${s.groups} groups` : ""));
  for (const w of warnings) lines.push(`  warning: ${w}`);
  lines.push(`Next: node draw-diagram.js check ${output}`);
  return {
    text: lines.join("\n"),
    json: { id, output, kind: layout.kind, layout_strategy: layout.figure.layout_strategy, stats: result.stats, warnings },
  };
}
