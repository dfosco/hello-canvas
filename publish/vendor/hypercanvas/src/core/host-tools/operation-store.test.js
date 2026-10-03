import { describe, expect, it } from 'vitest'
import { createOperationStore, redactOperationOutput } from './operation-store.js'

function clock() {
  let value = Date.parse('2026-08-31T12:00:00.000Z')
  return () => value += 1000
}

const steps = [
  { id: 'preflight', action: 'rerun' },
  { id: 'node24', action: 'install' },
]

describe('host tools operation store', () => {
  it('returns immutable polling snapshots with phase and operation timestamps', () => {
    const store = createOperationStore({ now: clock() })
    const created = store.create({ id: 'operation-1', planId: 'plan-1', selectedAgentIds: ['codex'], steps })
    store.start('operation-1')
    store.startPhase('operation-1', 'preflight')
    store.completePhase('operation-1', 'preflight', { matched: true })
    const completed = store.succeed('operation-1', { baseline: 'valid' })

    expect(created).toMatchObject({ status: 'queued', createdAt: expect.any(String), updatedAt: expect.any(String) })
    expect(completed).toMatchObject({
      status: 'succeeded',
      startedAt: expect.any(String),
      completedAt: expect.any(String),
      phases: [{ id: 'preflight', status: 'succeeded' }, { id: 'node24', status: 'pending' }],
    })
    expect(Object.isFrozen(completed)).toBe(true)
    expect(Object.isFrozen(completed.phases[0])).toBe(true)
    expect(() => { completed.status = 'changed' }).toThrow()
    expect(store.get('operation-1').status).toBe('succeeded')
  })

  it('redacts sensitive values and bounds retained output', () => {
    const store = createOperationStore({ now: clock(), maxOutputBytes: 80 })
    store.create({ id: 'operation-1', planId: 'plan-1', selectedAgentIds: [], steps })
    store.appendOutput('operation-1', {
      phase: 'node24',
      stream: 'stderr',
      text: `token=top-secret Authorization: Bearer abc.def password=hunter2 https://user:pass@example.test/${'x'.repeat(100)}`,
    })
    const snapshot = store.get('operation-1')

    expect(snapshot.output.map(({ text }) => text).join('\n')).not.toMatch(/top-secret|abc\.def|hunter2|user:pass/)
    expect(snapshot.output.map(({ text }) => text).join('\n')).toContain('[output truncated]')
    expect(snapshot.outputBytes).toBeLessThanOrEqual(80)
    expect(snapshot.outputTruncated).toBe(true)
    expect(redactOperationOutput('api_key=secret')).toBe('api_key=[REDACTED]')
  })

  it('enforces one active operation and releases it after partial failure', () => {
    const store = createOperationStore({ now: clock() })
    store.create({ id: 'operation-1', planId: 'plan-1', selectedAgentIds: [], steps })
    expect(() => store.create({ id: 'operation-2', planId: 'plan-2', selectedAgentIds: [], steps })).toThrowError(expect.objectContaining({ code: 'OPERATION_ACTIVE' }))
    store.start('operation-1')
    store.startPhase('operation-1', 'node24', { cancellable: true })
    store.completePhase('operation-1', 'node24', { installed: true })
    store.fail('operation-1', { code: 'VERIFY_FAILED' }, { partialSuccess: true })

    expect(store.getActive()).toBeNull()
    expect(store.get('operation-1')).toMatchObject({ status: 'failed', result: { partialSuccess: true } })
    expect(() => store.create({ id: 'operation-2', planId: 'plan-2', selectedAgentIds: [], steps })).not.toThrow()
  })

  it('reports cancellation honestly when the current phase is not cancellable', () => {
    const store = createOperationStore({ now: clock() })
    store.create({ id: 'operation-1', planId: 'plan-1', selectedAgentIds: [], steps })
    store.start('operation-1')
    store.startPhase('operation-1', 'preflight', { cancellationState: 'terminal_handoff_non_cancellable' })
    const requested = store.requestCancellation('operation-1')

    expect(requested.accepted).toBe(false)
    expect(requested.snapshot.cancellation).toEqual({
      requested: true,
      available: false,
      state: 'terminal_handoff_non_cancellable',
    })
    expect(store.cancel('operation-1', { partialSuccess: false }).status).toBe('cancelled')
  })
})
