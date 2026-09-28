# Agent Note: The gaokao-api service launches when the Web server binds

Status: implemented

English | [中文](2026-09-28-gaokao-api-launch-on-web-bind.zh.md)

## Problem

The 高考 query tools call a local Python microservice at `http://127.0.0.1:8901` (`packages/gaokao/tool-gaokao-query`). When that service is not running, every call fails with `fetch failed` — the tool reports a connection error that names neither the missing service nor the way to start it. Starting it by hand (`start.ps1`, or a uvicorn window) leaves a resident process outside the composition: it survives the Web server, is invisible to disposal, and has to be remembered separately for every launch of `dsh web` on port 3080.

## Decision

One new package, `@deepseek-ai/dsh-gaokao-api`, owns the service lifecycle and lives beside the service it owns (`packages/gaokao/gaokao-api`, the directory holding `main.py` and its `.env`). The Web bundle mounts it in `packages/bundle/web-app/cordis.patch.yml` immediately after the `web-runtime` row.

Ordering comes from injection, not from a new event: `inject = ['webServer', 'subprocess']` makes the launch a consequence of the Web server's port binding and of a subprocess provider being present. Loader therefore activates the row only after 3080 is bound, and the row's `apply()` resolves the launch (see below), spawns `python -m uvicorn main:app --host 127.0.0.1 --port 8901` in the package directory, polls `/health` until it answers within `readyTimeoutMs` (default 30000), and logs readiness.

Health first: if something already answers `/health`, the plugin reuses it and spawns nothing. It adopts no foreign process and terminates none, so a service started by `start.ps1` is left alone and repeated launches are idempotent.

Ownership is one `ctx.effect`: disposal calls `handle.terminate()` and awaits `handle.waitForExit()`, so the child dies with the row. A child that exits on its own while the row is alive is logged as a warning and stays down.

Launch failures are loud and diagnosed: an exited child reports exit code and signal, a spawn failure reports the provider error, and a silent child reports the readiness budget — each with the retained stderr tail (8 KiB per stream) in the message.

Defaults are applied in one exported step, `resolveLaunchSpec(config)`, never as `?? default` inside `apply()`: `cwd` is the package directory, `argv` is the generated uvicorn command for the configured `host`/`port`, and every deployment-varying choice (`apiDir`, `command`, `args`, `host`, `port`, `healthPath`, `readyTimeoutMs`, `graceMs`) is a validated `Config` field. The step also falls back for empty values, because a cordis config layer materializes an unset string as `''` and an unset array as `[]`; an empty `args` would otherwise reduce the child argv to bare `python`, which starts a REPL instead of the service.

Database credentials stay where they were: the Python process reads `GAOKAO_DB_*` from the sibling `.env`. The plugin never reads, logs, or forwards them, and never passes an environment override.

## Alternatives considered

**A new `web-ready` lifecycle event on `ctx.webServer`.** It would let any plugin react to the port binding, but 3080 is one consumer's need today: a new event is a permanent Host-plane seam, a new `SessionEventMap`-style declaration, and a subscription contract to maintain. Injection already expresses "activate after `webServer` exists" with no new vocabulary, and it reuses the Loader activation order that every other host-dependent row relies on.

**Lazy launch inside `tool-gaokao-query`.** The first tool call would start the service. The tool is a Consumer in the capability seam; giving it a long-lived child process makes a per-request tool own session-scoped lifecycle, and it has no disposal point of its own to terminate the child from. A separate row keeps ownership where disposal is defined.

**A resident service outside the composition.** A login item, a scheduled task, or a documented `start.ps1` window keeps working, but nothing in the composition knows the process exists: it outlives the Web server, is absent from disposal, and its absence is exactly the `fetch failed` failure being fixed.

**Automatic restart when the child exits.** Restart needs a backoff, an attempt ceiling, and a policy for a child that cannot start at all — a second decision with its own failure modes. Shipping launch-and-own first keeps the warning path observable; restart remains deferred and belongs in its own note if adopted.

**Spawning through a shell or a bash tool.** Both lose process-tree ownership and make termination and output collection ad hoc. `ctx.subprocess` already provides resolution, managed ranges, bounded spill-backed output, and escalated kills, so the launch goes through that seam.

## Consequences

Opening the Web server on 3080 now also starts 8901, and closing the composition stops it — the `fetch failed` class of failure disappears for the default configuration, with no model-visible surface added: the plugin registers no tools, prompt sections, or session events.

The cost is a published dependency: `@deepseek-ai/dsh-gaokao-api` joins `packages/bundle/web-app`'s dependencies, so the Web bundle now ships a 高考-specific row and starts a Python interpreter on launch. A deployment that serves gaokao-api remotely should omit this row and point `tool-gaokao-query` at its `apiUrl` instead. Where Python or the service is absent, the row fails loudly at load rather than degrading silently.

Reuse is asymmetric by design: this plugin will not restart or replace a service it did not start, so a stale hand-started instance on 8901 is used as-is even if it serves old code.

## Testing

`packages/gaokao/gaokao-api/tests/launcher.spec.ts` drives the full lifecycle against a Node fixture in three modes: it covers reuse without spawning, launch followed by disposal (the endpoint stops answering), an exited child (`exit=7`) with its stderr tail in the message, and a child that never listens (readiness budget). `resolveLaunchSpec` is covered directly, including the empty-value fallback. The default configuration was verified end to end against the real Python service: launch, one `province-control-line` query, and a stopped endpoint after disposal.

## Deferred

Restart after an unexpected exit, and any supervision beyond launch and termination.
