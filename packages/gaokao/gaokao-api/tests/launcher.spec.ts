/**
 * Behavior tests for the gaokao-api launcher: reuse, launch plus disposal, and
 * the two loud launch failures. The child is a Node fixture, so the whole
 * lifecycle runs without a Python interpreter.
 * @module @deepseek-ai/dsh-gaokao-api/tests
 */

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as gaokaoApi from '../src/index.ts'
import { resolveLaunchSpec } from '../src/index.ts'

/** The Web server this plugin waits for; the tests only need it to exist. */
class FakeWebServer extends Service {
  constructor(ctx: Context) {
    super(ctx, 'webServer')
  }
}

const FIXTURE = fileURLToPath(new URL('./fixtures/health-server.mjs', import.meta.url))

/** Reserve a loopback port by binding and immediately releasing it. */
async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve() }) })
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  return port
}

/** Start a real health endpoint in this process, standing in for an outsider. */
async function serveHealth(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"status":"ok"}')
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve() }) })
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve() }) }),
  }
}

/** One readiness probe, mirroring what the plugin polls. */
async function healthy(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })
    return response.ok
  } catch {
    return false
  }
}

describe('gaokao-api launcher', () => {
  let ctx: Context
  let outsider: { port: number; close: () => Promise<void> } | undefined

  beforeEach(async () => {
    ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(FakeWebServer)
  })

  afterEach(async () => {
    await outsider?.close()
    outsider = undefined
    await ctx.fiber.dispose()
  })

  it('reuses an instance that already answers /health instead of adopting it', async () => {
    outsider = await serveHealth()
    const spawn = vi.spyOn(ctx.subprocess, 'spawn')

    await ctx.plugin(gaokaoApi, { port: outsider.port })

    expect(spawn).not.toHaveBeenCalled()
  })

  it('starts the service and terminates it when the plugin is disposed', async () => {
    const port = await freePort()

    const fiber = await ctx.plugin(gaokaoApi, {
      command: process.execPath,
      args: [FIXTURE, String(port), 'serve'],
      port,
      readyTimeoutMs: 10_000,
      graceMs: 1_000,
    })
    expect(await healthy(port)).toBe(true)

    await fiber.dispose()
    expect(await healthy(port)).toBe(false)
  })

  it('fails loudly when the child exits before it serves', async () => {
    const port = await freePort()

    await expect(ctx.plugin(gaokaoApi, {
      command: process.execPath,
      args: [FIXTURE, String(port), 'fail'],
      port,
      readyTimeoutMs: 5_000,
    })).rejects.toThrow(/exit=7/)
  })

  it('reports the child stderr tail when the launch fails', async () => {
    const port = await freePort()

    await expect(ctx.plugin(gaokaoApi, {
      command: process.execPath,
      args: [FIXTURE, String(port), 'fail'],
      port,
      readyTimeoutMs: 5_000,
    })).rejects.toThrow(/boom: fixture cannot bind/)
  })

  it('fails loudly when the child never becomes ready', async () => {
    const port = await freePort()

    await expect(ctx.plugin(gaokaoApi, {
      command: process.execPath,
      args: [FIXTURE, String(port), 'hang'],
      port,
      readyTimeoutMs: 600,
      graceMs: 1_000,
    })).rejects.toThrow(/not ready/)
  })
})

describe('resolveLaunchSpec', () => {
  it('defaults to this package directory and the uvicorn argv for the configured port', () => {
    const spec = resolveLaunchSpec({})

    expect(spec.argv).toEqual(['python', '-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8901'])
    expect(spec.healthUrl).toBe('http://127.0.0.1:8901/health')
    expect(spec.cwd.endsWith('gaokao-api')).toBe(true)
  })

  it('keeps the packaged launch when a config layer materializes empty values', () => {
    const spec = resolveLaunchSpec({ apiDir: '', command: '', args: [] })

    expect(spec.cwd.endsWith('gaokao-api')).toBe(true)
    expect(spec.argv).toEqual(['python', '-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8901'])
  })

  it('normalizes a health path written without its leading slash', () => {
    const spec = resolveLaunchSpec({ host: '127.0.0.1', port: 9000, healthPath: 'ready' })

    expect(spec.healthUrl).toBe('http://127.0.0.1:9000/ready')
  })
})
