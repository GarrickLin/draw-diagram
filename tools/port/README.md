# tools/port：silicon-canvas 从 Python 到 JavaScript 的移植

draw-diagram 的版面引擎来自 silicon-canvas（Python）。第二阶段把它转成 JavaScript，技能运行时只需要 Node。
这里放的是转换用的源码、工具和 Python 参考实现，不随技能分发。

## 目录

| 路径 | 内容 |
| --- | --- |
| `silicon/` | silicon-canvas 的 Python 源码（上游提交见 `UPSTREAM`），带 `silicon.patch` 的两处改动：测宽改用 `data/widths.json` |
| `modules.txt` | 转换的 24 个模块；其余模块（MCP、浏览器桥、打包等）draw-diagram 用不到 |
| `transpile.py` | Python → JS 转译器。只接受这些模块用到的语法，遇到别的语法直接报错，不会猜 |
| `build_engine.sh` | 重新生成 `plugins/draw-diagram/skills/draw-diagram/scripts/lib/engine/silicon/`：转译 24 个模块，复制 `catalog.json`、`reference_images/` 和 LICENSE |
| `gen_titlecase.py` | 生成运行时的 Unicode 标题大小写表（`lib/engine/py/titlecase.js`） |
| `bridge.py` | 第一阶段的 Python 桥，现在只作对照的参考答案 |

运行时在技能里：`lib/engine/py/`（Python 语义）、`lib/engine/fast/`（手写的快速路径）、`lib/engine/js.js`（对应 `bridge.py`）。

## 改了 silicon 源码或转译器之后

```sh
tools/port/build_engine.sh            # 重新生成引擎
node --test tests/draw-diagram/*.test.js   # 技能测试，不需要 Python
node --test tests/port/*.test.js           # 和 CPython 对照，需要参考环境
```

`tests/port/reference.test.js` 会检查已提交的生成代码是不是转译器当前的输出，忘了重新生成会失败。

## 参考环境

对照用的 CPython 是 3.14，装 Pillow：环境变量 `DRAW_DIAGRAM_PYTHON`，默认 `~/.cache/draw-diagram/venv/bin/python`。

```sh
python3.14 -m venv ~/.cache/draw-diagram/venv
~/.cache/draw-diagram/venv/bin/pip install pillow
```

没有参考环境时，`tests/port` 里需要它的测试会跳过；`runtime.test.js` 的定点检查照常运行。

## 一致到什么程度

JS 引擎对同一请求给出和 `bridge.py` 逐字节相同的 JSON（`js.js` 的 `respond()`）。为此运行时复刻了这些 CPython 行为：

- **集合遍历顺序**：`pyset.js` 移植了 `Objects/setobject.c` 的哈希表，包括探测、扩容，以及并、交、差、对称差各自的填表顺序；常量集合字面量按 CPython 编译后的方式构造（先建 frozenset 常量，再合并）。
- **哈希**：整数、浮点、元组、frozenset 按 CPython 的算法；字符串用 SipHash-1-3，密钥取 `PYTHONHASHSEED=0` 时的值。所以 JS 引擎等同于“CPython 在种子 0 下运行”。上游有少数代码依赖字符串集合的遍历顺序，那些结果在 CPython 里本身就随种子变化，JS 固定取种子 0 的结果。对照时 Python 也用种子 0 运行；注意 `-I` 会忽略 `PYTHONHASHSEED`，所以对照脚本改用 `-s -P`。
- **数字**：区分 int 和 float（整数值的浮点数用 `PyFloat` 表示）；`repr`、`round`、格式化都按二进制精确值、逢五取偶舍入；int 不会出现 `-0`；浮点的 `//`、`%` 按 `_float_div_mod` 计算；`sum` 用 Neumaier 求和；`math.dist`/`hypot` 移植了 `vector_norm`。
- **其他**：`json.dumps` 的各种参数、`re` 的 Unicode `\w`/`\d`/`\b` 和 `$` 语义、`heapq` 同一算法、字典视图的集合运算、`str.title` 的标题大小写。

已知边界（遇到时报错，不会悄悄算错）：

- int 只能精确到 2^53。运算结果超出 JS 数字能精确表示的范围时抛 `OverflowError`；`hash()` 的值超出时抛 `NotImplementedError`。silicon 的计算远小于这个范围。
- 转译器不认识的语法在转译时报错；silicon 调用的每个方法名都有实现，由 `tests/port/methods.test.js` 检查。

## 快速路径

通用转译代码每一步都走 Python 语义函数，在热循环里很慢。`structure_scene` 里的网格寻路 `astar` 有手写版本（`lib/engine/fast/structure_scene.js`）：在普通数字上计算，堆的比较规则和 `heapq` 一致，读到的集合按修改计数缓存成 JS 结构。坐标不是整数等情况会退回通用版。转译器在 `transpile.py` 的 `FAST` 表里登记它，生成的代码把通用版作为参数传进去。

`tests/port/fast.test.js` 用 silicon 源码里原版的 `astar` 在随机网格上生成参考路径，要求完全一致；`DRAW_DIAGRAM_FAST=0` 可以强制走通用版。最慢的规格从 23.5 秒降到 1.7 秒，比 CPython 的 2.8 秒还快。

## 对照测试

| 测试 | 对照什么 |
| --- | --- |
| `parity.test.js` / `parity.mjs` | 55 个规格的中英文版本、随机变体（删点、删边、改标签、破坏性改动）和修改流程，同一请求交给 CPython 和 JS，比较输出字节 |
| `programs.test.js` / `programs/` | 7 个小程序（集合、数字、字符串、正则、JSON、容器、控制流）转译后和 CPython 比较每一项的 `repr` |
| `fast.test.js` | 快速 `astar` 和原版在 900 个随机网格上的路径 |
| `methods.test.js` | silicon 调用的方法名都有实现 |
| `reference.test.js` | 生成代码和字宽表是最新的；Python 引擎测宽和 `text-width.js` 一致 |
| `runtime.test.js` | 不需要 CPython 的定点检查（哈希值、集合顺序、负零、浮点格式） |

更大规模的对照可以直接运行脚本，例如 `node tests/port/parity.mjs --variants 12 --seed 10`。
