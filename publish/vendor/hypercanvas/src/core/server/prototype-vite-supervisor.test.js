import { describe, expect, it, vi } from 'vitest'
import { createPrototypeViteSupervisor } from './prototype-vite-supervisor.js'

function fakeChild() {
  const listeners = new Map()
  const child = {
    killed: false,
    once(event, listener) { listeners.set(event, listener) },
    removeAllListeners() { listeners.clear() },
    removeListener(event) { listeners.delete(event) },
    kill: vi.fn(() => { child.killed = true }),
    exit() { listeners.get('exit')?.() },
    error(error) { listeners.get('error')?.(error) },
  }
  return child
}

function fakeTimers() {
  let nextId = 0
  const pending = new Map()
  return {
    setTimeout: vi.fn((callback, delay) => {
      const id = ++nextId
      pending.set(id, { callback, delay })
      return id
    }),
    clearTimeout: vi.fn((id) => pending.delete(id)),
    runNext() {
      const [id, timer] = pending.entries().next().value
      pending.delete(id)
      timer.callback()
    },
    pending,
  }
}

describe('prototype Vite supervisor', () => {
  it('starts one child and marks it ready from the injected probe', async () => {
    const child = fakeChild()
    const probe = vi.fn().mockResolvedValue(true)
    const spawnProcess = vi.fn(() => child)
    const supervisor = createPrototypeViteSupervisor({ command: 'vite', args: ['--host'], url: 'http://vite', probe, spawnProcess })

    await supervisor.start()

    expect(spawnProcess).toHaveBeenCalledWith('vite', ['--host'], expect.objectContaining({ stdio: 'pipe' }))
    expect(probe).toHaveBeenCalledWith('http://vite')
    expect(supervisor.ready).toBe(true)
  })

  it('restarts exited children with backoff and stops at the configured limit', async () => {
    const first = fakeChild()
    const second = fakeChild()
    const third = fakeChild()
    const fourth = fakeChild()
    const children = [first, second, third, fourth]
    const timers = fakeTimers()
    const spawnProcess = vi.fn(() => children.shift())
    const onRestart = vi.fn()
    const supervisor = createPrototypeViteSupervisor({
      command: 'vite',
      probe: vi.fn().mockResolvedValue(true),
      spawnProcess,
      timers,
      restartBackoffMs: [10, 20],
      maxRestarts: 2,
      onRestart,
    })

    await supervisor.start()
    first.exit()
    expect(onRestart).toHaveBeenCalledWith({ attempt: 1, delay: 10 })
    expect(timers.setTimeout).toHaveBeenCalledWith(expect.any(Function), 10)
    timers.runNext()
    await Promise.resolve()
    second.exit()
    expect(onRestart).toHaveBeenLastCalledWith({ attempt: 2, delay: 20 })
    timers.runNext()
    await Promise.resolve()
    third.exit()

    expect(spawnProcess).toHaveBeenCalledTimes(3)
    expect(supervisor.restartCount).toBe(2)
    expect(timers.pending.size).toBe(0)
  })

  it('kills the child and cancels pending probes on close', async () => {
    const child = fakeChild()
    const timers = fakeTimers()
    const supervisor = createPrototypeViteSupervisor({ command: 'vite', probe: vi.fn().mockResolvedValue(false), spawnProcess: () => child, timers })

    await supervisor.start()
    await supervisor.close()

    expect(child.kill).toHaveBeenCalledOnce()
    expect(timers.clearTimeout).toHaveBeenCalled()
    expect(supervisor.closed).toBe(true)
    expect(supervisor.child).toBe(null)
  })
})
