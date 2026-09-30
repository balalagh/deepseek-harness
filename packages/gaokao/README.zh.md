---
description: "升学数据域的包地图：本地数据服务托管行，以及经由它取数的模型侧招生查询工具。"
kind: "package-group"
---

# gaokao/ — 升学数据域

[English](README.md) | 中文

## 概述

`gaokao/` 组承载某个部署的升学数据平面：一行负责拉起并托管本地 Python 数据服务的 host 行，以及从部署数据回答招生问题的模型侧工具。当一个部署需要用它自己的数据回答高考或艺术类高考问题时使用它：host 行拥有服务进程与健康检查，每个工具包拥有一个查询面及其模型可见契约。数据本身从不放在这个组里——服务读自己的数据库，数据集型工具读部署配置的文件。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

每个包的 README 拥有完整的契约。

| 包 | 作用 | ctx key |
|---|---|---|
| [`gaokao-api/`](gaokao-api/README.zh.md) | 通过 `ctx.subprocess` 拉起、健康检查并托管本地 FastAPI 数据服务；已在回答的服务直接复用而不接管 | 无（派生并拥有子进程） |
| [`tool-gaokao-query/`](tool-gaokao-query/README.zh.md) | 在该服务的 HTTP 端点上暴露高考查询工具 | 注册到 `ctx.tools` |
| [`tool-art-query/`](tool-art-query/README.zh.md) | 在部署提供的数据集文件上暴露艺术类高考查询工具 | 注册到 `ctx.tools` |

-----

<a id="related-documentation"></a>
## 相关文档

- [工具目录](../../docs/tool-catalog.zh.md) — 本组所有工具的生成 schema。
- [Adding a tool](../../docs/cookbook/adding-a-tool.zh.md) — 两个工具包共同遵循的工具契约。
- [Webhook 组](../webhook/README.zh.md) — 部署可能与本组一起组合的另一个已验证外部输入面。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

「服务」与「数据集」的分工是刻意的：`gaokao-api` 托管一个以数据库为后端、经由 HTTP 服务的数据面，而 `tool-art-query` 读一份快照文件，因为它的源是工作簿而不是可查询的存储。理由与被拒的另一条路写在 [art-query 工具包 Agent Note](../../.agents/notes/implemented/feature/2026-09-30-art-query-tool-package.zh.md)。

</details>
