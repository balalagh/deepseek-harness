# Agent Note: AI multi-pathway admission guidance (draft)

Status: proposed

English | [中文](2026-09-29-multi-pathway-admission.zh.md)

## Problem

The v1.1 line exists to build AI-guided multi-pathway admission (多元升学路径) guidance on top of the existing 高考 data packages, and its scope is not fixed yet. One thing is already certain, because it was measured today: a change can land in the wrong composition layer and still look like it worked.

Host services (data APIs, session-scoped capabilities) are mounted through the profile's bundle plus patch stack, where `dsh web --patch <file>` overlays a machine-local layer. Model-facing capabilities (tools, commands, skills) belong to the agent preset (`packages/preset/agent-presets/presets/cordis/agent.cordis.yml`). The two are different trees: a patch overlay naming an agent-preset row is rejected at boot with `patch: entry "tool-gaokao-query" not found`. An edit made in the wrong layer, by contrast, boots silently and changes nothing.

## Proposal

- **Develop on a dedicated instance.** Port 3080 stays the stable instance with no overlay. Port 3081 runs with a machine-local overlay (`cordis.3081.patch.yml`, gitignored) and HMR enabled, so client-plugin artifacts reach the browser without a rebuild, a restart, or a new access token.
- **Disable rather than delete.** The existing college-admission tools are disabled inside v1.1's agent composition as a placeholder; the FastAPI service they call and its data path stay untouched, so other presets and the repository history keep them.
- **Route every new piece by layer.** Data and services go through the profile's bundle plus patch stack; anything the model calls goes into the agent preset. A change that cannot say which layer it lands in is not ready to implement.
- **Fix the frame before the feature.** These four questions decide the data model and the tool surface, so they are answered before implementation is scheduled: which pathways (强基计划 / 综合评价 / 专项计划 / 中外合办 / 港澳与留学 / 志愿填报本身), what the primary output is (consultative conversation, ranked recommendation, or form-driven report), where the data comes from (extend the existing MySQL schema and FastAPI service, or add a service beside them), and whether the new capability replaces the admission tools inside the preset or sits beside them.

## Alternatives considered

**Delete the admission tools and the gaokao-api package outright.** It would break the data path for other presets and for anyone reading history, and it would express "v1.1 does not do this" as "the repository does not do this". Disabling is the honest form; deletion is a separate decision.

**Configure the agent layer through the `--patch` overlay.** Measured impossible: the overlay is rejected because the entry does not exist in the profile tree. Recorded as a constraint, not an option.

**Develop directly on port 3080.** It would carry experimental switches and the HMR watcher into the daily-use instance, and every restart invalidates the access token and interrupts whatever session is open.

**Grow the data source first (wider tables or a new database), then decide the product shape.** The schema is decided by the pathway set, and that set is not settled yet; widening first would freeze a guess into the schema.

## Acceptance criteria

- v1.1's agent composition registers no admission query tool, while every other preset keeps them.
- The FastAPI service can still be started and called on its own; its path and configuration are unchanged.
- The 3081 instance composes host-layer entries from `cordis.3081.patch.yml`, verified read-only with `pnpm dsh web --patch ./cordis.3081.patch.yml --dump-config`.
- This note moves from `proposed` to `implemented` only after the four framing questions have recorded answers.

## Risks

- **Layer mismatch (highest).** Correct content in the wrong layer boots clean and has no effect — the failure this note opened with.
- **Underestimated data cost.** The admission data sits on a public-network RDS reached with a fresh connection per request (measured ~250 ms each). A new pathway feature that reuses that pattern imports the latency into an interactive flow.
- **Unfixed output shape churns the tool surface.** Conversation versus ranked recommendation versus report each imply different tools; writing them before the choice causes rework.
- **Scope creep.** While the pathway set stays open, implementation keeps being invalidated by "one more pathway".
