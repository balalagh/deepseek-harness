/**
 * Overseer plugin for the 高考 (gaokao) data-query microservice: it starts the
 * local `uvicorn main:app` process once the host Web server has bound its port,
 * waits for the service's health endpoint to answer, and terminates the child
 * process when the plugin is disposed. The same directory holds the FastAPI +
 * PyMySQL service (`main.py`), which reads its database credentials from the
 * sibling `.env` and never from this plugin.
 * @module @deepseek-ai/dsh-gaokao-api
 */

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import z from '@deepseek-ai/schemastery'

/** Cordis plugin name for loader diagnostics. */
export const name = 'gaokao-api'

/**
 * Services this plugin requires: `webServer` orders the launch after the Web
 * server binds its port, and `subprocess` owns the child process range.
 */
export const inject = ['webServer', 'subprocess']

const DEFAULT_COMMAND = 'python'
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 8901
const DEFAULT_HEALTH_PATH = '/health'
const DEFAULT_READY_TIMEOUT_MS = 30_000
const DEFAULT_GRACE_MS = 2_000
/** Polling cadence while waiting for the health endpoint to answer. */
const READY_POLL_INTERVAL_MS = 500
/** Bound for one health probe, so a half-open connection cannot hold the wait. */
const PROBE_TIMEOUT_MS = 2_000
/** Retained stdout/stderr tail per stream, surfaced when the launch fails. */
const STDIO_TAIL_BYTES = 8_192

/** Plugin configuration: the child command and the endpoint that proves readiness. */
export interface Config {
  /**
   * Directory holding `main.py` and its `.env`. Defaults to this package's own
   * directory, which is where the bundled service lives.
   */
  apiDir?: string
  /** Executable to spawn. Defaults to `python`. */
  command?: string
  /** Arguments passed to the command (no shell). Defaults to the uvicorn argv for `host`/`port`. */
  args?: string[]
  /** Host the service binds and this plugin probes. Defaults to `127.0.0.1`. */
  host?: string
  /** Port the service binds and this plugin probes. Defaults to `8901`. */
  port?: number
  /** Health path polled until it answers 2xx. Defaults to `/health`. */
  healthPath?: string
  /** Budget for readiness polling before the launch fails. Defaults to `30000`. */
  readyTimeoutMs?: number
  /** Termination grace handed to `ctx.subprocess`. Defaults to `2000`. */
  graceMs?: number
}

export const Config: z<Config> = z.object({
  apiDir: z.string(),
  command: z.string().default(DEFAULT_COMMAND),
  args: z.array(String),
  host: z.string().default(DEFAULT_HOST),
  port: z.number().max(65535).default(DEFAULT_PORT),
  healthPath: z.string().default(DEFAULT_HEALTH_PATH),
  readyTimeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_READY_TIMEOUT_MS),
  graceMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_GRACE_MS),
})

/** One launch after every default has been applied. */
export interface LaunchSpec {
  /** Working directory the service starts in, so it reads its sibling `.env`. */
  cwd: string
  /** Complete child argv: the command followed by its service arguments. */
  argv: readonly string[]
  /** Absolute health endpoint polled until it answers. */
  healthUrl: string
  /** Budget for readiness polling. */
  readyTimeoutMs: number
  /** Termination grace handed to `ctx.subprocess`. */
  graceMs: number
}

/**
 * Read one configured string, falling back for the two shapes an absent value
 * takes: `undefined`, and the empty string a config layer may materialize.
 * @param value - configured value.
 * @param fallback - value used when the configuration named none.
 * @returns the configured value, or the fallback.
 */
function configured(value: string | undefined, fallback: string): string {
  return value === undefined || value === '' ? fallback : value
}

/**
 * Apply the plugin's defaults to one configuration. Defaults live here rather
 * than inside {@link apply}, so the resolved launch is inspectable and testable
 * on its own.
 * @param config - validated plugin configuration.
 * @returns the fully specified launch this plugin performs.
 */
export function resolveLaunchSpec(config: Config): LaunchSpec {
  const host = configured(config.host, DEFAULT_HOST)
  const port = config.port ?? DEFAULT_PORT
  const args = config.args === undefined || config.args.length === 0
    ? ['-m', 'uvicorn', 'main:app', '--host', host, '--port', String(port)]
    : config.args
  const healthPath = configured(config.healthPath, DEFAULT_HEALTH_PATH)
  return {
    // src/index.ts and the bundled lib/index.js both sit one directory below
    // the package root, which is where main.py and its .env live.
    cwd: configured(config.apiDir, dirname(dirname(fileURLToPath(import.meta.url)))),
    argv: [configured(config.command, DEFAULT_COMMAND), ...args],
    healthUrl: `http://${host}:${port}${healthPath.startsWith('/') ? healthPath : `/${healthPath}`}`,
    readyTimeoutMs: config.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
    graceMs: config.graceMs ?? DEFAULT_GRACE_MS,
  }
}

