/** HTTP boundary for the durable Hub coordination protocol. */

import { publish, subscribe, read, readMulti } from './bus.js'
import { negotiateFormat, serializeResponse, parseRequestBody } from './toon.js'
import { getPresent, isPresent, getAllPresent } from './presence.js'
import { getBindings } from './delivery.js'
import {
  dissolveHubsForCanvas,
  getHub,
  getHubsForCanvas,
  resolveHubForWidget,
  serializeHub,
  setHubContext,
} from './hub-manager.js'
import {
  broadcastMessage,
  completeRequest,
  consumeInbox,
  readInbox,
  sendDirectMessage,
  sendRequest,
} from './coordination-service.js'

const sseConnections = new Set()
const SSE_HEARTBEAT_INTERVAL = 30_000

export function createMessagingRoutes({ sendJson }) {
  return async (req, res, ctx) => {
    const { method, path: routePath, body } = ctx
    const subpath = (routePath || '/').replace(/^\//, '').split('?')[0]
    try {
      if (method === 'POST' && subpath === 'publish') return handlePublish(req, res, body, sendJson)
      if (method === 'POST' && subpath === 'send') return handleSend(req, res, body, sendJson)
      if (method === 'POST' && subpath === 'batch') return handleBatch(req, res, body)
      if (method === 'GET' && (subpath === 'subscribe' || subpath.startsWith('subscribe/'))) return handleSubscribe(req, res, ctx, sendJson)
      if (method === 'GET' && (subpath === 'read' || subpath.startsWith('read/'))) return handleRead(req, res, ctx, sendJson)
      if (method === 'GET' && (subpath === 'presence' || subpath.startsWith('presence/'))) return handlePresence(req, res, ctx, sendJson)
      if (method === 'GET' && subpath === 'bindings') return sendNegotiated(req, res, 200, { bindings: getBindings() })

      if (method === 'GET' && subpath === 'hub/context') return handleHubContextRead(req, res, ctx, sendJson)
      if (method === 'GET' && subpath === 'hub/agents') return handleHubAgents(req, res, ctx, sendJson)
      if (method === 'POST' && subpath === 'hub/context') return handleHubContextSet(req, res, body, sendJson)
      if (method === 'GET' && subpath.startsWith('hub/')) return handleHubState(req, res, ctx, sendJson)
      if (method === 'POST' && subpath === 'hub/dissolve') return handleHubDissolve(req, res, body, sendJson)

      if (method === 'POST' && subpath === 'message/send') return handleMessage(req, res, body, sendJson, 'direct')
      if (method === 'POST' && subpath === 'message/broadcast') return handleMessage(req, res, body, sendJson, 'broadcast')
      if (method === 'POST' && subpath === 'request/send') return handleRequestSend(req, res, body, sendJson)
      if (method === 'POST' && subpath === 'request/complete') return handleRequestComplete(req, res, body, sendJson)
      if (method === 'GET' && subpath === 'inbox/read') return handleInboxRead(req, res, ctx, sendJson)
      if (method === 'POST' && subpath === 'inbox/consume') return handleInboxConsume(req, res, body, sendJson)

      sendJson(res, 404, { error: `Unknown messaging route: ${method} ${subpath}` })
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'Internal messaging error' })
    }
  }
}

async function parsedBody(req, body) {
  return parseRequestBody(body, req.headers?.['content-type'])
}

async function handlePublish(req, res, body, sendJson) {
  const parsed = await parsedBody(req, body)
  if (!parsed.channel) return sendJson(res, 400, { error: 'Missing required field: channel' })
  const event = await publish(parsed.channel, parsed)
  return sendNegotiated(req, res, 201, { ok: true, event })
}

async function handleSend(req, res, body, sendJson) {
  const parsed = await parsedBody(req, body)
  if (!parsed.channel) return sendJson(res, 400, { error: 'Missing required field: channel' })
  const timeout = parsed.timeout || 30_000
  delete parsed.timeout
  const requestEvent = await publish(parsed.channel, { ...parsed, status: parsed.status || 'pending' })
  const result = await new Promise((resolve) => {
    let timer
    const unsub = subscribe(parsed.channel, (event) => {
      if (event.correlationId !== requestEvent.id || event.id === requestEvent.id) return
      clearTimeout(timer)
      unsub()
      resolve({ ok: true, response: event })
    })
    timer = setTimeout(() => { unsub(); resolve({ ok: false, error: 'timeout', timeout }) }, timeout)
  })
  return sendNegotiated(req, res, result.ok ? 200 : 408, result)
}

