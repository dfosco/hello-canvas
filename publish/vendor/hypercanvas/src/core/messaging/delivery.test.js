import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initBus, publish, resetBus } from './bus.js'
import { readInbox } from './coordination-service.js'
import {
  bindWidget,
  flushWidget,
  getBindings,
  initDeliveryBridge,
  resetDeliveryBridge,
  terminalChannel,
  unbindWidget,
} from './delivery.js'
import { inboxChannel } from './hub-manager.js'
import { JsonlAdapter } from './storage/jsonl-adapter.js'

describe('optional delivery adapters', () => {
  let root

  beforeEach(async () => {
    resetDeliveryBridge()
    resetBus()
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-'))
    const adapter = new JsonlAdapter({ root })
    await adapter.init()
    initBus(adapter)
  })

  afterEach(() => {
    resetDeliveryBridge()
    resetBus()
    fs.rmSync(root, { recursive: true, force: true })
  })

  async function seedInbox(widgetId = 'b') {
    return publish(inboxChannel('canvas', widgetId), {
      type: 'inbox:available',
      senderId: 'a',
      senderName: 'Architect',
      body: 'Implement the schema.',
      hubId: 'hub_1',
      hubContextVersion: 1,
      payload: {
        kind: 'peer-message',
        message: {
          id: 'message_1',
          intent: 'request',
          sender: { widgetId: 'a', name: 'architect', prettyName: 'Architect' },
          body: 'Implement the schema.',
        },
      },
    })
  }

  it('keeps the legacy channel helper mapped to the durable inbox', () => {
    expect(terminalChannel('main', 'canvas', 'b')).toBe('inbox:canvas:b')
  })

  it('queues one consolidated Codex update and consumes only after success', async () => {
    await seedInbox()
    const execute = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
    initDeliveryBridge({ root, execute })
    const binding = await bindWidget({
      widgetId: 'b',
      sessionId: 'pty-session',
      branch: 'main',
      canvasId: 'canvas',
      runtime: 'codex',
      threadId: 'thread-123',
      adapter: { type: 'codex-queue', command: 'codex' },
    })
    expect(binding.proactive).toBe(true)

    const delivered = await flushWidget('b')
    expect(delivered.delivered).toBe(true)
    expect(execute).toHaveBeenCalledWith(
      'codex',
      ['queue', '--thread', 'thread-123', '--message', expect.stringContaining('Implement the schema.')],
      expect.objectContaining({ cwd: root }),
    )
    expect((await readInbox({ canvasId: 'canvas', widgetId: 'b' })).items).toEqual([])
  })

  it('leaves events pollable when Codex queue delivery fails', async () => {
    await seedInbox()
    const execute = vi.fn()
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(new Error('queue unavailable'))
    initDeliveryBridge({ root, execute })
    await bindWidget({
      widgetId: 'b',
      canvasId: 'canvas',
      runtime: 'codex',
      threadId: 'thread-123',
      adapter: { type: 'codex-queue', command: 'codex' },
    })

    const delivered = await flushWidget('b')
    expect(delivered).toEqual(expect.objectContaining({ delivered: false, reason: 'failed' }))
    expect((await readInbox({ canvasId: 'canvas', widgetId: 'b' })).items).toHaveLength(1)
  })

  it('does not proactively consume without a configured adapter', async () => {
    await seedInbox()
    initDeliveryBridge({ root, execute: vi.fn() })
    const binding = await bindWidget({
      widgetId: 'b',
      canvasId: 'canvas',
      runtime: 'codex',
      threadId: 'thread-123',
      adapter: null,
    })
    expect(binding.proactive).toBe(false)
    expect((await flushWidget('b')).reason).toBe('unsupported')
    expect((await readInbox({ canvasId: 'canvas', widgetId: 'b' })).items).toHaveLength(1)
    expect(getBindings()).toHaveLength(1)
    unbindWidget('b')
    expect(getBindings()).toEqual([])
  })

  it('keeps pending inbox items across disconnect and delivers them after reconnect', async () => {
    await seedInbox()
    const execute = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
    initDeliveryBridge({ root, execute })

    await bindWidget({ widgetId: 'b', canvasId: 'canvas', adapter: null })
    unbindWidget('b')
    expect((await readInbox({ canvasId: 'canvas', widgetId: 'b' })).items).toHaveLength(1)

    await bindWidget({
      widgetId: 'b', canvasId: 'canvas', runtime: 'codex', threadId: 'thread-reconnected',
      adapter: { type: 'codex-queue', command: 'codex' },
    })
    expect((await flushWidget('b')).delivered).toBe(true)
    expect((await readInbox({ canvasId: 'canvas', widgetId: 'b' })).items).toEqual([])
  })
})
