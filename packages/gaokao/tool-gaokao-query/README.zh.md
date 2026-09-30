---
description: "面向模型的高考查询工具（省份控制线、院校录取数据、一分一段表、志愿填报规则），经由本地 gaokao-api HTTP 服务取数。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-gaokao-query

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-tool-gaokao-query` 注册四个只读工具，从部署自己的招生数据库回答高考问题：`query_province_control_line`、`query_college_admission_data`、`query_yifenyiduan`、`query_province_rule`。四个工具都很薄：构造一次指向 `Config.apiUrl` 所指定服务的 HTTP GET，透传调用方的筛选条件，再渲染解码出的行。它不持有数据也不持有数据库凭据，因此连接池、表结构与查询规划都属于服务——通常就是同组的 [`gaokao-api`](../gaokao-api/README.zh.md) 行。

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

凡模型应当能查询本部署招生数据的场景，都把它挂在启动服务的那一行旁边：

```yaml
- id: tool-gaokao-query
  name: '@deepseek-ai/dsh-tool-gaokao-query'
  config:
    apiUrl: http://127.0.0.1:8901
```

`apiUrl` 默认为 `http://127.0.0.1:8901`，即服务的默认监听地址。装载这些工具不需要别的条件：注册阶段不发任何请求；服务不可达或拒绝请求时，调用会带出服务的状态码与响应体。

### 各工具能回答什么

| 工具 | 必填参数 | 可选参数 |
|---|---|---|
| `query_province_control_line` | `province` | `year`（默认 2025） |
| `query_college_admission_data` | `exam_province`、`subject`、`college_major_group` | `school_province`、`school_city`、`school_name`、`year`、`major_name`、`parsed_major_name`、`major_category`、`sino_foreign`、`admission_score_min`、`admission_score_max`、`admission_rank_min`、`admission_rank_max`、`fields` |
| `query_yifenyiduan` | `province`、`year`、`subject_combination`、`score` | — |
| `query_province_rule` | `province`、`year` | — |

多值筛选是逗号分隔的字符串（`school_name: "A,B"`）；`fields` 决定回答携带哪些列，渲染出的表格始终保留标识列与分数列。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件本体：`Config`、共用的 HTTP 客户端、四个 `defineTool` 注册及其输出 schema 与渲染 |
| — | 不发布运行时 invariant 伴生模块：本包不拥有服务、生命周期或持久状态——它只把参数翻译成一次请求，再把解码结果翻译成文本。 |

### 请求路径

每个工具把参数映射到一条端点路径（`/api/province-control-line`、`/api/college-admission`、`/api/score-segment`、`/api/province-fill-rule`），并透传调用方的 `exec.signal`。非 2xx 响应会带着状态码与响应体抛错，使模型看到服务自己的诊断，而不是一张空表。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-gaokao-query) — 四个工具的生成 schema。
- [gaokao-api](../gaokao-api/README.zh.md) — 这些工具所调用的服务托管行。
- [Gaokao 组地图](../README.zh.md) — 同组中以数据集为后端的艺考工具。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到的内容

模型看到的是[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-gaokao-query)里链接的四个生成 schema：工具名、带类型的参数名，以及点明各筛选条件的描述。服务背后的数据在调用之前对模型不可见。

#### Token 影响

工具可见时每个请求的固定 schema 成本。`query_college_admission_data` 的 schema 最大，因为它的筛选集最宽。

#### KV Cache 影响

定义与可见性不变时前缀稳定；服务侧数据变化不影响请求前缀。

### 工具调用历史与结果

#### 模型看到的内容

参数留在 assistant 的 tool-call arguments 里。结果是单个文本块：一行写明筛选条件的查询行、命中数、列头，以及每行一条记录。服务不可达或请求被拒时以错误形式到达，并携带服务的状态码与响应体。

#### Token 影响

数据量相关的常驻 token，规模取决于服务返回多少行——本包不做任何截断。

#### KV Cache 影响

仅追加：结果跟在可复用的请求前缀之后，不会让既有 KV Cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了工具不适合的场景，是当前的包约束，不是待办清单。

- **调用时必须有一个可达的服务** —— 工具不持有兜底数据，因此没启动 `gaokao-api`（或 `apiUrl` 上的等价服务）的部署会出现「schema 可用、调用失败」。
- **数据正确性、新鲜度与行数上限由服务负责** —— 本包只透传筛选并渲染回答，无法对服务返回的内容做截断、分页或修补。
- **多值筛选是逗号分隔的字符串** —— 含逗号的值无法表达。
- **`fields` 只能选服务支持的列** —— 未知字段名由服务负责报错。
- **`query_college_admission_data` 必填投档模式** —— 调用方必须知道该部署按院校专业组（`1`）还是专业+院校（`0`）投档。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本包随 `gaokao-api` 托管行的改动一起加入，最初没有 README；同组数据集型工具包的决定记录在 [art-query 工具包 Agent Note](../../../.agents/notes/implemented/feature/2026-09-30-art-query-tool-package.zh.md)。

</details>
