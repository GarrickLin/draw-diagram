# draw-diagram

一个本地运行的 Agent Skill：根据描述画出可编辑的 draw.io 图（`.drawio`），检查版面，并能渲染成 PNG 或 SVG。全程离线，只需要 Node.js 20+。

- 芯片和系统架构、算法数据流、状态机、时序图：由 [silicon-canvas](https://github.com/du-du-wang/silicon-canvas) 的规划和版面引擎排版（已移植成 JavaScript），再转换成 draw.io。
- 流程图、时序图、ER 图、组织结构图等：agent 写 Mermaid、PlantUML、CSV 或 draw.io XML，由 [drawio-mcp](https://github.com/jgraph/drawio-mcp) 的转换器生成。
- 渲染用 [diagram-render](https://github.com/nowmyagentcan/diagram-render) 编译成的 WASM。

用法见 `skills/draw-diagram/SKILL.md`。在本仓库里用 Claude Code 时，`.claude/skills/draw-diagram` 链接到这个 skill，会自动加载；要装到别处，把 `skills/draw-diagram` 整个目录复制到对应的 skills 目录即可。

## 目录

| 路径 | 内容 |
| --- | --- |
| `skills/draw-diagram/` | 随包分发的 skill：SKILL.md、命令行、引擎、转换器、渲染器，以及 NOTICE |
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

各部分沿用上游的许可（drawio-mcp 和 diagram-render 是 Apache-2.0，silicon-canvas 是 MIT，Liberation 字体是 OFL-1.1），详见 `skills/draw-diagram/NOTICE`。
