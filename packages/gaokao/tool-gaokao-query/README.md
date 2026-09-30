---
description: "The model-facing 高考 query tools (province control lines, college admission data, score segments, fill rules) over the local gaokao-api HTTP service."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-gaokao-query

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-tool-gaokao-query` registers four read-only tools that answer 高考 (college entrance exam) questions from a deployment's own admission database: `query_province_control_line`, `query_college_admission_data`, `query_yifenyiduan`, and `query_province_rule`. Every tool is thin: it builds one HTTP GET against the service named by `Config.apiUrl`, forwards the caller's filters, and renders the decoded rows. It holds no data and no database credentials, so the service — normally the [`gaokao-api`](../gaokao-api/README.md) row in the same group — owns connection pooling, schema, and query planning.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the row wherever the model should be able to query this deployment's admission data, beside the row that starts the service:

```yaml
- id: tool-gaokao-query
  name: '@deepseek-ai/dsh-tool-gaokao-query'
  config:
    apiUrl: http://127.0.0.1:8901
```

`apiUrl` defaults to `http://127.0.0.1:8901`, which is the service's default listener. The tools require nothing else to load: registration makes no request, and a call fails with the service's status and body when the service is unreachable or refuses the request.

### What the tools answer

| Tool | Required parameters | Optional parameters |
|---|---|---|
| `query_province_control_line` | `province` | `year` (default 2025) |
| `query_college_admission_data` | `exam_province`, `subject`, `college_major_group` | `school_province`, `school_city`, `school_name`, `year`, `major_name`, `parsed_major_name`, `major_category`, `sino_foreign`, `admission_score_min`, `admission_score_max`, `admission_rank_min`, `admission_rank_max`, `fields` |
| `query_yifenyiduan` | `province`, `year`, `subject_combination`, `score` | — |
| `query_province_rule` | `province`, `year` | — |

Multi-value filters are comma-separated strings (`school_name: "A,B"`), and `fields` selects which columns the answer carries; the rendered table always keeps the identifying and score columns.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin: `Config`, the shared HTTP client, four `defineTool` registrations with their output schemas and renderers |
| — | No runtime invariant companion is published: the package owns no service, lifecycle, or durable state — it translates arguments into one request and the decoded answer into text. |

### Request path

Each tool maps its arguments onto one endpoint path (`/api/province-control-line`, `/api/college-admission`, `/api/score-segment`, `/api/province-fill-rule`), forwarding the caller's `exec.signal`. A non-2xx response throws with the status and body, so the model sees the service's own diagnostic instead of an empty table.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-gaokao-query) — the generated schemas of all four tools.
- [gaokao-api](../gaokao-api/README.md) — the service host row these tools call.
- [Gaokao group map](../README.md) — the sibling dataset-backed art-exam tools.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the four generated schemas linked from the [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-gaokao-query): tool names, parameter names with their types, and descriptions naming each filter. The dataset behind the service is never visible until a call.

#### Token effect

Fixed schema cost on every request where the tools are visible. `query_college_admission_data` carries the largest schema because its filter set is the widest.

#### KV Cache effect

Prefix-stable while the definitions and their visibility are unchanged; the service's data changes do not affect the request prefix.

### Tool-call history and result

#### What the model sees

Arguments stay in the assistant tool-call arguments. A result is one text block: a query line naming the filters, the match count, a column header, and one line per row. An unreachable service or a refused request arrives as an error carrying the service's status and body.

#### Token effect

Data-dependent retained tokens, bounded by how many rows the service returns — this package caps nothing.

#### KV Cache effect

Append-only; a result follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the tools are a poor fit. They are current package constraints, not a backlog.

- **A reachable service is required at call time** — the tools hold no fallback data, so a deployment that does not start `gaokao-api` (or an equivalent service at `apiUrl`) has working schemas and failing calls.
- **The service owns data correctness, freshness, and row limits** — this package forwards filters and renders the answer; it cannot cap, paginate, or repair what the service returns.
- **Multi-value filters are comma-separated strings** — values containing a comma cannot be expressed.
- **`fields` selects columns the service must support** — an unknown field name is the service's to report.
- **`query_college_admission_data` requires a group mode** — callers must know whether the deployment fills by 院校专业组 (`1`) or by 专业+院校 (`0`).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This package was added through the `gaokao-api` host row's PR and originally shipped without a README; the sibling dataset-backed tool package's decision record is [the art-query tool package Agent Note](../../../.agents/notes/implemented/feature/2026-09-30-art-query-tool-package.md).

</details>
