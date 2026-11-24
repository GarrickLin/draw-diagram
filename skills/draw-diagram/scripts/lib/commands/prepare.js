// prepare：根据用户描述生成写规格的说明，供强化路径（架构、芯片、算法、状态机等图）使用。

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { UsageError } from "../cli.js";
import { prepare } from "../engine/index.js";
import { contentId, readState, writeState, statePath } from "../state.js";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "draw-diagram.js");

/** 描述里有汉字就用中文标签，否则英文。 */
export function detectLanguage(text) {
  return /[㐀-鿿豈-﫿]/.test(text) ? "zh" : "en";
}

function instructions(id, messages, specHint) {
  const system = messages.find((m) => m.role === "system").content;
  const user = JSON.parse(messages.find((m) => m.role === "user").content);
  return [
    `# draw-diagram spec instructions (prep ${id})`,
    "",
    "Write ONE JSON object that follows the rules and the specification_schema below. Save it to a file and run:",
    "",
    `    node ${CLI} compile --prep ${id} --spec ${specHint}`,
    "",
    "If compile reports `spec_invalid`, fix the fields it lists and run compile again.",
    "",
    "## Rules",
    "",
    system.trim(),
    "",
    "## Request",
    "",
    "```json",
    JSON.stringify(user, null, 2),
    "```",
    "",
  ].join("\n");
}

export async function run(opts, io) {
  if ((opts.description === undefined) === (opts["description-file"] === undefined)) {
    throw new UsageError("prepare needs exactly one of --description and --description-file.");
  }
  const description = opts.description ?? readFileSync(resolve(io.cwd, opts["description-file"]), "utf8");
  if (description.trim() === "") throw new UsageError("The description is empty.");
  if ((opts.previous === undefined) !== (opts.feedback === undefined)) {
    throw new UsageError("--previous and --feedback go together: --previous names the compile to revise, --feedback says what to change.");
  }
  let language = opts.language;
  if (language === undefined) language = detectLanguage(description + (opts.feedback ?? ""));
  if (!["zh", "en"].includes(language)) throw new UsageError("--language is zh or en.");

  let previous = null;
  if (opts.previous !== undefined) {
    const out = readState(io.cwd, "out", opts.previous);
    previous = { spec: out.spec, settings: out.settings, description: out.description };
  }
  const request = { description, language, feedback: opts.feedback ?? "", previous };
  const id = contentId(request);
  const { messages, context, representation } = await prepare(request);

  writeState(io.cwd, "prep", id, { id, request: { ...request, previous_out: opts.previous ?? null, previous: undefined }, context, representation });
  const md = statePath(io.cwd, "prep", id, "md");
  const specHint = "<spec.json>";
  writeFileSync(md, instructions(id, messages, specHint), "utf8");

  const compile = `node ${CLI} compile --prep ${id} --spec ${specHint}`;
  return {
    text: [
      `prep ${id}`,
      `Read the spec instructions: ${md}`,
      "Write the spec JSON to a file, then run:",
      `  ${compile}`,
    ].join("\n"),
    json: { id, instructions: md, language, compile },
  };
}
