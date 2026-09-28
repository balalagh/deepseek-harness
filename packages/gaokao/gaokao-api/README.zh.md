---
description: "高考数据查询微服务：同目录下的 FastAPI + PyMySQL 服务本体，以及在宿主 Web 服务绑定端口后拉起并托管 uvicorn 子进程的 Cordis 插件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-gaokao-api

[English](README.md) | 中文

## Summary

本包端到端拥有本地高考数据查询服务。`main.py` 是 FastAPI + PyMySQL 服务，提供 `/api/province-control-line`、`/api/college-admission`、`/api/score-segment`、`/api/province-fill-rule` 与 `/health`，数据库凭据只从同目录 `.env` 读取，插件从不经手。同包导出的 Cordis 插件注入 `webServer`，因此 Loader 只在宿主 Web 服务完成端口绑定后激活它：`apply()` 拉起 uvicorn 子进程，等待健康端点应答，并在该行销毁时终止子进程。已经在应答健康端点的实例会被复用而不是替换——插件既不接管也不杀死不是自己启动的进程。

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

把该行挂在同样挂载 `webServer` 的组合里（Web bundle 即如此），与注册 `@deepseek-ai/dsh-tool-gaokao-query` 的那行放在一起：

```yaml
- id: gaokao-api
  name: '@deepseek-ai/dsh-gaokao-api'
```

插件会在本包目录内启动 `python -m uvicorn main:app --host 127.0.0.1 --port 8901`。任何一项都可覆盖：

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

每个字段都可省略：`apiDir` 默认本包目录，`command` 默认 `python`，`host` 默认 `127.0.0.1`，`port` 默认 `8901`，`healthPath` 默认 `/health`，`readyTimeoutMs` 默认就绪预算（超时则该行显式失败），`graceMs` 默认交给 `ctx.subprocess` 的终止宽限。

当部署运行的不是包内 uvicorn 命令时，`args` 会替换整个参数列表；不填则使用由 `host`/`port` 生成的 `--host`/`--port` 组合。

<a id="understand-the-implementation"></a>
## Understand the implementation

- 顺序来自注入而非事件：`inject = ['webServer', 'subprocess']` 让拉起成为 Web 端口绑定、以及子进程提供者就位的结果。
- 默认值集中在导出的 `resolveLaunchSpec` 一步内施加，不在 `apply()` 内部，因此解析后的启动参数（目录、argv、健康 URL、各项预算）可单独检查与测试。
- 就绪判定是对健康端点的轮询，每次探测都有超时上限。子进程提前退出，或始终不监听端口，都会让该行失败并在消息里带上保留的 stderr 尾部。
- 归属由 `ctx.effect` 表达：销毁时终止托管进程范围并等待其退出，服务随组合一起结束而不会残留。

<a id="further-exploration"></a>
## Further Exploration

- [docs/architecture.zh.md](../../../docs/architecture.zh.md) —— 插件组合与宿主平面归属。
- [docs/cordis-primer.zh.md](../../../docs/cordis-primer.zh.md) —— 注入、patch 层与 `!!js` 配置表达式。
- [packages/subprocess/README.zh.md](../../subprocess/README.zh.md) —— `ctx.subprocess` 托管的进程范围。

<a id="model-experience"></a>
## Model Experience

模型看不到本包：它不注册工具、提示词段落，也不产生会话事件。它对一轮对话的唯一影响是高考查询工具不再返回 `fetch failed`，因为本地服务已在运行。

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- 不做崩溃重启：子进程在会话中途退出时，插件只记警告日志并保持停摆，直到组合重启；自动重启留待后续。
- 仅支持本地拉起。远端 gaokao-api 部署应把 `tool-gaokao-query` 的 `apiUrl` 指向它，并省略本行。
- 凭据留在 `.env` 中由 Python 进程读取；本包不读取、不记录、也不转发凭据。

<a id="dev-note"></a>
## Dev Note

`tests/launcher.spec.ts` 用 Node fixture（`tests/fixtures/health-server.mjs`）驱动完整生命周期，因此复用、拉起、销毁以及两条失败路径都无需 Python 解释器即可运行。手工启动服务请用 `start.ps1` / `start.bat`，它们不经过本插件。
