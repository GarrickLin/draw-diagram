---
name: draw-diagram
description: "Use when the user asks to create, draw or design any diagram: system or chip architecture (SoC, GPU, CPU, NPU, accelerator, memory hierarchy, NoC), microarchitecture, algorithm or tensor dataflow, state machine, timing trace, pipeline, flowchart, sequence diagram, ER diagram, network or cloud architecture, org chart, swimlane, or mentions draw.io, drawio or .drawio files. Produces an editable .drawio file locally and offline, and can render it to PNG or SVG. Also use it when the user asks for a chip, package, board or server product render, cutaway or 3D illustration: it explains why that can't be drawn and offers a block diagram instead."
---

# draw-diagram

Make an editable draw.io diagram, check it, and look at it before handing it over. Everything runs locally on Node.js 20+; nothing is downloaded.

Below, `dd` is shorthand in this document for `node <skill-dir>/scripts/draw-diagram.js`, where `<skill-dir>` is the folder this file is in. Write the full command when you run it; don't put it in a shell variable (zsh won't split it). Every command takes `--json` for machine-readable output. Exit code 0 means done, 1 means the diagram has a problem (the message says what), 2 means the command itself was wrong.

The deliverable is a `.drawio` file. Render a PNG or SVG as well only when the user asks for an image.

## Choose a path

| The user wants | Path |
|---|---|
| System, SoC, chip or accelerator architecture; microarchitecture; memory hierarchy; hardware dataflow | **Planned**: `prepare` → spec → `compile` |
| Algorithm or tensor dataflow (attention, matmul, layers, recurrences) | **Planned** |
| State machine, timing trace (signals × cycles), hardware pipeline | **Planned** |
| Flowchart, process, UML sequence, ER / database schema | **Direct**: write Mermaid → `convert` |
| Anything else draw.io can draw: class diagrams, network or cloud diagrams with vendor icons, mockups, org charts, mind maps | **Direct**: write draw.io XML → `convert` |

The planned path lays the diagram out with a layout engine built for technical figures: hierarchy, shared resources, routed connections, label placement. Prefer it whenever the subject is hardware or an algorithm, even when the user says "flowchart".

Photorealistic or 3D product renders, cutaways, exploded views and "product hero" images are out of scope: draw.io can't draw materials, lighting or camera views, and `prepare` refuses them. Don't produce one some other way (a 3D renderer, generated SVG art); tell the user what this skill can draw instead and offer a block diagram of the same system.

Labels follow the user's language; `prepare` takes care of it.

## Planned path

1. Run `dd prepare --description "<the user's request, verbatim>"`. Put a long request in a file and use `--description-file <file>`. It prints a prep ID and the path of an instructions file.
2. Read the whole instructions file. It holds the rules and the JSON schema of the spec: groups, nodes and edges, each with `origin` (`given` when the user said it, `assumed` when you added it), `evidence` (an exact quote of the user's words for `given` items, else empty) and `rationale`.
3. Write the spec JSON to a file, following those rules. Keep every fact the user gave, including counts, names, exclusions and conditions.
4. Run `dd compile --prep <id> --spec <spec.json>` (add `-o <name>.drawio` to choose the file name). On `spec_invalid`, fix the listed fields and run compile again with the same prep ID.
5. Review the result (see below).

To revise a planned diagram after feedback, change the spec and compile again. For a structural change the user asked for in words, `dd prepare --description "<original request>" --previous <compile-id> --feedback "<what to change>"` writes new instructions that carry the previous spec; compile prints its compile ID.

If compile says the layout engine couldn't lay the spec out, split it: one subsystem per diagram, or fewer nodes.

## Direct path

Write Mermaid or draw.io XML and convert it:

```bash
dd convert - -o login-flow.drawio <<'EOF'
flowchart TD
  A[Open login page] --> B{Credentials valid?}
  B -->|Yes| C[Dashboard]
  B -->|No| D[Show error]
  D --> A
EOF
```

`convert` reads a file or `-` (stdin, needs `-o`). It detects the format: `<mxGraphModel>`/`<mxfile>` is XML, `@startuml` is PlantUML, `#` lines followed by a comma-separated header are draw.io CSV, everything else is Mermaid. Force it with `-f xml|mermaid|plantuml|csv`.

- **Mermaid** converts offline for `flowchart`/`graph`, `sequenceDiagram` and `erDiagram` only. Read `references/mermaid-reference.md` first. Any other Mermaid type fails; write it as XML from the start.
- **XML**: read `references/xml-essentials.md` first. Every diagram needs `<mxCell id="0"/>` and `<mxCell id="1" parent="0"/>`, unique ids, no XML comments, and every edge needs a `<mxGeometry relative="1" as="geometry"/>` child. For layers, tables, metadata or dark mode also read `references/xml-reference.md`; `references/style-reference.md` lists every style key. Write `fontFamily=Helvetica;` in styles: `check` measures text in Helvetica.
- **Icons**: never guess `mxgraph.*` names. Look them up, one query per icon, narrowed by library: `dd search "aws4 lambda" "kubernetes pod" "azure2 functions"`. Use the style as printed, with its width and height.

`convert` repairs the usual slips (a code fence or text around the XML, an unescaped `&` or `<`) and says what it changed.

## Review every diagram

**1. Check.** Run `dd check <file.drawio>`. Fix every error and check again until there are none:

| Error | Fix |
|---|---|
| `overlap` | Move one shape, or enlarge their container |
| `text_overflow` | Widen or heighten the box, or shorten the label |
| `outside_container` | Move the shape inside, or enlarge the container |
| `dangling_edge` | Point the edge at an existing shape id |
| `route_failed` | The layout engine couldn't route a connection: simplify the spec around it and compile again |

Warnings are worth a look: a connection passing through an unrelated shape, a label the engine left out, a vendor shape the renderer only approximates.

Then compare the **contents list** `check` prints with the user's request: every module, state, tensor and connection they named, with the right direction, nothing they excluded, nothing invented without a reason. This catches what geometry can't: a wrong connection, a missing block, a reversed arrow.

**2. Look.** Run `dd render <file.drawio>` (writes a PNG next to it) and look at the image. Judge what checking can't: is the main point of the figure obvious, does the hierarchy read correctly, is the main flow easy to follow, are the important parts prominent? Vendor icons render as labelled dashed boxes here; that is the preview, not the file.

For a diagram with more than 15 shapes, or when the user asks for it, also do a blind read: give a subagent only the PNG and ask it to describe what the diagram shows. Compare its description with the request; a mismatch is a hierarchy or emphasis problem.

**3. Fix.** For position, size or style, edit the `.drawio` XML directly. For structure (a missing block, a wrong connection, a different grouping), change the spec (planned path) or the source (direct path) and build again. Then go back to step 1.

## Deliver

Name the file after its content, lowercase and hyphenated: `gpu-architecture.drawio`, `dma-fsm.drawio`. Give the user its path, say it opens in draw.io (web or Desktop) or the draw.io editor extensions, and mention anything you assumed. If they asked for an image, `dd render <file> -o <name>.png` (or `.svg`; `--scale` sets the PNG resolution, default 2).

## Setup notes

- The planned path needs Python 3.11+ with Pillow during this release: set `DRAW_DIAGRAM_PYTHON` to that interpreter if `python3` lacks Pillow. The direct path, `check` and `render` need only Node.
- `render` uses a local Chinese/Japanese/Korean font for those characters (found automatically; set `DRAW_DIAGRAM_CJK_FONT` to a font file otherwise). Without one they show as boxes in the image; the `.drawio` file is unaffected.
- `prepare` and `compile` keep their state in `.draw-diagram/` in the current directory.
