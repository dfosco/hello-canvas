import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDiagnosticsHandler, readRecentDiagnosticLogs, sanitizeDiagnostics } from './diagnostics.js'

const temporary = []
afterEach(() => temporary.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })))

describe('Core runtime diagnostics', () => {
  it('redacts secret fields, bearer values, credentials in text, and bounds strings and collections', () => {
    const snapshot = sanitizeDiagnostics({
      core: { pid: 42, sessionSecret: 'do-not-show' },
      agents: Array.from({ length: 60 }, (_, index) => ({ id: `agent-${index}` })),
      message: 'Authorization: Bearer oauth-secret PASEO_PASSWORD=local-secret https://example.test/?token=query-secret {"accessToken":"inner-secret"}',
      output: 'x'.repeat(5000),
    })

    expect(snapshot.core.sessionSecret).toBe('[redacted]')
    expect(snapshot.agents).toHaveLength(50)
    expect(snapshot.message).not.toContain('oauth-secret')
    expect(snapshot.message).not.toContain('local-secret')
    expect(snapshot.message).not.toContain('query-secret')
    expect(snapshot.message).not.toContain('inner-secret')
    expect(snapshot.output.length).toBe(2000)
  })

  it('reads only the newest bounded log entries and redacts their credential fields', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-diagnostic-logs-'))
    temporary.push(directory)
    const today = new Date('2026-09-27T12:00:00.000Z')
    const entries = Array.from({ length: 30 }, (_, index) => JSON.stringify({
      index,
      level: 'warn',
      context: { authHeader: 'do-not-show' },
      message: `PASEO_PASSWORD=secret-${index}`,
    }))
    fs.writeFileSync(path.join(directory, '2026-09-27.jsonl'), `${entries.join('\n')}\n`)

    const recent = readRecentDiagnosticLogs(directory, { now: today })

    expect(recent).toHaveLength(20)
    expect(recent[0].index).toBe(10)
    expect(recent.at(-1).index).toBe(29)
    expect(recent[0].context.authHeader).toBe('[redacted]')
    expect(recent[0].message).not.toContain('secret-10')
  })

  it('serves safe snapshots, accepts GET only, and hides internal collection failures', async () => {
    const sendJson = vi.fn()
    const handler = createDiagnosticsHandler({
      getSnapshot: async () => ({ core: { pid: 12 }, password: 'never returned' }),
      sendJson,
    })
    const response = {}

    await handler({}, response, { method: 'GET' })
    expect(sendJson).toHaveBeenCalledWith(response, 200, { core: { pid: 12 }, password: '[redacted]' })

    await handler({}, response, { method: 'POST' })
    expect(sendJson).toHaveBeenLastCalledWith(response, 405, expect.objectContaining({ error: expect.objectContaining({ code: 'METHOD_NOT_ALLOWED' }) }))

    const failed = createDiagnosticsHandler({ getSnapshot: async () => { throw new Error('token=secret') }, sendJson })
    await failed({}, response, { method: 'GET' })
    expect(sendJson).toHaveBeenLastCalledWith(response, 503, {
      error: { code: 'DIAGNOSTICS_UNAVAILABLE', message: 'Core diagnostics could not be collected.' },
    })
  })
})
