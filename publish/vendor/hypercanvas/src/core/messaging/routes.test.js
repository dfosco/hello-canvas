import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initBus, resetBus } from './bus.js'
import { materializeHubs, resetHubs } from './hub-manager.js'
import { createMessagingRoutes } from './routes.js'
import { JsonlAdapter } from './storage/jsonl-adapter.js'

const agent = (id, alias) => ({
  id,
  type: 'agent',
  props: { alias, prettyName: alias.toUpperCase(), agentId: 'codex' },
})

function responseRecorder() {
  return {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body = '') { this.body += body },
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(value))
}

describe('Hub coordination HTTP routes', () => {
  let root
  let route

  beforeEach(async () => {
    resetHubs()
    resetBus()
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'coordination-routes-'))
    const adapter = new JsonlAdapter({ root })
    await adapter.init()
    initBus(adapter)
    await materializeHubs('canvas', [agent('a', 'architect'), agent('b', 'builder')], [{
      id: 'ab',
      start: { widgetId: 'a' },
      end: { widgetId: 'b' },
      meta: { messagingMode: 'two-way' },
    }])
    route = createMessagingRoutes({ sendJson })
  })

  afterEach(() => {
    resetHubs()
    resetBus()
    fs.rmSync(root, { recursive: true, force: true })
  })

  async function invoke(method, routePath, body = undefined) {
    const req = { headers: { accept: 'application/json', 'content-type': 'application/json' } }
    const res = responseRecorder()
    await route(req, res, {
      method,
      path: routePath,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, data: JSON.parse(res.body) }
  }

  it('sends, reads, and consumes a direct message through the HTTP boundary', async () => {
    const sent = await invoke('POST', '/message/send', {
      canvasId: 'canvas', senderId: 'a', recipient: 'builder', body: 'Implement it.',
    })
    expect(sent.status).toBe(201)

    const inbox = await invoke('GET', '/inbox/read?canvasId=canvas&widgetId=b')
    expect(inbox.status).toBe(200)
    expect(inbox.data.items).toHaveLength(2)
    const messageItem = inbox.data.items.find((item) => item.payload?.kind === 'peer-message')
    expect(messageItem.payload.message.id).toBe(sent.data.message.id)

    const consumed = await invoke('POST', '/inbox/consume', {
      canvasId: 'canvas', widgetId: 'b', itemIds: inbox.data.items.map((item) => item.id),
    })
    expect(consumed).toEqual(expect.objectContaining({ status: 200 }))
    expect((await invoke('GET', '/inbox/read?canvasId=canvas&widgetId=b')).data.items).toEqual([])
  })

  it('rejects use of a widget identity from a different canvas', async () => {
    const sent = await invoke('POST', '/message/send', {
      canvasId: 'other', senderId: 'a', recipient: 'builder', body: 'Wrong canvas.',
    })
    expect(sent.status).toBe(400)
    expect(sent.data.error).toContain('not in a broadcast Hub')
  })
})
