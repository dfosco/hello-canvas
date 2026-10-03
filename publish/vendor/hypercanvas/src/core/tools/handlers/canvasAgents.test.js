import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../index.js', () => ({
  getConfig: vi.fn(() => ({ agents: { codex: {} } })),
}))

import { getConfig } from '../../index.js'
import { guard } from './canvasAgents.js'

describe('canvas agents tool guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/')
    delete window.__SB_LOCAL_DEV__
  })

  it('hides the agent menu outside local development', async () => {
    expect(await guard()).toBe(false)
    expect(getConfig).not.toHaveBeenCalled()
  })

  it('shows the configured agent menu in local development', async () => {
    window.__SB_LOCAL_DEV__ = true

    expect(await guard()).toBe(true)
    expect(getConfig).toHaveBeenCalledWith('canvas')
  })

  it('hides the agent menu in local production-mode simulation', async () => {
    window.__SB_LOCAL_DEV__ = true
    window.history.replaceState({}, '', '/?prodMode')

    expect(await guard()).toBe(false)
    expect(getConfig).not.toHaveBeenCalled()
  })
})