async function handleBatch(req, res, body) {
  const parsed = await parsedBody(req, body)
  const result = { published: [], read: {} }
  for (const fields of parsed.publish || []) {
    if (fields.channel) result.published.push(await publish(fields.channel, fields))
  }
  if (Array.isArray(parsed.read)) {
    for (const options of parsed.read) {
      if (options.channel) result.read[options.channel] = await read(options.channel, options)
    }
  } else if (parsed.read?.channels) {
    result.read = await readMulti(parsed.read.channels, parsed.read)
  }
  return sendNegotiated(req, res, 200, result)
}

function handleSubscribe(req, res, ctx, sendJson) {
  const url = new URL(`http://localhost${ctx.path || '/'}`)
  const subpath = (ctx.path || '/').replace(/^\//, '').split('?')[0]
  const channel = subpath.startsWith('subscribe/') ? decodeURIComponent(subpath.slice(10)) : url.searchParams.get('channel')
  if (!channel) return sendJson(res, 400, { error: 'Missing channel' })
  const type = url.searchParams.get('type') || undefined
  const since = req.headers['last-event-id'] || url.searchParams.get('since') || undefined
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.flushHeaders?.()
  if (since) read(channel, { since, type }).then((events) => events.forEach((event) => writeSseEvent(res, event))).catch(() => {})
  const unsub = subscribe(channel, (event) => {
    if (res.destroyed) return unsub()
    if (!type || event.type?.startsWith(type)) writeSseEvent(res, event)
  })
  const timer = setInterval(() => { if (!res.destroyed) res.write(':\n\n') }, SSE_HEARTBEAT_INTERVAL)
  const connection = { res, unsub, timer }
  sseConnections.add(connection)
  const close = () => { unsub(); clearInterval(timer); sseConnections.delete(connection) }
  res.on('close', close)
  res.on('error', close)
}

function writeSseEvent(res, event) {
  if (!res.destroyed) res.write(`id: ${event.id}\nevent: message\ndata: ${JSON.stringify(event)}\n\n`)
}

async function handleRead(req, res, ctx, sendJson) {
  const url = new URL(`http://localhost${ctx.path || '/'}`)
  const subpath = (ctx.path || '/').replace(/^\//, '').split('?')[0]
  const pathChannel = subpath.startsWith('read/') ? decodeURIComponent(subpath.slice(5)) : null
  const channels = url.searchParams.get('channels')
  const options = {
    since: url.searchParams.get('since') || undefined,
    limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
    type: url.searchParams.get('type') || undefined,
  }
  if (channels) return sendNegotiated(req, res, 200, await readMulti(channels.split(',').map((value) => value.trim()).filter(Boolean), options))
  const channel = pathChannel || url.searchParams.get('channel')
  if (!channel) return sendJson(res, 400, { error: 'Missing channel' })
  return sendNegotiated(req, res, 200, { channel, events: await read(channel, options) })
}

async function handlePresence(req, res, ctx, sendJson) {
  const parts = (ctx.path || '/').replace(/^\//, '').split('?')[0].split('/').slice(1)
  if (!parts[0]) return sendNegotiated(req, res, 200, { agents: getAllPresent() })
  if (parts.length < 2) return sendJson(res, 400, { error: 'Use /presence/:branch/:canvasId[/widgetId]' })
  const branch = decodeURIComponent(parts[0])
  const canvasId = decodeURIComponent(parts[1])
  if (parts[2]) {
    const widgetId = decodeURIComponent(parts[2])
    const agent = isPresent(widgetId)
    return sendNegotiated(req, res, 200, { present: Boolean(agent && agent.branch === branch && agent.canvasId === canvasId), agent })
  }
  return sendNegotiated(req, res, 200, { agents: getPresent(branch, canvasId) })
}

function resolveHubFromQuery(ctx) {
  const url = new URL(`http://localhost${ctx.path || '/'}`)
  const widgetId = url.searchParams.get('widgetId')
  const hubId = url.searchParams.get('hubId')
  if (!widgetId) return { error: 'Missing widgetId' }
  const canvasId = url.searchParams.get('canvasId')
  return { widgetId, canvasId, ...resolveHubForWidget(widgetId, hubId, canvasId) }
}

async function handleHubContextRead(req, res, ctx, sendJson) {
  const resolved = resolveHubFromQuery(ctx)
  if (resolved.error) return sendJson(res, 400, { error: resolved.error })
  return sendNegotiated(req, res, 200, { context: resolved.hub.context })
}

async function handleHubAgents(req, res, ctx, sendJson) {
  const resolved = resolveHubFromQuery(ctx)
  if (resolved.error) return sendJson(res, 400, { error: resolved.error })
  return sendNegotiated(req, res, 200, { hubId: resolved.hub.hubId, agents: [...resolved.hub.members.values()] })
}

async function handleHubContextSet(req, res, body, sendJson) {
  const parsed = await parsedBody(req, body)
  const resolved = resolveHubForWidget(parsed.senderId, parsed.hubId || null, parsed.canvasId || null)
  if (resolved.error) return sendJson(res, 400, { error: resolved.error })
  const result = await setHubContext(resolved.hub.hubId, parsed.senderId, parsed)
  return sendNegotiated(req, res, result.ok ? 200 : 400, result)
}

async function handleHubState(req, res, ctx, sendJson) {
  const subpath = (ctx.path || '/').replace(/^\//, '').split('?')[0]
  const canvasId = decodeURIComponent(subpath.split('/').slice(1).join('/'))
  if (!canvasId) return sendJson(res, 400, { error: 'Missing canvasId' })
  const url = new URL(`http://localhost${ctx.path || '/'}`)
  const hubId = url.searchParams.get('hubId')
  const widgetId = url.searchParams.get('widgetId')
  if (hubId) {
    const hub = getHub(hubId)
    if (!hub || hub.canvasId !== canvasId) return sendJson(res, 404, { error: `Hub ${hubId} not found` })
    return sendNegotiated(req, res, 200, { hub: serializeHub(hub, widgetId) })
  }
  return sendNegotiated(req, res, 200, { hubs: getHubsForCanvas(canvasId).map((hub) => serializeHub(hub, widgetId)) })
}

async function handleMessage(req, res, body, sendJson, scope) {
  const parsed = await parsedBody(req, body)
  const result = scope === 'broadcast' ? await broadcastMessage(parsed) : await sendDirectMessage(parsed)
  return sendNegotiated(req, res, result.ok ? 201 : 400, result)
}

async function handleRequestSend(req, res, body) {
  const result = await sendRequest(await parsedBody(req, body))
  return sendNegotiated(req, res, result.ok ? 201 : 400, result)
}

async function handleRequestComplete(req, res, body) {
  const result = await completeRequest(await parsedBody(req, body))
  return sendNegotiated(req, res, result.ok ? 200 : 400, result)
}

async function handleInboxRead(req, res, ctx) {
  const url = new URL(`http://localhost${ctx.path || '/'}`)
  const result = await readInbox({
    canvasId: url.searchParams.get('canvasId'), widgetId: url.searchParams.get('widgetId'), limit: url.searchParams.get('limit'),
  })
  return sendNegotiated(req, res, result.ok ? 200 : 400, result)
}

async function handleInboxConsume(req, res, body) {
  const result = await consumeInbox(await parsedBody(req, body))
  return sendNegotiated(req, res, result.ok ? 200 : 400, result)
}

async function handleHubDissolve(req, res, body, sendJson) {
  const parsed = await parsedBody(req, body)
  if (!parsed.canvasId) return sendJson(res, 400, { error: 'canvasId required' })
  await dissolveHubsForCanvas(parsed.canvasId)
  return sendNegotiated(req, res, 200, { ok: true })
}

async function sendNegotiated(req, res, status, data) {
  const { body, contentType } = await serializeResponse(data, negotiateFormat(req))
  res.writeHead(status, { 'Content-Type': contentType })
  res.end(body)
}

export function closeAllSseConnections() {
  for (const connection of sseConnections) {
    connection.unsub()
    clearInterval(connection.timer)
    if (!connection.res.destroyed) connection.res.end()
  }
  sseConnections.clear()
}
