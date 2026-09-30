---
description: "The five model-facing art-exam admission query tools (policy matrix, admission detail, school-exam list, major catalog, admission modes) over one deployment-supplied dataset file."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-art-query

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-tool-art-query` registers five read-only tools that answer 艺术类高考 (art-exam admission) questions: `query_art_policy_matrix`, `query_admission_detail_2026`, `query_school_exam_list`, `query_major_catalog`, and `query_admission_mode_overview`. Every tool reads one JSON dataset named by `Config.dataPath` — the package ships no data, because the dataset is deployment data derived from a local admission workbook. The dataset loads on the first call and reloads when its mtime changes, so regenerating it needs no process restart. Results are filtered in memory, sorted by admission score where a score exists, and capped at `Config.maxRows` with the total reported.

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

Mount the row in an agent preset or composition that already mounts `ctx.tools`, naming the dataset the tools must read:

```yaml
- id: tool-art-query
  name: '@deepseek-ai/dsh-tool-art-query'
  config:
    dataPath: /absolute/path/to/art-tools.json
    maxRows: 200
```

`dataPath` has no default and is required: the dataset is deployment data, and a missing or malformed file fails the first tool call with a message naming the file, rather than answering from an empty table. `maxRows` defaults to 200.

### Build the dataset

The dataset is generated from the admission workbook by the script shipped beside this README (not published in the tarball, because it needs Python and `openpyxl`):

```sh
python scripts/convert_art_xlsx.py --xlsx /path/to/艺考类.xlsx --out /absolute/path/to/art-tools.json
```

The script writes five top-level arrays — `policy_matrix`, `admission_detail`, `school_exam`, `major_catalog`, `admission_mode_overview` — plus a `meta` block recording the source path, generation time, exported years, and every raw 科类 value that normalized to `其他`. Empty cells become `null`; the nine numeric admission columns become numbers; `院校代码` stays a string because it is an identifier.

### What the tools answer

| Tool | Required parameters | Optional parameters |
|---|---|---|
| `query_art_policy_matrix` | `province` | — |
| `query_admission_detail_2026` | `year`, `province` | `category`, `school_name`, `admission_min_score`, `admission_max_score` |
| `query_school_exam_list` | — | `school_province`, `school_name` |
| `query_major_catalog` | — | `exam_category` |
| `query_admission_mode_overview` | — | — |

`category` accepts either a raw 科类 value from the dataset or one of the seven normalized 统考类别 (`美术与设计类`, `音乐类`, `舞蹈类`, `表(导)演类`, `播音与主持类`, `书法类`, `戏曲类`); a normalized name covers every direction beneath it, such as `音乐表演` and `音乐教育` under `音乐类`. `school_name`, `school_province`, and `exam_category` match by containment, so a partial value is enough.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin: `Config`, dataset load, five `defineTool` registrations, per-tool filtering and rendering |
| [`scripts/convert_art_xlsx.py`](scripts/convert_art_xlsx.py) | Workbook → dataset conversion, category normalization, and the `meta` record |
| — | No runtime invariant companion is published: this package owns no service or lifecycle stream, its only state is a lazily loaded dataset, and the registry owns the tool results it produces. |

### Dataset boundary

The dataset file is a durable boundary, so the parsed document is validated by a `schemastery` schema before use: the five arrays must be present, and every read of a row field coerces to the declared type (`string`, `number`, or `null`) — a row value of the wrong type reads as missing instead of failing the output schema at the registry. The load is keyed by mtime, so a regenerated dataset is picked up by the next call in the same process.

### Filtering and ordering

Rows are filtered by exact-or-contained province name, normalized category, contained school name, and a closed score interval on the admission score. `query_admission_detail_2026` then sorts by admission score descending, with rows that carry no score last, and caps the returned rows while still reporting the full match count.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-art-query) — the generated schemas of all five tools.
- [Gaokao group map](../README.md) — the sibling data-service host row and the 高考 query tools.
- [Adding a tool](../../../docs/cookbook/adding-a-tool.md) — the tool contract this package follows.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the five generated schemas linked from the [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-art-query): tool names, parameter names with their array/scalar types, and the descriptions that state which filters exist and what each returns. The dataset contents themselves are never visible until a call.

#### Token effect

Fixed schema cost on every request where the tools are visible; the descriptions are the large part of it. Results add data-dependent retained tokens — a capped admission-detail table is the widest contributor.

#### KV Cache effect

Prefix-stable while the definitions and their visibility are unchanged. Regenerating the dataset does not change the schema, so it does not invalidate the request prefix.

### Tool-call history and result

#### What the model sees

The arguments stay in the assistant tool-call arguments. The result is one text block: a scope line naming the filters, the match and returned counts with a truncation note, and one line per row with the tool's declared fields in a fixed order. Missing fields render as `（未收录）` rather than blank cells, so an absent value is never read as zero or empty.

#### Token effect

Data-dependent retained tokens. `maxRows` bounds the largest possible result.

#### KV Cache effect

Append-only; a result follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the tools are a poor fit. They are current package constraints, not a backlog.

- **The dataset is deployment data and must be generated** — the package ships no data and `dataPath` has no default, so a fresh deployment has working schemas and failing calls until the converter has run.
- **The converter needs Python and `openpyxl`** — it is deliberately outside the published `files` list and outside every Node-side gate; a workbook format change is caught by re-running it, not by a test.
- **`query_admission_detail_2026` accepts only the year its dataset carries** — a request for another year fails with an error naming the supported year, instead of returning the workbook's other (partial) years.
- **Category normalization is keyword-based** — the seven categories come from keyword matching after parenthesis folding, and every value that matches nothing lands in `其他`. The `meta.categoriesUnmapped` block names those values so a new one is visible in the dataset rather than silently misfiled.
- **School, province, and category filters match by containment** — a very short value (`大学`, `音乐`) matches broadly; the caller is responsible for passing a discriminating value.
- **Row content is coerced, not validated** — the document shape is validated at load, but a field with an unexpected type reads as missing rather than failing the call.
- **A capped result reports the true count but not the omitted rows** — narrowing the filters is the only way to see them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The dataset decision — one external JSON snapshot rather than a live database service — is recorded in [the art-query tool package Agent Note](../../../.agents/notes/implemented/feature/2026-09-30-art-query-tool-package.md), which also states what the alternative (a second FastAPI service over the workbook) would have cost.

</details>
