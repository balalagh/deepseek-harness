# Agent Note: 恢复 `cordis` agent preset 的上下文压缩

Status: implemented

[English](2026-09-28-cordis-preset-compaction-restored.md) | 中文

## 问题

`cordis` preset 的压缩组三行全都是禁用的：

```yaml
    - id: compaction-basic
      disabled: true
      name: '@deepseek-ai/dsh-compaction-basic'
```

因此该预设下的会话完全不会压缩：没有到达阈值时的自动压缩，没有 `/compact`，也不裁剪过大的工具结果。Web 组合刻意在宿主平面禁用了同样这三行（`packages/bundle/web-app/cordis.patch.yml`），其注释写明这些行归 preset 所有——两边都禁用，会话就一点压缩都没有。

这三行由 `3052a72a87` 引入，其提交信息是"增加一个query志愿规则工具，增加高考skill，disable无关tool"。那次提交批量禁用了与任务无关的若干行；压缩虽然不是工具，也跟着被禁用了。

## 决策

删除三行 `disabled: true`，使该组与 `standard`、`ptc` 挂载的内容一致。裁剪器的配置（`thresholdChars: 8192`、`headChars: 4096`、`tailChars: 1024`）、该组的 `isolate` 键、以及 `token-meter` 留在宿主平面这几点都不变。

预设组合在进程内以"常驻挂载"缓存，指纹取自组合文件的 `mtimeMs` 与大小；`ensureStanding` 的设计是：指纹变化时丢弃该代并重新读文件，因此编辑文件本应在下一个会话生效、无需重启。但这次没有生效：在运行中的 Web 进程里创建会话持续失败，而客户端毫无提示，因为它的失败路径只有 `console.warn('new session failed:', …)`。重启 `pnpm dsh web` 之后，下一个会话才挂载上恢复后的组——这就是下文把重启记为可靠做法而非例行步骤的原因。

## 考虑过的替代方案

**保持该预设不压缩，把默认预设改成 `standard`。** 本机 `settings.yaml` 设的是 `agent-presets.default: cordis`，因为这个预设带着高考助手 persona 与自指的 Cordis 工具集；为了换回压缩而改默认预设，等于丢掉这些定制。

**保留禁用行并在旁边写明理由。** 这次禁用是批量编辑的连带产物、不是一个决策，写注释等于把一个意外固化成结论。

**相信常驻挂载的指纹机制，不写重启提示。** 实测相反：被编辑的文件没有到达运行中的进程，所以这条记录明确写出重启。

## 后果

`cordis` 上的会话重新具备压缩能力：按路由模型上下文窗口的 0.8 触发自动压缩并原样保留 16%、`/compact` 手动压缩、超过 8192 字符的工具结果被裁成 4096 字符头加 1024 字符尾。改动之前创建的会话仍保留创建时的组合；恢复的行只对之后创建的会话生效。

在这个部署上编辑预设文件的人都应假定需要重启：这里的指纹刷新没有生效，而组合失败的会话只在浏览器控制台里报告。

## 测试

`node_modules/.bin/vitest run packages/preset/agent-presets/tests/shipped-root.spec.ts` 会加载每一个内置预设——该文件能解析、能挂载，且没有任何用例涉及这几行。同一个预设下的 headless 会话能创建并跑完一轮（`pnpm dsh --profile headless "只回复 ok"` 打印 `ok`），这一步会真正挂载恢复后的组。改动本身用 `git diff` 读回核对：恰好三行删除，没有别的。重启后创建的 Web 会话在其投影缓存里记录 `agentPreset: cordis`。

## 未做

运行中的进程为什么没有走通常驻挂载的指纹刷新，没有进一步调查；记录里给出的是重启这个绕过手段。该预设里 `tool-workflow` 仍处于禁用状态，这与 `shipped-root.spec.ts:151` 的断言冲突，属于本地定制带来的既有失败，本次未动。
