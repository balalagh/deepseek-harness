---
description: "面向模型的五个艺考招生查询工具（政策矩阵、投档明细、校考院校名单、可报考专业目录、招生模式总览），查同一份部署提供的数据集文件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-art-query

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-tool-art-query` 注册五个只读工具，用来回答艺术类高考招生问题：`query_art_policy_matrix`、`query_admission_detail_2026`、`query_school_exam_list`、`query_major_catalog`、`query_admission_mode_overview`。五个工具都读 `Config.dataPath` 指向的一份 JSON 数据集——包内不携带数据，因为数据集是随部署变化、由本地招生工作簿派生出来的部署数据。数据集在第一次调用时载入，之后按文件 mtime 失效，因此重新生成数据集不需要重启进程。筛选在内存里完成：有分值的行按投档最低综合分降序，返回行数由 `Config.maxRows` 截断，同时报告命中总数。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把这一行挂在已经挂载 `ctx.tools` 的 agent preset 或组合里，并指明工具要读的数据集：

```yaml
- id: tool-art-query
  name: '@deepseek-ai/dsh-tool-art-query'
  config:
    dataPath: /absolute/path/to/art-tools.json
    maxRows: 200
```

`dataPath` 没有默认值且必填：数据集是部署数据，文件缺失或结构不对时，第一次调用就会带出指明该文件的错误，而不是从空表里作答。`maxRows` 默认为 200。

### 生成数据集

数据集由与本 README 同级的脚本从招生工作簿生成（脚本不进发布的 tarball，因为它需要 Python 与 `openpyxl`）：

```sh
python scripts/convert_art_xlsx.py --xlsx /path/to/艺考类.xlsx --out /absolute/path/to/art-tools.json
```

脚本写出五个顶层数组——`policy_matrix`、`admission_detail`、`school_exam`、`major_catalog`、`admission_mode_overview`——外加 `meta`，记录源文件路径、生成时间、导出的年份，以及所有被归一为 `其他` 的原始科类写法。空单元格写成 `null`；投档明细的九个数值列转成数值；`院校代码` 保持字符串，因为它是标识。

### 各工具能回答什么

| 工具 | 必填参数 | 可选参数 |
|---|---|---|
| `query_art_policy_matrix` | `province` | — |
| `query_admission_detail_2026` | `year`、`province` | `category`、`school_name`、`admission_min_score`、`admission_max_score` |
| `query_school_exam_list` | — | `school_province`、`school_name` |
| `query_major_catalog` | — | `exam_category` |
| `query_admission_mode_overview` | — | — |

`category` 既接受数据集里的原始科类写法，也接受归一的七个统考类别（`美术与设计类`、`音乐类`、`舞蹈类`、`表(导)演类`、`播音与主持类`、`书法类`、`戏曲类`）；传类别名会覆盖该类别下的全部方向，例如 `音乐类` 下的音乐表演与音乐教育。`school_name`、`school_province`、`exam_category` 按包含匹配，因此传部分名称即可。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件本体：`Config`、数据集载入、五个 `defineTool` 注册、各工具的筛选与渲染 |
| [`scripts/convert_art_xlsx.py`](scripts/convert_art_xlsx.py) | 工作簿 → 数据集转换、科类归一与 `meta` 记录 |
| — | 不发布运行时 invariant 伴生模块：本包不拥有任何服务或生命周期流，唯一状态是懒加载的数据集，工具结果由注册表拥有。 |

### 数据集边界

数据集文件是持久化边界，因此解析出的文档在使用前先过 `schemastery` 校验：五个数组必须存在；每次读行字段都归一成声明的类型（`string`、`number` 或 `null`）——字段类型不对时读作缺失，而不是在注册表那里让输出 schema 报错。载入以 mtime 为键，所以同一进程里重新生成的数据集会被下一次调用读到。

### 筛选与排序

行按省份名（精确或包含）、归一类别、院校名包含、投档最低综合分闭区间筛选。`query_admission_detail_2026` 随后按投档最低综合分降序，缺分值的行排在最后，并在截断返回行的同时报告完整命中数。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-art-query) — 五个工具的生成 schema。
- [Gaokao 组地图](../README.zh.md) — 同组的数据服务托管行与高考查询工具。
- [Adding a tool](../../../docs/cookbook/adding-a-tool.zh.md) — 本包遵循的工具契约。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到的内容

模型看到的是[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-art-query)里链接的五个生成 schema：工具名、带数组/标量类型的参数名，以及说明有哪些筛选、各返回什么的描述。数据集内容在调用之前对模型不可见。

#### Token 影响

工具可见时每次请求的固定 schema 成本，其中描述占大头。结果带来数据量相关的常驻 token——截断后的投档明细表是最宽的一项。

#### KV Cache 影响

定义与可见性不变时前缀稳定。重新生成数据集不改变 schema，因此不会让请求前缀失效。

### 工具调用历史与结果

#### 模型看到的内容

参数留在 assistant 的 tool-call arguments 里。结果是单个文本块：一行写明筛选范围，一行给出命中数与返回数（含截断提示），随后每行一条记录、字段顺序固定。缺失字段渲染为 `（未收录）` 而不是空格，避免被读成 0 或空串。

#### Token 影响

数据量相关的常驻 token；`maxRows` 限定了结果的最大规模。

#### KV Cache 影响

仅追加：结果跟在可复用的请求前缀之后，不会让既有 KV Cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了工具不适合的场景，是当前的包约束，不是待办清单。

- **数据集是部署数据、必须先生成** —— 包内不带数据且 `dataPath` 无默认值，因此新部署在转换脚本跑过之前，schema 可用而调用失败。
- **转换脚本需要 Python 与 `openpyxl`** —— 它刻意不在发布的 `files` 里，也不在 Node 侧任何门禁内；工作簿格式变化靠重跑脚本发现，而不是靠测试。
- **`query_admission_detail_2026` 只接受数据集携带的年份** —— 请求其它年份会报错并指明支持的年份，而不是返回工作簿里另一年份的部分数据。
- **科类归一基于关键词** —— 七个类别来自折半角括号后的关键词匹配，匹配不上的写法落入 `其他`；`meta.categoriesUnmapped` 会列出这些值，使新写法在数据集里可见而不是被静默归档。
- **院校、省份、类别按包含匹配** —— 传过短的值（如 `大学`、`音乐`）会匹配过宽，判断力在调用方。
- **行内容是归一而非校验** —— 文档结构在载入时校验，但字段类型异常只读作缺失，不会让调用失败。
- **截断的结果报告真实命中数，但不给出被省略的行** —— 只有收窄筛选条件才能看到它们。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

数据集用「一份外部 JSON 快照」而不是「常驻数据库服务」的决定，记录在 [art-query 工具包 Agent Note](../../../.agents/notes/implemented/feature/2026-09-30-art-query-tool-package.zh.md)，其中也写明另一条路（再起一个 FastAPI 服务读工作簿）的代价。

</details>
