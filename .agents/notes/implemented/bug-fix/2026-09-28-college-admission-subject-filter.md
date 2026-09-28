# Agent Note: The college-admission subject filter runs in SQL, before the row window

Status: implemented

English | [中文](2026-09-28-college-admission-subject-filter.zh.md)

## Problem

`/api/college-admission` must return only rows the candidate's chosen subjects qualify for: a row requiring a subject the candidate did not choose does not apply. Two defects made that guarantee empty.

The requirement flags are `bit(1)` columns, so PyMySQL returns `b'\x00'`/`b'\x01'`. The filter compared them with `== 1`, which is false for both values, so no row was ever excluded — a query for 历史,政治,地理 answered with 北京大学 理科试验班类, whose requirement is 物理,化学. Independently, the filter ran after `SELECT … ORDER BY admission_score DESC LIMIT 200`, so even a correct comparison would have judged 200 rows selected without the candidate's subjects in mind: on 安徽 2025, 19277 rows qualify for 物理,化学 under the multi-subject rule and only 168 of them fall inside that window.

## Decision

`college_admission` states the requirement in the query. The in-memory filter is deleted, and the seven flag columns are no longer read back — after the pushdown nothing consumes them, so the `SELECT` list keeps only the display field `subject_requirement`. NULL and 0 both mean "no requirement", and the bit comparison stays on the SQL side, where it evaluates numerically.

Which condition the query gains depends on how many subjects the request named:

- **Several subjects** — the input is a complete combination, so a subject the request omits means the candidate did not choose it: every unlisted column is constrained with `(subject_x IS NULL OR subject_x = 0)`.
- **One subject** — the input declares one subject and says nothing about the rest, so an omitted subject is *unknown* rather than unchosen: a row is kept when the named column is required (`subject_x = 1`) **or** when the row requires no subject at all (all seven columns NULL or 0).

Either way the response is the highest-scoring qualifying rows, with `LIMIT 200` still the hard ceiling.

Responses carry the database values as they are: a column with no value is `null`, never `0` and never an empty string. The nullable columns behind these endpoints — `admission_score`, `admission_rank`, `enrollment_plan`, the four control-line ranks, `fill_count`, `subject_mode`, `fill_mode` — keep their absence visible, because zero is a real score, rank, or plan count. The query tools state that in their output schemas: a field that may be absent allows null, since the tool registry validates every output value against its schema and an undeclared null fails the call. Their renderers name the absence instead of substituting a value — a control line whose rank was never published prints 位次未公布, and a fill rule whose mode is missing prints 未公布 rather than assuming the other mode.

Empty `subject` (the endpoint accepts it) stops being "return everything": it excludes every row that requires any subject, leaving only rows that require none.

## Alternatives considered

**Treat a single subject as a complete combination** (constrain the other six columns to NULL or 0, as the multi-subject rule does). This was the shipped behavior for one revision and it is what a "the candidate's subjects" reading gives. It was rejected because a one-subject request states one fact: a caller naming only 物理 has not said that the candidate lacks 化学, so dropping 物理,化学 rows answers a question nobody asked, and on 安徽 2025 it hides 19389 of the 19855 rows that mention 物理.

**Render missing values as `0` and empty strings** (the previous behavior). Zero is a real value in every one of these columns — a score, a rank, an enrollment plan — so an unrecorded score reached the model as `0`, which reads as the worst possible result rather than as missing data, and an empty string is indistinguishable from a recorded empty note. The output schema was widened instead of the data being flattened.

**Fix only the Python comparison** (for example `value not in (None, 0, b'\x00')`). It would make the filter true, but the window defect remains: the 200 rows are still chosen before filtering, so a 物理,化学 query answers with the roughly 168 qualifying rows above 675 points and hides the other 19000.

**Widen or drop `LIMIT`, then filter in memory.** This reads the whole match set into the service process on every request — 26278 rows for one province-year today, growing with the data — and leaves limit semantics wrong for anything that later wants a page.

**`subject_x <> 1` (or `NOT subject_x = 1`) as the SQL condition.** Shorter, but three-valued logic inverts the intent: for a NULL column the comparison is NULL, the row is not returned, and every row whose "no requirement" is recorded as NULL disappears. The unrestrictive case has to be named explicitly.

**Parse `subject_requirement` (varchar) instead of the flags.** The text is a display field (`物理,化学`) with no fixed grammar, while the flag columns are the machine-readable statement of the same fact.

## Consequences

Answers now depend on the candidate's subjects, and the single-subject rule is deliberately the looser of the two. On 安徽 2025 a 物理 request matches 19855 rows, 物理,化学,生物 matches 19665, and 历史,政治,地理 matches 6418; 技术 matches 0. The looser rule also means that a row requiring 物理 *and* 化学 is returned to a caller who named only 物理 — the stated alternative to that, treating an unmentioned subject as unchosen, is what the multi-subject rule does and it was rejected on the grounds above.

Where a province's data contains rows that require no subject at all, the single-subject rule surfaces them: 河南 2025 has 15399 such rows, and they are what a 物理 request returns first there.

The one row inside the 安徽 2025 地理 answer whose score is not recorded (阜阳师范大学 地理科学, an oriented-Tibet plan) now arrives as `admission_score: null` rather than `0`, and its rank follows.

Rows that the window used to hide are visible again. `LIMIT 200` is unchanged, and a match set larger than 200 still returns no indication that more rows exist; pagination is outside this change.

## Testing

The Python service has no automated harness in this repository, so the change was verified against the live database through the running service. For 物理 / 历史 / 地理 / 政治 / 技术 / 物理,化学,生物 / 历史,政治,地理 / 物理,历史, the endpoint's answer was compared with the set produced by an independently written filtering query; every pair matched exactly, behind 200-row answers over match sets of 19855, 6460, 184, 299, 0, 19665, 6418 and 10973 rows.

Direction checks confirm the intent: the highest-scoring row requiring both 物理 and 化学 appears in the 物理 answer, while the highest-scoring row requiring 化学 without 物理 does not. On 河南 2025, the first 40 rows returned for a single-subject 物理 request were read back from the database and all of them require no subject. An empty `subject` returns 0, and an unsupported subject name still fails with 400. Before the change, the same comparison for 历史,政治,地理 overlapped the correct set in 4 of 81 rows.

Missing values were checked on the same path. The 安徽 2025 地理 answer carries exactly one row with a `null` score and none with `0`, matching the database count for the same filter, and the tool accepts such a value: its output schema reports no violations for a row carrying nulls where the previous integer-only schema reported `must be an integer`, and its renderer prints those cells empty. Verification performed before this change had to normalise the score, because `None` and `0` denoted the same row; after it, they are different facts.

The other endpoints were checked the same way. 西藏 2025, whose four control lines have no published ranks, returns `rank: null` where it previously returned `0`, while 北京 2025 still returns its recorded ranks; 新疆 2027 returns `fill_count: null`, which its tool's schema now admits. All four tool schemas accept sample values carrying nulls, and their renderers print the absence (位次未公布 / 未公布) instead of a substituted value.

## Deferred

Page size and offset for `/api/college-admission`: the limit is a constant 200 with no way to request the next window or to learn the total match count.