/**
 * Probe the health endpoint once.
 * @param healthUrl - absolute health endpoint.
 * @returns true when the endpoint answered with a 2xx status.
 */
async function isHealthy(healthUrl: string): Promise<boolean> {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    return response.ok
  } catch {
    // Only the connection layer is swallowed: a refused, reset, or timed-out
    // connection IS the "not ready" answer this probe exists to observe.
    return false
  }
}

/** Exit facts of one child, or the failure that replaced them. */
interface ChildSettlement {
  /** Exit facts; present once the child exited on its own. */
  outcome?: SubprocessOutcome
  /** Spawn or provider failure; present when `done` rejected. */
  failure?: unknown
}

/**
 * Describe one failed launch, appending the retained stderr tail when the child
 * wrote one.
 * @param spec - the launch that failed.
 * @param handle - the spawned child.
 * @param reason - why the launch failed.
 * @returns the error this plugin throws.
 */
function launchFailed(spec: LaunchSpec, handle: SubprocessHandle, reason: string): Error {
  const tail = handle.collected.stderr?.readFrom(0).text.trim() ?? ''
  const detail = tail === '' ? '' : `; stderr tail: ${tail}`
  return new Error(`gaokao-api: launch from ${spec.cwd} failed: ${reason}${detail}`)
}

/**
 * Poll the health endpoint until it answers, the child dies, or the budget runs
 * out.
 * @param handle - the spawned child.
 * @param spec - the launch being awaited.
 * @param settlement - exit facts observed so far.
 * @throws when the child exited, failed to start, or never became ready.
 */
async function waitUntilReady(
  handle: SubprocessHandle,
  spec: LaunchSpec,
  settlement: ChildSettlement,
): Promise<void> {
  const deadline = Date.now() + spec.readyTimeoutMs
  for (;;) {
    if (await isHealthy(spec.healthUrl)) return
    if (settlement.outcome !== undefined) {
      throw launchFailed(spec, handle, `process exited (exit=${settlement.outcome.exitCode}, signal=${settlement.outcome.signal})`)
    }
    if (settlement.failure !== undefined) {
      const detail = settlement.failure instanceof Error ? settlement.failure.message : JSON.stringify(settlement.failure)
      throw launchFailed(spec, handle, `process start failed: ${detail}`)
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw launchFailed(spec, handle, `not ready at ${spec.healthUrl} within ${spec.readyTimeoutMs}ms`)
    await new Promise(resolve => setTimeout(resolve, Math.min(READY_POLL_INTERVAL_MS, remaining)))
  }
}

/**
 * Start the gaokao-api service after the host Web server binds, and own the
 * child process for the rest of this plugin's life. An instance already
 * answering the health endpoint is reused, not replaced: this plugin never
 * adopts a process it did not start, and never terminates one it did not adopt.
 * @param ctx - plugin context providing `webServer` and `subprocess`.
 * @param config - validated plugin configuration.
 * @throws when the child cannot be started or does not become ready in time.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const spec = resolveLaunchSpec(config)
  if (await isHealthy(spec.healthUrl)) {
    ctx.logger.info(`gaokao-api: ${spec.healthUrl} is already serving; reusing it without adopting the process`)
    return
  }
  const handle = ctx.subprocess.spawn({
    argv: spec.argv,
    cwd: spec.cwd,
    stdio: { stdin: 'ignore', stdout: { maxBytes: STDIO_TAIL_BYTES }, stderr: { maxBytes: STDIO_TAIL_BYTES } },
    graceMs: spec.graceMs,
  })
  const settlement: ChildSettlement = {}
  let stopping = false
  handle.done.then(
    (outcome) => {
      settlement.outcome = outcome
      if (!stopping) ctx.logger.warn(`gaokao-api: child exited (exit=${outcome.exitCode}, signal=${outcome.signal}); gaokao tools will report fetch failed until the service runs again`)
    },
    (failure: unknown) => {
      settlement.failure = failure
      const detail = failure instanceof Error ? failure.message : JSON.stringify(failure)
      if (!stopping) ctx.logger.warn(`gaokao-api: child failed: ${detail}`)
    },
  )
  ctx.effect(() => async () => {
    stopping = true
    handle.terminate()
    await handle.waitForExit()
  }, 'gaokao-api.process')
  await waitUntilReady(handle, spec, settlement)
  ctx.logger.info(`gaokao-api: serving at ${spec.healthUrl}`)
}
