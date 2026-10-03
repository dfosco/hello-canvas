import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initBus, read, resetBus } from './bus.js'
import {
  broadcastMessage,
  completeRequest,
  consumeInbox,
  readInbox,
  sendDirectMessage,
  sendRequest,
} from './coordination-service.js'
import {
  getHubsForCanvas,
  inboxChannel,
  materializeHubs,
  resetHubs,
} from './hub-manager.js'
import { JsonlAdapter } from './storage/jsonl-adapter.js'

const agent = (id, alias) => ({
  id,
  type: 'agent',
  props: { alias, prettyName: alias.toUpperCase(), agentId: 'codex' },
})
const edge = (id, start, end, mode = 'two-way') => ({
  id,
  start: { widgetId: start },
  end: { widgetId: end },
  meta: { messagingMode: mode },
})
describe('Hub coordination service', () => {
  let root
  let hub

  beforeEach(async () => {
    resetHubs()
    resetBus()
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'coordination-'))
    const adapter = new JsonlAdapter({ root })
    await adapter.init()
    initBus(adapter)
    const widgets = [agent('a', 'architect'), agent('b', 'builder'), agent('c', 'reviewer')]
    await materializeHubs('canvas', widgets, [
      edge('ab', 'a', 'b'),
      edge('bc', 'b', 'c'),
    ])
    hub = getHubsForCanvas('canvas')[0]
    await consumeInbox({
      canvasId: 'canvas',
      widgetId: 'b',
      itemIds: (await readInbox({ canvasId: 'canvas', widgetId: 'b' })).items.map((item) => item.id),
    })
  })

  afterEach(() => {
    resetHubs()
    resetBus()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('stores one canonical direct message and consumes its inbox projection', async () => {
    const sent = await sendDirectMessage({ senderId: 'a', recipient: 'builder', body: 'Implement it.' })
    expect(sent.ok).toBe(true)

    const canonical = await read(hub.channel, { type: 'message:created' })
    expect(canonical).toHaveLength(1)
    expect(canonical[0].recipients).toEqual([
      expect.objectContaining({ widgetId: 'b', name: 'builder' }),
    ])

    const inbox = await readInbox({ canvasId: 'canvas', widgetId: 'b' })
    expect(inbox.items).toHaveLength(1)
    expect(inbox.items[0].payload.message.id).toBe(sent.message.id)

    await consumeInbox({
      canvasId: 'canvas',
      widgetId: 'b',
      itemIds: [inbox.items[0].id],
      consumer: 'poll',
    })
    expect((await readInbox({ canvasId: 'canvas', widgetId: 'b' })).items).toEqual([])
    const consumed = await read(hub.channel, { type: 'message:consumed' })
    expect(consumed[0].correlationId).toBe(sent.message.id)
  })

  it('persists one broadcast envelope with per-recipient inbox projections', async () => {
    const sent = await broadcastMessage({ senderId: 'a', body: 'Schema ready.' })
    expect(sent.ok).toBe(true)
    expect(sent.message.recipients.map((recipient) => recipient.widgetId).sort()).toEqual(['b', 'c'])

    const canonical = await read(hub.channel, { type: 'message:created' })
    expect(canonical).toHaveLength(1)
    expect(canonical[0].scope).toBe('broadcast')
    expect((await read(inboxChannel('canvas', 'b'), { type: 'inbox:available' })).at(-1).correlationId).toBe(sent.message.id)
    expect((await read(inboxChannel('canvas', 'c'), { type: 'inbox:available' })).at(-1).correlationId).toBe(sent.message.id)
  })

  it('tracks request dependencies and attaches a result to completion', async () => {
    const first = await sendRequest({ senderId: 'a', recipient: 'builder', body: 'Build schema.' })
    const blocked = await sendRequest({
      senderId: 'a',
      recipient: 'reviewer',
      body: 'Review schema.',
      dependsOn: [first.message.id],
    })
    expect(blocked).toEqual(expect.objectContaining({ ok: false }))
    expect(blocked.error).toContain(first.message.id)

    const complete = await completeRequest({
      senderId: 'b',
      requestId: first.message.id,
      body: 'Schema built.',
    })
    expect(complete.ok).toBe(true)
    expect(complete.result.intent).toBe('result')

    const second = await sendRequest({
      senderId: 'a',
      recipient: 'reviewer',
      body: 'Review schema.',
      dependsOn: [first.message.id],
    })
    expect(second.ok).toBe(true)
  })

  it('enforces one-way topology direction', async () => {
    resetHubs()
    await materializeHubs('directed', [agent('x', 'source'), agent('y', 'sink')], [
      edge('xy', 'x', 'y', 'one-way'),
    ])
    expect((await sendDirectMessage({
      senderId: 'x', recipient: 'sink', body: 'Allowed.',
    })).ok).toBe(true)
    const rejected = await sendDirectMessage({
      senderId: 'y', recipient: 'source', body: 'Blocked.',
    })
    expect(rejected.ok).toBe(false)
    expect(rejected.error).toContain('does not allow')
  })
})
