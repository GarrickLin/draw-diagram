# Mermaid Reference

Hints for the three Mermaid types this skill converts offline: **flowchart** (`flowchart` / `graph`), **sequenceDiagram** and **erDiagram**. Any other Mermaid type fails to convert; write those diagrams as draw.io XML instead (`xml-essentials.md`).

Trimmed from draw.io's shared Mermaid reference (Apache-2.0).

## General rules

- **Start with the type keyword:** `flowchart TD` / `flowchart LR` (or `graph`), `sequenceDiagram`, `erDiagram`. A misspelled keyword is an error.
- **No trailing punctuation on node IDs.** IDs are identifiers (`myNode`, `node_1`, `A`) — spaces, hyphens (in some contexts), and reserved words (`end`, `class`, `subgraph`) break the parse. Put display text in brackets or quotes instead: `A["User's Account"]`.
- **One statement per line.** Separate statements with newlines; `;` works as a delimiter in flowchart but not everywhere.
- **Quote labels with special characters** (`:`, `-`, parentheses, non-ASCII). Use `"` not `'`.
- **HTML in labels:** only `<br>`, `<b>`, `<i>`, `<u>` are reliable across types. Use `#` for hex colors in styles, never `rgb()`.
- **Diagrams can take a title block** at the very top:
  ```
  ---
  title: My Diagram
  ---
  flowchart TD
    A[Start] --> B[End]
  ```
- **Match the language of labels to the user's language** — if the user writes in German, French, etc., the diagram labels should be in that language too.


## Flowchart (most common)

```
flowchart TD
  A[Start] --> B{Decision?}
  B -->|Yes| C[Do thing]
  B -->|No| D[Skip]
  C --> E((End))
  D --> E
```

- **Direction:** `TD`/`TB` (top-down), `BT`, `LR`, `RL`.
- **Node shapes by bracket:** `[rect]`, `(rounded)`, `([stadium])`, `[[subroutine]]`, `[(cylinder)]`, `((circle))`, `{rhombus}`, `{{hexagon}}`, `[/parallelogram/]`, `[\parallelogram alt\]`, `[/trapezoid\]`, `>asymmetric]`.
- **Edges:** `-->` arrow, `---` no arrow, `-.->` dotted, `==>` thick, `<-->` bidirectional. Inline label: `A -- text --> B` or `A -->|text| B`.
- **Subgraphs:**
  ```
  subgraph Frontend
    A --> B
  end
  ```


### Styling & colors

**Color by role.** Unstyled flowcharts and state diagrams come out in Mermaid's default lavender. Give each kind of node one color with `classDef`, from draw.io's calm palette (fill/stroke, with `color:#1B1F24` for the text): blue `#EEF4FF`/`#9DB8F2` for main steps, green `#E7F6EC`/`#8BCB9F` for start, end and success, yellow `#FFF6E0`/`#E8C36A` for decisions, orange `#FFF0E5`/`#F0B48A` for retries and waiting, red `#FDECEC`/`#EBA3A3` for errors and cancellation, purple `#F3EEFF`/`#B9A6F0` for data and storage, gray `#F2F4F7`/`#B8C0CC` for external systems; edges `linkStyle default stroke:#8A94A6`. For draw.io's classic colors, when asked: blue `#dae8fc`/`#6c8ebf`, green `#d5e8d4`/`#82b366`, yellow `#fff2cc`/`#d6b656`, orange `#ffe6cc`/`#d79b00`, red `#f8cecc`/`#b85450`, purple `#e1d5e7`/`#9673a6`. The same color for the same kind of node, and few colors: two to four roles read better than a rainbow.

Three ways — pick one, don't mix for the same node:

**1. Inline per-node (`style`):**
```
flowchart LR
  A[Start] --> B[End]
  style A fill:#E7F6EC,stroke:#8BCB9F,stroke-width:2px
  style B fill:#FDECEC,stroke:#EBA3A3,stroke-dasharray:5 5
```

**2. Reusable classes (`classDef` + `:::`):**
```
flowchart LR
  A:::step --> B{OK?}:::decision
  classDef step fill:#EEF4FF,stroke:#9DB8F2,color:#1B1F24
  classDef decision fill:#FFF6E0,stroke:#E8C36A,color:#1B1F24
```
Or apply to many: `class A,B,C step`.

**3. Link styling (edges):**
```
linkStyle 0 stroke:#C9302C,stroke-width:2px
linkStyle default stroke:#8A94A6
```
`0` = first edge in order defined; `default` targets unstyled edges.

Style properties that work: `fill`, `stroke`, `stroke-width`, `stroke-dasharray`, `color` (font color).

## Sequence diagram

```
sequenceDiagram
  participant U as User
  participant S as Server
  U->>S: Request
  S-->>U: Response
  Note right of S: Logged
```

- **Arrows:** `->` (no head), `->>` (arrow), `-->>` (dashed), `-x` (X end), `--x` (dashed X).
- **Activate/deactivate:** `activate S` / `deactivate S` or `S->>+S2: call` / `S2-->>-S: return`.
- **Blocks:** `alt/else/end`, `opt/end`, `loop/end`, `par/and/end`, `critical/option/end`.
- **Notes:** `Note left of A`, `Note over A,B: text`.
- Optional `autonumber` after header numbers the messages.


## ER diagram

```
erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE-ITEM : contains
  CUSTOMER {
    string name
    string email PK
  }
```

- **Cardinality symbols:** `|o` zero-or-one, `||` exactly-one, `}o` zero-or-many, `}|` one-or-many. Mirror on both sides (e.g., `||--o{`).
- Attribute blocks list `type name [PK|FK|UK]` plus optional comment in quotes.
- Entity names are typically UPPERCASE by convention.


## When to use XML instead

- Any diagram type other than flowchart, sequence and ER: class, state, network, mind map, timeline, gantt, C4, …
- draw.io-native shapes (AWS, Azure, GCP, Kubernetes, Cisco, P&ID): look them up with the skill's `search` command.
- Precise positions, mixed shape libraries, multi-layer diagrams.
- A flowchart that the automatic layout makes cramped (many decisions, loops back): place it on the XML grid yourself.
