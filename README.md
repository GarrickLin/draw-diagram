# draw-diagram

一个本地运行的 Agent Skill：根据描述画出可编辑的 draw.io 图（`.drawio`），检查版面，并能渲染成 PNG 或 SVG。全程离线，只需要 Node.js 20+。

- 芯片和系统架构、算法数据流、状态机、时序图：由 [silicon-canvas](https://github.com/du-du-wang/silicon-canvas) 的规划和版面引擎排版（已移植成 JavaScript），再转换成 draw.io。
- 流程图、时序图、ER 图、组织结构图等：agent 写 Mermaid、PlantUML、CSV 或 draw.io XML，由 [drawio-mcp](https://github.com/jgraph/drawio-mcp) 的转换器生成。
- 渲染用 [diagram-render](https://github.com/nowmyagentcan/diagram-render) 编译成的 WASM。

用法见 `plugins/draw-diagram/skills/draw-diagram/SKILL.md`。

## 安装

下面的 `<owner>` 换成存放本仓库的 GitHub 用户名或组织名；如果仓库不叫 `draw-diagram`，斜杠后面也换成实际的仓库名。`@draw-diagram` 是插件市场的名字，写在仓库的清单里，和 GitHub 用户名无关。

**Claude Code**

```sh
claude plugin marketplace add <owner>/draw-diagram
claude plugin install draw-diagram@draw-diagram
```

在会话里也可以用 `/plugin marketplace add <owner>/draw-diagram` 和 `/plugin install draw-diagram@draw-diagram`；Claude Code 2.1.275 起可以一步完成：`/plugin install draw-diagram --marketplace <owner>/draw-diagram`。技能以 `/draw-diagram:draw-diagram` 调用，平时按描述自动加载。

**Codex**

```sh
codex plugin marketplace add <owner>/draw-diagram
codex plugin add draw-diagram@draw-diagram
```

**其他 agent（`npx skills`）**

```sh
npx skills add <owner>/draw-diagram
```

会询问装给哪些 agent；用 `-a claude-code`、`-a codex` 等直接指定。

**手动**：把 `plugins/draw-diagram/skills/draw-diagram` 整个目录复制到 agent 的 skills 目录（例如 `~/.claude/skills/`）。在本仓库里用 Claude Code 时不用安装，`.claude/skills/draw-diagram` 链接到这个技能。

发新版时同时改两个 `plugin.json` 的 `version`（`tests/draw-diagram/plugin.test.js` 会检查两者一致）；Claude Code 按版本号判断是否需要更新。

## 目录

| 路径 | 内容 |
| --- | --- |
| `plugins/draw-diagram/` | 插件：Claude Code 和 Codex 的清单（`.claude-plugin/`、`.codex-plugin/`），以及 `skills/draw-diagram/`，即随包分发的技能（SKILL.md、命令行、引擎、转换器、渲染器、NOTICE） |
| `.claude-plugin/`、`.agents/plugins/`、`skills.sh.json` | Claude Code 和 Codex 的插件市场清单，`npx skills` 的查找路径 |
| `tests/draw-diagram/` | skill 的测试，含 27 个规格的基准图（`golden/`），不需要 Python |
| `tests/port/` | JS 引擎和 CPython 原版的对照测试，需要参考环境，见 `tools/port/README.md` |
| `tests/upstream/silicon-canvas/` | 测试用的上游规格文件（原样复制，MIT） |
| `tools/port/` | silicon-canvas 的 Python 源码、Python → JS 转译器、第一阶段的 Python 桥 |
| `tools/diagram-render-wasm/` | 把 diagram-render 编译成 WASM 的补丁和脚本 |
| `tools/widths/` | 生成字宽表 `data/widths.json` 的脚本 |
| `docs/` | 只在本地：需求、实现计划和上游参考仓库（`prds/`、`plans/`、`refs/`），都不进 git |

## 测试

```sh
npm test               # skill 的测试，只需要 Node
npm run test:port      # 和 CPython 对照，需要 Python 3.14 + Pillow
npm run build:engine   # 改了 tools/port 下的源码或转译器后，重新生成引擎
```

## 许可

各部分沿用上游的许可（drawio-mcp 和 diagram-render 是 Apache-2.0，silicon-canvas 是 MIT，Liberation 字体是 OFL-1.1），详见 `plugins/draw-diagram/skills/draw-diagram/NOTICE`。
