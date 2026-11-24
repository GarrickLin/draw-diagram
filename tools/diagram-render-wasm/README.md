# diagram-render-wasm

diagram-render 的 draw.io 渲染器编译成 WASM，供 draw-diagram skill 在 Node 里加载，不需要浏览器，也不需要各平台的二进制。

- 上游：https://github.com/nowmyagentcan/diagram-render ，提交 `55eb15b`，Apache-2.0
- `wasm.patch`：相对上游的改动
- `build.sh`：拉取上游、打补丁、编译，产物 `dist/diagram_render.wasm`（约 3.3MB，gzip 后 1.1MB）
- `render-wasm.mjs`：零依赖的 Node 加载器和命令行

## 补丁改了什么

| 文件 | 改动 |
|---|---|
| `Cargo.toml` | 新增库目标（cdylib）；MCP 相关依赖（rmcp、tokio、schemars）和 resvg 的系统字体特性只在非 wasm 平台启用 |
| `src/lib.rs` | 新增，库的模块树，去掉了命令行、MCP、本地网页这些模块 |
| `src/wasm.rs` | 新增，导出给 Node 的 C ABI |
| `src/raster.rs` | 字体改为按字节加载；wasm 下随包字体和系统字体都由宿主传入 |
| `src/leash.rs` | 补上 wasm 的空实现（wasm 里不启动子进程） |
| `src/excalidraw/text.rs` | 系统字体改为调用 `raster::load_system` |

原生命令行在补丁后仍能编译，输出和官方二进制逐字节一致。

## 导出接口

| 导出 | 说明 |
|---|---|
| `alloc(len)` / `dealloc(ptr, len)` | 宿主写入数据用的内存 |
| `add_font(kind, ptr, len)` | `kind` 0：随包的 8 个 Liberation 字体，按固定顺序；1：额外字体，只用于随包字体没有的字符（中文等） |
| `render(ptr, len, to, scale, page_ptr, page_len)` | `to` 0 为 SVG，1 为 PNG；`scale` 传 0 表示默认 2；返回 0 成功，1 失败 |
| `check(ptr, len, page_ptr, page_len)` | 只检查不出图 |
| `out_ptr()` / `out_len()` | 上一次调用的输出（SVG 或 PNG 字节） |
| `meta_ptr()` / `meta_len()` | 上一次调用的 JSON 报告，字段与命令行 `--json` 一致 |

WASM 内部不读文件、不读时钟、不联网。

## 验证结果

- 7 个 `.drawio` 文件各出 SVG 和 PNG，共 14 个输出，和官方 Linux 二进制逐字节一致。中文图需要传入和官方二进制在本机选中的同一款字体。
- 连续渲染 300 次 PNG，WASM 内存稳定在 11.2MB，平均每次 10ms。
- 坏 XML、非 drawio 文件返回带行号的错误；`check` 能报出悬空连线。

## 中文字体

WASM 拿不到系统字体，中文要由宿主找到字体文件后用 `add_font(1, …)` 传入，否则汉字显示成方框（版面和连线不受影响）。各平台的常见位置：

| 平台 | 字体 |
|---|---|
| Linux | `fc-match -f '%{file}' 'sans-serif:lang=zh-cn'` 的结果 |
| macOS | `/System/Library/Fonts/PingFang.ttc` |
| Windows | `C:\Windows\Fonts\msyh.ttc` |

## 许可

上游是 Apache-2.0。分发产物时要附上上游的 LICENSE 和 NOTICE，并说明上表中的文件被修改过。随包的 Liberation 字体是 OFL 许可。
