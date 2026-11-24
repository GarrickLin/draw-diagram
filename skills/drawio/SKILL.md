---
name: drawio
description: "Use when the user asks to create, generate, draw or design a diagram, flowchart, architecture diagram, ER diagram, sequence diagram, network diagram, org chart or swimlane, or mentions draw.io, drawio or .drawio files. Produces an editable .drawio file locally, offline, with no draw.io Desktop and no browser."
---

# draw.io Diagram Skill

Write the diagram as Mermaid or draw.io XML, then convert it into a native `.drawio` file with this skill's script. The script runs offline on Node.js 20+, with no npm install, no browser and no network. The result opens in draw.io (web or Desktop) and the draw.io editor extensions, where every shape and connector can be edited.

The output is always a `.drawio` file. This skill does not export PNG, SVG or PDF. If the user asks for an image, make the `.drawio` file and tell them they can export it from draw.io (File → Export as).

## Mermaid or XML?

| Author as | Use for |
|---|---|
| **Mermaid** | Flowcharts, sequence diagrams and ER diagrams. The script lays them out for you. |
| **XML** | Everything else: class, state, network, cloud architecture with vendor icons, mockups, custom styling, exact positions. |

Only these Mermaid types convert offline: `flowchart` / `graph`, `sequenceDiagram` and `erDiagram`. Any other Mermaid type (`classDiagram`, `stateDiagram`, `gantt`, `mindmap`, `timeline`, `C4…`, …) fails with an error. Write those as XML from the start rather than trying Mermaid first.

PlantUML (sequence and activity diagrams in the new syntax) and draw.io CSV also convert, for users who already have them.

Match the labels to the user's language.

Before writing Mermaid, read `references/mermaid-reference.md`: the syntax of the three supported types, node shapes and styling with `classDef`, `style` and `linkStyle`.

## Make the file

`<skill-dir>` below is the folder this SKILL.md is in.

Pass the source on stdin with a heredoc, so no intermediate file is left behind:

```bash
node <skill-dir>/scripts/drawio.js convert - -o login-flow.drawio <<'EOF'
flowchart TD
  A[Open login page] --> B{Credentials valid?}
  B -->|Yes| C[Dashboard]
  B -->|No| D[Show error]
  D --> A
EOF
```

Or convert an existing file; the output defaults to the same name with `.drawio`:

```bash
node <skill-dir>/scripts/drawio.js convert schema.mmd
```

The format is detected from the text: `<mxGraphModel>` or `<mxfile>` is XML, `@startuml` is PlantUML, `#` configuration lines followed by a comma-separated header are draw.io CSV, and everything else is read as Mermaid. Plain CSV without `#` lines needs `-f csv`. `-n` sets the page name.

On success the script prints one line, `<absolute path>: <type>`, followed by any warnings, and exits 0. Read the warnings: they name what was drawn differently from the source (a shape drawn as a box, a Mermaid theme that was ignored) and what the XML repair changed.

On failure it exits 1 and prints the reason. A Mermaid syntax error names the line and the fix, for example:

```
Mermaid syntax error on line 2 (`A -->`): the link `-->` has no node after it. Fix: write the node it points to after the link, e.g. `A --> B`.
```

Fix the source and run it again. Exit code 2 means the command itself was wrong.

## XML

Read `references/xml-essentials.md` before writing XML. It is short and covers most diagrams: the skeleton, vertex and edge templates, labels, the layout grid, containers and swimlanes.

Read `references/xml-reference.md` only when the diagram needs layers, tables, metadata, placeholders, cross-functional grids or dark-mode colors. It was written for the draw.io MCP servers; ignore what it says about their tools and parameters (`search_shapes` is the `search` command below; `postLayout` and `routing` do not exist here, so place shapes on the grid from xml-essentials). `references/style-reference.md` lists every style key, for when a specific look is needed.

Rules that matter most:

- The skeleton is `<mxGraphModel adaptiveColors="auto"><root><mxCell id="0"/><mxCell id="1" parent="0"/>…</root></mxGraphModel>`. Without cells `0` and `1` the page is blank, and the script refuses the XML.
- Every `id` is unique. No XML comments.
- Every edge has a child `<mxGeometry relative="1" as="geometry"/>`. A self-closing edge cell doesn't render.
- Cells inside a container use `parent="<container id>"` with coordinates relative to it. An edge's parent is the innermost container that holds both its ends, otherwise `1`.

You don't need to write `<mxfile>` around the model; the script adds it. It also repairs the usual slips before writing the file: text or a code fence around the XML, an unescaped `<` or `&` in an attribute value, the default layer written as its own parent.

## Shapes and icons

For cloud, network or brand icons (AWS, Azure, GCP, Kubernetes, Cisco, GitHub, …), never guess `mxgraph.*` style names. Look them up, one query per icon, all in one call:

```bash
node <skill-dir>/scripts/drawio.js search "aws4 lambda" "aws4 s3" "kubernetes pod" "github"
```

Each query prints a `# query` line, then one tab-separated `title  width×height  style` line per match. Put the style into the cell's `style` attribute as it is, and use the width and height for its geometry. Narrow a query with the library as its first word: `aws4`, `azure2`, `gcp2`, `cisco19`, `kubernetes`, `bpmn`, `uml`. `(weak match)` after the query means no shape matched every word; check that the titles fit before using one. `(no match)` means the library has nothing for it: use a plain labelled shape.

The search runs against a local copy of draw.io's shape index, so it finds the built-in library shapes only. Brand logos that are not in a library are not available offline.

## Naming and opening

Name the file after its content, lowercase and hyphenated: `login-flow.drawio`, `order-schema.drawio`. Write it in the user's working directory unless they asked for another place.

After it is written, give the user the path. If they want it opened, try `xdg-open` (Linux), `open` (macOS) or `start ""` (Windows); if that fails, the path is enough.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `"classdiagram" diagrams cannot be converted offline` | Mermaid type outside flowchart / sequence / ER | Write the diagram as XML |
| `"…" is not a Mermaid diagram type` | Misspelled or missing Mermaid header, or CSV without `#` lines | Fix the header the error suggests, or pass `-f csv` |
| `missing the root cells` | XML without `<mxCell id="0"/>` and `<mxCell id="1" parent="0"/>` | Add them at the start of `<root>` |
| `SyntaxError: Cannot use import statement` | Node older than 20, or `scripts/package.json` missing | Use Node 20+; keep `scripts/package.json` next to `drawio.js` |
| Diagram opens but edges are missing | Self-closing edge cells | Give every edge an `<mxGeometry relative="1" as="geometry"/>` child |
