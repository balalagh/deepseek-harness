# Agent Note: the art-exam query tool package

Status: implemented

English | [中文](2026-09-30-art-query-tool-package.zh.md)

## Problem

A deployment that answers 艺术类高考 (art-exam admission) questions needs model-facing tools over its own admission workbook. The workbook lives outside every checkout, holds six sheets with 33,656 admission rows, and answers five different questions: province policy rules, admission detail per college-major group, which colleges may still set their own exam, which majors each 统考类别 unlocks, and how the admission modes differ. Nothing in that shape is answerable by one tool, and none of it belongs in the repository — the data is one deployment's snapshot.

The existing 高考 stack answers a structurally different question: `gaokao-api` hosts a FastAPI service over a MySQL database, and `tool-gaokao-query` calls its endpoints. Copying that shape would have added a second long-lived service, a second port, and a second process lifecycle for data that is a file.

## Decision

`packages/gaokao/tool-art-query/` ships five model-facing tools — `query_art_policy_matrix`, `query_admission_detail_2026`, `query_school_exam_list`, `query_major_catalog`, `query_admission_mode_overview` — over one dataset file named by the required `Config.dataPath`. **The package ships no data and starts no service**: the dataset is deployment data, produced from the workbook by `packages/gaokao/tool-art-query/scripts/convert_art_xlsx.py` and pointed at from the mounting composition.

Four properties make the snapshot form workable:

- **The tools filter in memory.** The dataset loads on the first call and stays resident, so a query costs no I/O beyond the first one. `Config.maxRows` (default 200) bounds every list result while `count`, `returned`, and `truncated` still report the truth about what was omitted.
- **The load is keyed by mtime.** Regenerating the dataset is picked up by the next call in the same process, so refreshing deployment data never requires a restart.
- **The file boundary is validated, and row fields are coerced.** The parsed document is checked by a `schemastery` schema (the five collections must be present), and every field read coerces to its declared type: a mis-typed cell reads as missing instead of failing the output schema at the registry. A missing or malformed file fails the first call with a message naming the file.
- **Category normalization happens in the converter.** The workbook spells the same 统考类别 84 different ways (`音乐类`, `音乐表演类(器乐)`, `艺考类本科统考E（音乐表演（器乐）类）` …). The converter adds an internal `category` field carrying the normalized class, and the tools match either the raw value or the normalized one, folding full-width parentheses first. Values that normalize to nothing land in `其他` and are listed in `meta.categoriesUnmapped`, so a new spelling is visible in the dataset rather than silently misfiled.

The converter exports 2026 admission rows by default, because that sheet also carries 7,007 rows from another year whose batch names mark them as 兜底 records; `--years all` widens the export and the tool then accepts only the year its dataset carries.

## Alternatives considered

**Add a second FastAPI service beside `gaokao-api`.** It would reuse the host-row shape the 高考 stack already proves: a row spawning `uvicorn`, a health check, an HTTP client in the tool package. It lost because the data is a 2.5 MB file rather than a queryable store: a service would add a port, a process lifecycle, a health contract, and a deployment step to answer five queries that a resident in-memory filter answers faster, and it would put workbook parsing on the critical path of every call.

**Keep the tools as a preset-local plugin file.** This is what the 3081 instance ran first: `plugins/art-query.mjs` inside the user preset, reading a dataset beside it. It works, but the code lives outside version control and outside every gate — no unit tests, no README contract, no catalog entry — while the deployment data it reads is the part that should stay local. The promoted package keeps exactly that split, with the code in the repository and the data in the deployment.

**Parse the workbook in the tool, in Node.** The tools would need an XLSX reader, a dependency this repository does not otherwise carry, plus per-call parse cost for a 2.5 MB workbook. A one-time conversion keeps the runtime dependency-free and the query path cheap.

**Import the workbook into the existing MySQL database.** It would let SQL express the filters and reuse `gaokao-api`. It lost on ownership: the workbook is one deployment's research artifact with no schema owner, its columns are heterogeneous prose and half-empty numbers, and importing it would make a database migration part of changing a research file.

## Consequences

Admission-workbook queries now have a versioned, tested, catalogued home, and no service, port, or process lifecycle was added to the deployment.

The cost is a generation step that no Node-side gate covers. The converter needs Python and `openpyxl`, is deliberately outside the published `files` list, and cannot be exercised by `pnpm run test`; a workbook format change surfaces when the converter is re-run, not in CI. A deployment that forgets the step has working schemas and failing calls — the failure names the dataset path, which is the loudest signal available without shipping data. Row content is coerced rather than validated, so a mis-typed field reads as missing; the alternative (validating all 26,648 rows on load) would put a schema walk on every reload to catch a case the converter's own tests cannot produce.

The five tools also inherit the workbook's own unevenness: `查询` aggregates are absent, the admission detail carries no 专业 for many provinces, and `其他(待归)` and `艺术(区内)` rows (7 in total) match no normalized category. Those are data facts the tools state as `（未收录）` and `meta.categoriesUnmapped` rather than smoothing over.

## Testing

`packages/gaokao/tool-art-query/tests/art-query.spec.ts` boots the package on a real tool registry with a fixture dataset written per case and pins registration, the five schemas' parameters, province coverage reporting, normalized-category matching, school containment, score-interval filtering, descending order with missing scores last, the `maxRows` cap and its truncation report, the unsupported-year error, the missing-dataset error, and mtime-driven reload. `scripts/gen-tool-catalog.ts` boots the package (with a placeholder `dataPath` no tool reads) so its five schemas cannot drift from `docs/tool-catalog.md`.
