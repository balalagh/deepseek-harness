---
description: "The 高考 (gaokao) data-query microservice: the FastAPI + PyMySQL service in this directory and the Cordis plugin that starts and owns its uvicorn process once the host Web server binds."
kind: "package-reference"
---

# @deepseek-ai/dsh-gaokao-api

English | [中文](README.zh.md)

## Summary

This package owns the local 高考 data-query service. `main.py` is the FastAPI + PyMySQL service answering `/api/province-control-line`, `/api/college-admission`, `/api/score-segment`, `/api/province-fill-rule`, and `/health`; it reads database credentials from the sibling `.env`, never from a plugin. The Cordis plugin in the same package injects `webServer`, so Loader activates it only after the host Web server binds its port: `apply()` spawns the uvicorn child, waits for the health endpoint to answer, and terminates the child when the row is disposed. An instance already answering the health endpoint is reused, never replaced.

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

Mount the row in a composition that also mounts `webServer` (the Web bundle does), next to the row that registers `@deepseek-ai/dsh-tool-gaokao-query`:

```yaml
- id: gaokao-api
  name: '@deepseek-ai/dsh-gaokao-api'
```

The plugin starts `python -m uvicorn main:app --host 127.0.0.1 --port 8901` from this package's directory. Override any part of that launch:

```yaml
- id: gaokao-api
  name: '@deepseek-ai/dsh-gaokao-api'
  config:
    apiDir: /srv/gaokao-api
    command: python3
    host: 127.0.0.1
    port: 8901
    healthPath: /health
    readyTimeoutMs: 30000
    graceMs: 2000
```

Every field is optional: `apiDir` defaults to this package's directory, `command` to `python`, `host` to `127.0.0.1`, `port` to `8901`, `healthPath` to `/health`, `readyTimeoutMs` to the readiness budget the row fails loudly on when it expires, and `graceMs` to the termination grace handed to `ctx.subprocess`.

`args` replaces the whole argument list when a deployment runs something other than the packaged uvicorn command; leaving it out keeps the generated `--host`/`--port` pair in step with `host` and `port`.

<a id="understand-the-implementation"></a>
## Understand the implementation

- Ordering is injection, not an event: `inject = ['webServer', 'subprocess']` makes the launch a consequence of the Web port binding, and of a subprocess provider being present.
- Defaults are applied in one exported step (`resolveLaunchSpec`), never inside `apply()`, so the resolved launch — directory, argv, health URL, budgets — is inspectable and testable.
- Readiness is a poll of the health endpoint with a bound on every probe. A child that exits, or a child that never listens, fails the row with the retained stderr tail in the message.
- Ownership is a `ctx.effect`: disposal terminates the managed range and awaits its exit, so the service dies with the composition rather than outliving it.

<a id="further-exploration"></a>
## Further Exploration

- [docs/architecture.md](../../../docs/architecture.md) — plugin composition and host-plane ownership.
- [docs/cordis-primer.md](../../../docs/cordis-primer.md) — injection, patch layers, and `!!js` config expressions.
- [packages/subprocess/README.md](../../subprocess/README.md) — the process range `ctx.subprocess` manages.

<a id="model-experience"></a>
## Model Experience

The model never sees this package: it registers no tools, no prompt sections, and no session events. Its only effect on a turn is that the gaokao query tools stop answering `fetch failed` because their local service is running.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- No restart-on-exit: when the child dies mid-session the plugin logs a warning and stays down until the composition restarts. Automatic restart is deferred.
- The launch is local-only. A remote gaokao-api deployment is configured by pointing `tool-gaokao-query` at its `apiUrl` and omitting this row.
- Credentials stay in `.env`, read by the Python process. This package never reads, logs, or forwards them.

<a id="dev-note"></a>
## Dev Note

`tests/launcher.spec.ts` drives the whole lifecycle against a Node fixture (`tests/fixtures/health-server.mjs`), so reuse, launch, disposal, and both failure paths run without a Python interpreter. Run the service by hand with `start.ps1` / `start.bat`, which do not go through this plugin.
