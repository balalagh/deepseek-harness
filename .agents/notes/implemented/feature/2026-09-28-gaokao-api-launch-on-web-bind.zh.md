# Agent Note: gaokao-api 服务随 Web 服务端口绑定而拉起

Status: implemented

[English](2026-09-28-gaokao-api-launch-on-web-bind.md) | 中文

## Problem

高考查询工具调用本地 Python 微服务 `http://127.0.0.1:8901`（`packages/gaokao/tool-gaokao-query`）。该服务未运行时，每次调用都失败于 `fetch failed`——工具报的是连接错误，既没有点名缺失的服务，也没有给出启动方式。手工启动（`start.ps1`，或一个 uvicorn 窗口）会把常驻进程留在组合之外：它比 Web 服务活得更久，销毁时不可见，而且每次以 `dsh web` 打开 3080 都要单独记得先启动它。

## Decision

新增一个包 `@deepseek-ai/dsh-gaokao-api` 拥有该服务的生命周期，并与它拥有的服务同处一个目录（`packages/gaokao/gaokao-api`，即 `main.py` 与其 `.env` 所在目录）。Web bundle 在 `packages/bundle/web-app/cordis.patch.yml` 中把它挂在 `web-runtime` 行之后。

顺序来自注入，而不是新增事件：`inject = ['webServer', 'subprocess']` 让拉起成为 Web 服务端口绑定、以及子进程提供者就位的结果。因此 Loader 只在 3080 完成绑定后激活该行；该行的 `apply()` 解析启动参数（见下），在包目录内 spawn `python -m uvicorn main:app --host 127.0.0.1 --port 8901`，在 `readyTimeoutMs`（默认 30000）内轮询 `/health` 直到应答，并记录就绪日志。

健康优先：若已有实例在应答 `/health`，插件复用它且不拉起任何进程。它不接管外来进程，也不终止任何进程，因此由 `start.ps1` 启动的服务不会被打扰，重复启动是幂等的。

归属由一个 `ctx.effect` 表达：销毁时调用 `handle.terminate()` 并 await `handle.waitForExit()`，子进程随该行一起结束。该行存活期间子进程自行退出时，只记录警告日志并保持停摆。

拉起失败是显式且带诊断的：子进程已退出则报告退出码与信号，spawn 失败则报告提供方的错误，子进程无声则报告就绪预算——每种情况都在消息里带上保留的 stderr 尾部（每路 8 KiB）。

默认值集中在导出的 `resolveLaunchSpec(config)` 一步施加，而不是在 `apply()` 内用 `?? default`：`cwd` 是包目录，`argv` 是由配置的 `host`/`port` 生成的 uvicorn 命令，所有随部署变化的选择（`apiDir`、`command`、`args`、`host`、`port`、`healthPath`、`readyTimeoutMs`、`graceMs`）都是经过校验的 `Config` 字段。这一步同时为空值回退，因为 cordis 配置层会把未填写的字符串物化为 `''`、未填写的数组物化为 `[]`；否则空的 `args` 会把子进程 argv 削减为裸 `python`，启动的是 REPL 而不是服务。

数据库凭据仍在原处：Python 进程从同目录 `.env` 读取 `GAOKAO_DB_*`。插件不读取、不记录、不转发这些值，也不传入任何环境覆盖。

## Alternatives considered

**在 `ctx.webServer` 上新增 `web-ready` 生命周期事件。** 它能让任何插件响应端口绑定，但今天只有 3080 一个消费者需要它：新事件是一条永久的宿主平面接缝、一份新的事件声明，以及一份需要维护的订阅契约。注入已经能表达"在 `webServer` 存在后激活"，不需要新词汇，而且复用了其它依赖宿主的插件行所依赖的 Loader 激活顺序。

**在 `tool-gaokao-query` 内懒拉起。** 首次工具调用时启动服务。该工具在能力接缝中是 Consumer；让它持有长生命周期子进程，等于让一个按请求调用的工具拥有会话级生命周期，而且它没有自己的销毁时机来终止子进程。独立的行把归属放在定义了销毁的地方。

**组合之外的常驻服务。** 登录项、计划任务或文档中常开的 `start.ps1` 窗口照样能用，但组合不知道该进程存在：它比 Web 服务活得更久，销毁时缺席，而它的缺席正是要修的那个 `fetch failed`。

**子进程退出后自动重启。** 重启需要退避策略、重试上限，以及对根本起不来的子进程的策略——这是另一个决策，带有自己的失败模式。先交付"拉起并托管"让告警路径保持可观察；重启仍然推迟，若采用应另立记录。

**通过 shell 或 bash 工具 spawn。** 两者都会丢掉进程树归属，使终止与输出收集变成临时方案。`ctx.subprocess` 已经提供可执行文件解析、托管进程范围、有界的溢出输出与升级式 kill，因此拉起走这条接缝。

## Consequences

打开 3080 现在同时拉起 8901，关闭组合则停止它——默认配置下这类 `fetch failed` 失败消失，且没有增加任何模型可见面：该插件不注册工具、提示词段落，也不产生会话事件。

代价是一条已发布的依赖：`@deepseek-ai/dsh-gaokao-api` 进入 `packages/bundle/web-app` 的依赖，Web bundle 因此随包发布一条高考专用行，并在启动时拉起 Python 解释器。远端部署 gaokao-api 的场景应省略该行，改为把 `tool-gaokao-query` 的 `apiUrl` 指向远端；缺少 Python 或该服务时，该行在加载期显式失败，而不是静默降级。

复用在设计上是不对称的：插件不会重启或替换不是它启动的服务，因此 8901 上一个陈旧的手工实例会被原样使用，即便它跑的是旧代码。

## Testing

`packages/gaokao/gaokao-api/tests/launcher.spec.ts` 针对一个三模式的 Node fixture 驱动完整生命周期：覆盖不拉起的复用、拉起后销毁（端点不再应答）、已退出的子进程（`exit=7`）及其 stderr 尾部进入消息、以及始终不监听的子进程（就绪预算）。`resolveLaunchSpec` 被直接覆盖，包含空值回退。默认配置已针对真实 Python 服务端到端验证：拉起、一次 `province-control-line` 查询、销毁后端点停止。

## Deferred

异常退出后的重启，以及拉起与终止之外的任何监督行为。
