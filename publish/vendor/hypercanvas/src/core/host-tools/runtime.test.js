import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('./preflight.js', () => ({ preflightHostTools: vi.fn() }))

import { preflightHostTools } from './preflight.js'
import {
  buildHostWorkloadEnv,
  HOST_RUNTIME_ERROR_CODES,
  quoteShellWord,
  reassertHostPath,
  resolveAgentHostRuntime,
  resolveTerminalHostRuntime,
  rewriteAgentConfig,
} from './runtime.js'

describe('host workload runtime', () => {
  let root
  let hostBin
  let bundleRoot
  let original

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'storyboard-host-runtime-'))
    hostBin = join(root, 'host-bin')
    bundleRoot = join(root, 'bundle')
    mkdirSync(hostBin)
    mkdirSync(join(bundleRoot, 'bin'), { recursive: true })
    original = { ...process.env }
    process.env.HOME = root
    process.env.HYPERCANVAS_HOST_PATH = `${join(bundleRoot, 'bin')}:${hostBin}`
    process.env.HYPERCANVAS_BUNDLE_ROOT = bundleRoot
    process.env.PATH = `${join(bundleRoot, 'bin')}:${hostBin}`
    process.env.NODE_PATH = join(bundleRoot, 'node_modules')
    process.env.npm_execpath = join(bundleRoot, 'npm-cli.js')
    process.env.npm_node_execpath = join(bundleRoot, 'node')
    process.env.OPENAI_API_KEY = 'preserved'
    process.env.DATABASE_URL = 'postgres://local/project'
    process.env.PASEO_DAEMON_URL = 'ws://127.0.0.1:45678/ws'
    process.env.PASEO_DAEMON_PASSWORD = 'daemon-password'
    process.env.PASEO_DAEMON_AUTH_HEADER = 'daemon-auth'
    process.env.PASEO_PASSWORD = 'server-password'
    process.env.HYPERCANVAS_LAUNCH_TOKEN = 'browser-token'
  })

  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, original)
    rmSync(root, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('builds an allowlisted terminal environment from sanitized host paths', () => {
    const runtime = resolveTerminalHostRuntime(root)
    const env = buildHostWorkloadEnv(runtime, {
      STORYBOARD_PROJECT_ROOT: root,
      STORYBOARD_WIDGET_ID: 'terminal-one',
      NODE_PATH: '/caller/injection',
    })

    expect(runtime.cwd).toBe(root)
    expect(env.PATH).toBe(`${join(root, '.storyboard', 'terminals', 'bin')}:${runtime.hostPath}`)
    expect(env.HYPERCANVAS_HOST_PATH).toBe(runtime.hostPath)
    expect(runtime.hostPath).toContain(realpathSync(hostBin))
    expect(runtime.hostPath).not.toContain(bundleRoot)
    expect(env).not.toHaveProperty('NODE_PATH')
    expect(env).not.toHaveProperty('npm_execpath')
    expect(env).not.toHaveProperty('npm_node_execpath')
    expect(env.OPENAI_API_KEY).toBe('preserved')
    expect(env.DATABASE_URL).toBe('postgres://local/project')
    expect(env).not.toHaveProperty('PASEO_DAEMON_URL')
    expect(env).not.toHaveProperty('PASEO_DAEMON_PASSWORD')
    expect(env).not.toHaveProperty('PASEO_DAEMON_AUTH_HEADER')
    expect(env).not.toHaveProperty('PASEO_PASSWORD')
    expect(env).not.toHaveProperty('HYPERCANVAS_LAUNCH_TOKEN')
    expect(env).not.toHaveProperty('HYPERCANVAS_BUNDLE_ROOT')
    expect(env.STORYBOARD_WIDGET_ID).toBe('terminal-one')
  })

  it('verifies a closed-catalog agent and rewrites only configured executable tokens', async () => {
    const executablePath = join(hostBin, 'codex')
    writeFileSync(executablePath, '#!/bin/sh\n')
    preflightHostTools.mockResolvedValue({
      status: 'supported',
      environment: resolveTerminalHostRuntime(root).environment,
      baseline: { status: 'valid', node: { path: join(hostBin, 'node') }, npm: { path: join(hostBin, 'npm') } },
      agents: { codex: { status: 'installed', path: executablePath } },
    })

    const runtime = await resolveAgentHostRuntime(root, 'codex')
    const config = rewriteAgentConfig(runtime, {
      startupCommand: 'codex --dangerously-bypass-approvals-and-sandbox',
      resumeCommand: 'codex resume {id}',
      contextAdapter: { type: 'codex-queue', command: 'codex', timeoutMs: 15000 },
    })

    expect(config.startupCommand).toBe(`${quoteShellWord(executablePath)} --dangerously-bypass-approvals-and-sandbox`)
    expect(config.resumeCommand).toBe(`${quoteShellWord(executablePath)} resume {id}`)
    expect(config.contextAdapter.command).toBe(quoteShellWord(executablePath))
    expect(reassertHostPath(runtime, config.startupCommand)).toContain(`export PATH=${quoteShellWord(runtime.path)}`)
    expect(runtime.hostPath.split(':')[0]).toBe(hostBin)
  })

  it('uses an injected preflight snapshot without probing installed host tools', async () => {
    const executablePath = join(hostBin, 'codex')
    const snapshot = {
      status: 'supported',
      environment: resolveTerminalHostRuntime(root).environment,
      baseline: { status: 'valid', node: { path: join(hostBin, 'node') }, npm: { path: join(hostBin, 'npm') } },
      agents: { codex: { status: 'installed', path: executablePath } },
    }
    const preflight = vi.fn(async () => snapshot)

    const runtime = await resolveAgentHostRuntime(root, 'codex', { preflight })

    expect(preflight).toHaveBeenCalledOnce()
    expect(preflightHostTools).not.toHaveBeenCalled()
    expect(runtime.executablePath).toBe(executablePath)
  })

  it('accepts an already rewritten executable whose absolute path contains spaces', async () => {
    const spacedBin = join(root, 'host tools')
    mkdirSync(spacedBin)
    const executablePath = join(spacedBin, 'codex')
    writeFileSync(executablePath, '#!/bin/sh\n')
    preflightHostTools.mockResolvedValue({
      status: 'supported',
      environment: { ...resolveTerminalHostRuntime(root).environment, entries: [spacedBin], path: spacedBin },
      baseline: { status: 'valid', node: { path: join(spacedBin, 'node') }, npm: { path: join(spacedBin, 'npm') } },
      agents: { codex: { status: 'installed', path: executablePath } },
    })

    const runtime = await resolveAgentHostRuntime(root, 'codex')
    const rewritten = rewriteAgentConfig(runtime, { startupCommand: 'codex --version' }).startupCommand
    expect(rewriteAgentConfig(runtime, { startupCommand: rewritten }).startupCommand).toBe(rewritten)
  })

  it('fails closed for unknown, unverified, and invalid configured agents', async () => {
    await expect(resolveAgentHostRuntime(root, 'custom-agent')).rejects.toMatchObject({
      code: HOST_RUNTIME_ERROR_CODES.AGENT_UNKNOWN,
    })

    preflightHostTools.mockResolvedValue({
      status: 'supported',
      environment: resolveTerminalHostRuntime(root).environment,
      baseline: { status: 'valid', node: { path: join(hostBin, 'node') }, npm: { path: join(hostBin, 'npm') } },
      agents: { codex: { status: 'missing', path: null } },
    })
    await expect(resolveAgentHostRuntime(root, 'codex')).rejects.toMatchObject({
      code: HOST_RUNTIME_ERROR_CODES.AGENT_UNAVAILABLE,
    })
  })
})
