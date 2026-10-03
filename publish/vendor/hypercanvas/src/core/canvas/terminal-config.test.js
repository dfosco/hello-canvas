import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  initTerminalConfig,
  writeTerminalConfig,
  recordAgentSession,
  getLastAgentSession,
  getConfigKey,
} from './terminal-config.js'

let root
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sb-term-cfg-'))
  initTerminalConfig(root)
})
afterEach(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* empty */ } })

describe('terminal-config: agent session persistence', () => {
  it('records and reads back the captured session id, agent id, and timestamp', () => {
    writeTerminalConfig({
      branch: 'main',
      canvasId: 'design',
      widgetId: 'agent-foo',
      serverUrl: 'http://localhost:1234',
    })
    recordAgentSession({
      branch: 'main',
      canvasId: 'design',
      widgetId: 'agent-foo',
      agentId: 'copilot',
      sessionId: 'abcd-1234',
    })
    const got = getLastAgentSession({ branch: 'main', canvasId: 'design', widgetId: 'agent-foo' })
    expect(got?.sessionId).toBe('abcd-1234')
    expect(got?.agentId).toBe('copilot')
    expect(typeof got?.capturedAt).toBe('string')
  })

  it('returns null when no session has been recorded', () => {
    writeTerminalConfig({ branch: 'main', canvasId: 'c', widgetId: 'agent-bar' })
    expect(getLastAgentSession({ branch: 'main', canvasId: 'c', widgetId: 'agent-bar' })).toBeNull()
  })

  it('no-ops on empty session id', () => {
    writeTerminalConfig({ branch: 'main', canvasId: 'c', widgetId: 'agent-baz' })
    const result = recordAgentSession({ branch: 'main', canvasId: 'c', widgetId: 'agent-baz', sessionId: '' })
    expect(result).toBeNull()
  })

  it('exposes a stable per-widget config key', () => {
    const a = getConfigKey('main', 'design', 'agent-x')
    const b = getConfigKey('main', 'design', 'agent-x')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(getConfigKey('other', 'design', 'agent-x')).not.toBe(a)
  })
})
