import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { initBus, resetBus } from './bus.js'
import { JsonlAdapter } from './storage/jsonl-adapter.js'
import {
  initPresence,
  rehydratePresence,
  joinPresence,
  leavePresence,
  getPresent,
  isPresent,
  getAllPresent,
  resetPresence,
  EXPIRY_TTL,
  presenceChannel,
} from './presence.js'

describe('Presence Registry', () => {
  let tmpDir
  let adapter

  beforeEach(async () => {
    resetPresence()
    resetBus()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-test-'))
    adapter = new JsonlAdapter({ root: tmpDir })
    await adapter.init()
    initBus(adapter)
    initPresence()
  })

  afterEach(() => {
    resetPresence()
    resetBus()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('joinPresence', () => {
    it('registers an agent and makes it visible via getPresent (without rehydrate)', async () => {
      // joinPresence should update the registry directly — no rehydrate needed
      await joinPresence({
        widgetId: 'agent-direct',
        senderName: 'Direct',
        branch: 'main',
        canvasId: 'canvas-1',
      })

      const present = getPresent('main', 'canvas-1')
      expect(present).toHaveLength(1)
      expect(present[0].widgetId).toBe('agent-direct')
      expect(present[0].senderName).toBe('Direct')
    })

    it('registers an agent and makes it visible via getPresent', async () => {
      // rehydrate subscribes to the channel so published events update the registry
      await rehydratePresence('main', 'canvas-1')

      await joinPresence({
        widgetId: 'agent-1',
        senderName: 'Alice',
        branch: 'main',
        canvasId: 'canvas-1',
      })

      const present = getPresent('main', 'canvas-1')
      expect(present).toHaveLength(1)
      expect(present[0].widgetId).toBe('agent-1')
      expect(present[0].senderName).toBe('Alice')
    })

    it('returns a stop() handle that clears the agent', async () => {
      await rehydratePresence('main', 'canvas-1')

      const { stop } = await joinPresence({
        widgetId: 'agent-2',
        senderName: 'Bob',
        branch: 'main',
        canvasId: 'canvas-1',
      })

      expect(isPresent('agent-2')).not.toBeNull()
      stop()
      expect(isPresent('agent-2')).toBeNull()
    })

    it('replaces previous heartbeat timer on re-join', async () => {
      await rehydratePresence('main', 'canvas-1')

      const { stop: stop1 } = await joinPresence({
        widgetId: 'agent-3',
        senderName: 'Carol',
        branch: 'main',
        canvasId: 'canvas-1',
      })

      const { stop: stop2 } = await joinPresence({
        widgetId: 'agent-3',
        senderName: 'Carol v2',
        branch: 'main',
        canvasId: 'canvas-1',
      })

      const present = getPresent('main', 'canvas-1')
      expect(present).toHaveLength(1)
      expect(present[0].senderName).toBe('Carol v2')

      stop1() // should not crash even though timer was already replaced
      stop2()
    })

    it('includes optional agentType and capabilities', async () => {
      await rehydratePresence('main', 'canvas-1')

      const { stop } = await joinPresence({
        widgetId: 'agent-4',
        senderName: 'DevBot',
        branch: 'main',
        canvasId: 'canvas-1',
        agentType: 'copilot',
        capabilities: { tools: true },
      })

      const entry = isPresent('agent-4')
      expect(entry.agentType).toBe('copilot')
      expect(entry.capabilities).toEqual({ tools: true })
      stop()
    })
  })

  describe('getPresent / isPresent / getAllPresent', () => {
    it('filters by branch and canvasId', async () => {
      await rehydratePresence('main', 'c1')
      await rehydratePresence('main', 'c2')
      await rehydratePresence('dev', 'c1')

      const { stop: s1 } = await joinPresence({ widgetId: 'a', senderName: 'A', branch: 'main', canvasId: 'c1' })
      const { stop: s2 } = await joinPresence({ widgetId: 'b', senderName: 'B', branch: 'main', canvasId: 'c2' })
      const { stop: s3 } = await joinPresence({ widgetId: 'c', senderName: 'C', branch: 'dev', canvasId: 'c1' })

      expect(getPresent('main', 'c1')).toHaveLength(1)
      expect(getPresent('main', 'c2')).toHaveLength(1)
      expect(getPresent('dev', 'c1')).toHaveLength(1)
      expect(getAllPresent()).toHaveLength(3)

      s1(); s2(); s3()
    })

    it('returns null for unknown widgets', () => {
      expect(isPresent('nonexistent')).toBeNull()
    })
  })

  describe('expiry', () => {
    it('expires entries older than EXPIRY_TTL', async () => {
      await rehydratePresence('main', 'canvas-1')

      const { stop } = await joinPresence({
        widgetId: 'old-agent',
        senderName: 'OldBot',
        branch: 'main',
        canvasId: 'canvas-1',
      })

      // Fast-forward time past expiry
      vi.useFakeTimers()
      vi.advanceTimersByTime(EXPIRY_TTL + 1)

      expect(isPresent('old-agent')).toBeNull()
      expect(getPresent('main', 'canvas-1')).toHaveLength(0)

      vi.useRealTimers()
      stop()
    })
  })

  describe('rehydratePresence', () => {
    it('rebuilds registry from persisted bus events', async () => {
      // First: join and persist events to the bus
      const { stop } = await joinPresence({
        widgetId: 'persist-agent',
        senderName: 'PersistBot',
        branch: 'feat',
        canvasId: 'canvas-x',
      })
      stop()

      // Reset in-memory state (simulates server restart)
      resetPresence()
      initPresence()

      // Rehydrate from log
      await rehydratePresence('feat', 'canvas-x')

      // Agent should be recovered (if within TTL)
      const entry = isPresent('persist-agent')
      expect(entry).not.toBeNull()
      expect(entry.senderName).toBe('PersistBot')
    })
  })

  describe('presenceChannel', () => {
    it('formats channel name correctly', () => {
      expect(presenceChannel('main', 'canvas-1')).toBe('presence:main:canvas-1')
      expect(presenceChannel('0.5.0--messaging-bus', 'tiles')).toBe('presence:0.5.0--messaging-bus:tiles')
    })
  })

  describe('leavePresence', () => {
    it('removes agent from registry and stops heartbeat', async () => {
      await joinPresence({
        widgetId: 'leaving-agent',
        senderName: 'Leaver',
        branch: 'main',
        canvasId: 'canvas-1',
      })

      expect(isPresent('leaving-agent')).not.toBeNull()
      leavePresence('leaving-agent')
      expect(isPresent('leaving-agent')).toBeNull()
    })

    it('is safe to call for unknown widget', () => {
      expect(() => leavePresence('nonexistent')).not.toThrow()
    })
  })
})
