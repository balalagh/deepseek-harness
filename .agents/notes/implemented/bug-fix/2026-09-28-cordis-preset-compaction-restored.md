# Agent Note: Restore compaction in the `cordis` agent preset

Status: implemented

English | [中文](2026-09-28-cordis-preset-compaction-restored.zh.md)

## Problem

The `cordis` preset shipped all three rows of its compaction group disabled:

```yaml
    - id: compaction-basic
      disabled: true
      name: '@deepseek-ai/dsh-compaction-basic'
```

A session on this preset therefore compacted nothing: no automatic compaction at the context threshold, no `/compact`, and no pruning of oversized tool results. The Web composition deliberately disables these same three rows on the host plane (`packages/bundle/web-app/cordis.patch.yml`) and its comment states that the preset owns them, so both sides disabled them and the session had no compaction at all.

The rows came in with `3052a72a87`, whose message is "增加一个query志愿规则工具，增加高考skill，disable无关tool". That commit disabled a batch of rows unrelated to the task; compaction went along with them even though it is not a tool.

## Decision

Delete the three `disabled: true` lines so the group matches what `standard` and `ptc` mount. The pruner's configuration (`thresholdChars: 8192`, `headChars: 4096`, `tailChars: 1024`), the group's `isolate` keys, and the placement of `token-meter` on the host plane are unchanged.

A preset composition is cached per process as a standing mount stamped with the composition file's `mtimeMs` and size, and `ensureStanding` is written to drop that generation and re-read the file when the stamp changes — so an edit is meant to reach the next session without a restart. It did not here: creating a session in the running Web process kept failing while the client showed nothing, because its failure path is `console.warn('new session failed:', …)`. Restarting `pnpm dsh web` made the next session mount the restored group, which is why the restart is recorded below as the reliable path rather than a formality.

## Alternatives considered

**Leave the preset uncompacted and change the default preset to `standard`.** The machine's `settings.yaml` sets `agent-presets.default: cordis` because that preset carries the 高考 assistant persona and the self-referential Cordis toolset. Switching the default to regain compaction would have dropped those customizations.

**Keep the rows disabled and document a reason beside them.** The disable was collateral from a batch edit, not a decision, so a comment would have frozen an accident.

**Treat the standing-mount stamp as sufficient and skip the restart advice.** Measured otherwise: the edited file did not reach the running process, so the note states the restart explicitly.

## Consequences

Sessions on `cordis` compact again: automatic compaction at 0.8 of the routed model's context window retaining 16% of it verbatim, `/compact` for a manual compaction, and tool results larger than 8192 characters pruned to a 4096-character head plus a 1024-character tail. Sessions created before the change keep the composition they were created with; the restored rows reach sessions created afterwards.

Anyone editing a preset file on this deployment should assume a restart is needed: the stamp refresh did not work here, and a session that fails to compose reports it only in the browser console.

## Testing

`node_modules/.bin/vitest run packages/preset/agent-presets/tests/shipped-root.spec.ts` loads every shipped preset — the file parses and mounts, and no case touches these rows. A headless session on the same preset created a session and completed a turn (`pnpm dsh --profile headless "只回复 ok"` printed `ok`), which exercises mounting the restored group. The change itself was read back with `git diff`: exactly three deletions, nothing else. A Web session created after the restart records `agentPreset: cordis` in its projection cache.

## Deferred

Why the standing-mount stamp refresh failed in the running process is not investigated; the restart is recorded as the workaround. `tool-workflow` remains disabled in this preset, which contradicts `shipped-root.spec.ts:151` and is a pre-existing failure of the local customization — left untouched here.
