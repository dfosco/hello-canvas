/** Durable cross-agent messages, requests, results, and inbox consumption. */

import { publish, read, registerEventNamespace } from './bus.js'
import { getHub, inboxChannel, resolveHubForWidget } from './hub-manager.js'

registerEventNamespace('message', { events: ['message:created', 'message:consumed'] })
registerEventNamespace('request', { events: ['request:created', 'request:completed'] })
const consumptionLocks = new Map()
const MESSAGE_INTENTS = new Set(['inform', 'steer'])

function normalizeName(value) {
  return String(value || '').trim().toLocaleLowerCase()
}

export function resolveCollaborator(hub, recipient) {
  const wanted = normalizeName(recipient)
  const matches = [...hub.members.values()].filter((member) => [member.widgetId, member.name, member.prettyName]
    .some((value) => normalizeName(value) === wanted))
  if (matches.length === 0) return { error: `Collaborator ${JSON.stringify(recipient)} not found in Hub ${hub.hubId}` }
  if (matches.length > 1) {
    const choices = matches.map((member) => `${member.name} (${member.prettyName}, ${member.widgetId})`).join(', ')
    return { error: `Ambiguous collaborator ${JSON.stringify(recipient)}: ${choices}` }
  }
  return { member: matches[0] }
}

function senderSnapshot(hub, senderId) {
  const member = hub.members.get(senderId)
  return member ? { widgetId: member.widgetId, name: member.name, prettyName: member.prettyName } : null
}

async function completedRequestIds(hub) {
  const events = await read(hub.channel, { type: 'request:completed' })
  return new Set(events.map((event) => event.correlationId).filter(Boolean))
}

async function publishInboxMessage(hub, recipient, message) {
  return publish(inboxChannel(hub.canvasId, recipient.widgetId), {
    type: 'inbox:available',
    senderId: message.sender.widgetId,
    senderName: message.sender.prettyName || message.sender.name,
    body: message.body,
    correlationId: message.id,
    hubId: hub.hubId,
    hubContextVersion: hub.context.version,
    payload: { kind: 'peer-message', message },
  })
}

async function createMessage({ senderId, canvasId = null, hubId = null, recipient = null, body, intent = 'inform', scope = 'direct', dependsOn = [] }) {
  if (!senderId) return { ok: false, error: 'Sender identity is required' }
  if (typeof body !== 'string' || !body.trim()) return { ok: false, error: 'Message body is required' }
  const resolved = resolveHubForWidget(senderId, hubId, canvasId)
  if (resolved.error) return { ok: false, error: resolved.error }
  const hub = resolved.hub

  let recipients
  if (scope === 'broadcast') {
    const reachable = hub.routes.get(senderId) || new Set()
    recipients = [...hub.members.values()].filter((member) => reachable.has(member.widgetId))
  } else {
    const target = resolveCollaborator(hub, recipient)
    if (target.error) return { ok: false, error: target.error }
    if (target.member.widgetId === senderId) return { ok: false, error: 'Cannot send a Hub message to yourself' }
    if (!hub.routes.get(senderId)?.has(target.member.widgetId)) {
      return { ok: false, error: `Broadcast topology does not allow ${senderId} to send to ${target.member.name}` }
    }
    recipients = [target.member]
  }
  if (recipients.length === 0) return { ok: false, error: 'No recipients available' }

  const dependencies = Array.isArray(dependsOn) ? dependsOn.filter(Boolean) : []
  if (dependencies.length > 0) {
    const completed = await completedRequestIds(hub)
    const incomplete = dependencies.filter((requestId) => !completed.has(requestId))
    if (incomplete.length > 0) return { ok: false, error: `Request dependencies are not complete: ${incomplete.join(', ')}` }
  }

  const sender = senderSnapshot(hub, senderId)
  if (!sender) return { ok: false, error: `Sender ${senderId} is not a Hub collaborator` }
  const event = await publish(hub.channel, {
    type: intent === 'request' ? 'request:created' : 'message:created',
    senderId,
    senderName: sender.prettyName || sender.name,
    body: body.trim(),
    hubId: hub.hubId,
    hubContextVersion: hub.context.version,
    scope,
    intent,
    recipients: recipients.map((member) => ({ widgetId: member.widgetId, name: member.name, prettyName: member.prettyName })),
    dependsOn: dependencies,
    delivery: Object.fromEntries(recipients.map((member) => [member.widgetId, 'sent'])),
  })
  const message = {
    id: event.id,
    timestamp: event.timestamp,
    hubId: hub.hubId,
    hubContextVersion: hub.context.version,
    scope,
    intent,
    sender,
    recipients: event.recipients,
    body: event.body,
    dependsOn: dependencies,
  }
  const inboxItems = await Promise.all(recipients.map((member) => publishInboxMessage(hub, member, message)))
  return { ok: true, message, inboxItemIds: inboxItems.map((item) => item.id) }
}

export function sendDirectMessage(args) {
  if (!MESSAGE_INTENTS.has(args.intent || 'inform')) {
    return Promise.resolve({ ok: false, error: 'Message intent must be inform or steer' })
  }
  return createMessage({ ...args, scope: 'direct', intent: args.intent || 'inform' })
}

export function broadcastMessage(args) {
  if (!MESSAGE_INTENTS.has(args.intent || 'inform')) {
    return Promise.resolve({ ok: false, error: 'Message intent must be inform or steer' })
  }
  return createMessage({ ...args, scope: 'broadcast', intent: args.intent || 'inform' })
}

export function sendRequest(args) {
  return createMessage({ ...args, scope: 'direct', intent: 'request' })
}

export async function completeRequest({ senderId, canvasId = null, hubId = null, requestId, body }) {
  if (!requestId) return { ok: false, error: 'Request ID is required' }
  const resolved = resolveHubForWidget(senderId, hubId, canvasId)
  if (resolved.error) return { ok: false, error: resolved.error }
  const hub = resolved.hub
  const events = await read(hub.channel)
  const request = events.find((event) => event.id === requestId && event.type === 'request:created')
  if (!request) return { ok: false, error: `Request ${requestId} not found in Hub ${hub.hubId}` }
  if (!request.recipients?.some((recipient) => recipient.widgetId === senderId)) {
    return { ok: false, error: `Widget ${senderId} does not own request ${requestId}` }
  }
  if (events.some((event) => event.type === 'request:completed' && event.correlationId === requestId)) {
    return { ok: false, error: `Request ${requestId} is already complete` }
  }

  const result = await createMessage({
    senderId,
    canvasId: hub.canvasId,
    hubId: hub.hubId,
    recipient: request.senderId,
    body,
    intent: 'result',
    scope: 'direct',
  })
  if (!result.ok) return result
  await publish(hub.channel, {
    type: 'request:completed',
    senderId,
    senderName: hub.members.get(senderId)?.prettyName || senderId,
    body: body.trim(),
    correlationId: requestId,
    resultMessageId: result.message.id,
    hubId: hub.hubId,
    hubContextVersion: hub.context.version,
  })
  return { ok: true, requestId, result: result.message }
}

export async function readInbox({ canvasId, widgetId, limit = 50 }) {
  if (!canvasId || !widgetId) return { ok: false, error: 'Canvas and widget identity are required' }
  const channel = inboxChannel(canvasId, widgetId)
  const events = await read(channel)
  const consumed = new Set(events
    .filter((event) => event.type === 'inbox:consumed')
    .map((event) => event.correlationId))
  const items = events
    .filter((event) => event.type === 'inbox:available' && !consumed.has(event.id))
    .slice(0, Math.max(1, Number(limit) || 50))
  return { ok: true, channel, items }
}

async function consumeInboxUnlocked({ canvasId, widgetId, itemIds, consumer = 'poll' }) {
  const pending = await readInbox({ canvasId, widgetId, limit: Number.MAX_SAFE_INTEGER })
  if (!pending.ok) return pending
  const requested = new Set(Array.isArray(itemIds) ? itemIds : [])
  const items = pending.items.filter((item) => requested.has(item.id))
  for (const item of items) {
    await publish(pending.channel, {
      type: 'inbox:consumed', senderId: widgetId, body: `Consumed by ${consumer}`,
      correlationId: item.id, hubId: item.hubId, hubContextVersion: item.hubContextVersion,
      payload: { consumer, messageId: item.payload?.message?.id || null },
    })
    const messageId = item.payload?.message?.id
    const hub = item.hubId ? getHub(item.hubId) : null
    if (messageId && hub) {
      await publish(hub.channel, {
        type: 'message:consumed', senderId: widgetId, body: `Consumed by ${widgetId}`,
        correlationId: messageId, inboxItemId: item.id, hubId: hub.hubId,
        hubContextVersion: item.hubContextVersion, consumer,
      })
    }
  }
  return { ok: true, consumed: items.map((item) => item.id) }
}

export function consumeInbox(args) {
  const key = `${args.canvasId || ''}:${args.widgetId || ''}`
  const prior = consumptionLocks.get(key) || Promise.resolve()
  const current = prior.catch(() => {}).then(() => consumeInboxUnlocked(args))
  consumptionLocks.set(key, current)
  current.then(
    () => { if (consumptionLocks.get(key) === current) consumptionLocks.delete(key) },
    () => { if (consumptionLocks.get(key) === current) consumptionLocks.delete(key) },
  )
  return current
}

export function formatInboxBatch(items) {
  if (!items?.length) return ''
  const latestContextByHub = new Map()
  const messages = []
  for (const item of items) {
    const payload = item.payload || {}
    if (payload.kind === 'hub-context-change') {
      const prior = latestContextByHub.get(payload.hubId)
      if (!prior || (payload.contextVersion || 0) >= (prior.contextVersion || 0)) latestContextByHub.set(payload.hubId, payload)
    } else if (payload.kind === 'peer-message' && payload.message) {
      messages.push(payload.message)
    }
  }

  const lines = ['## Hypercanvas Hub update']
  for (const update of latestContextByHub.values()) {
    lines.push('', `Hub context v${update.contextVersion}`)
    if (!update.context) {
      lines.push(update.change || 'Hub membership ended.')
      continue
    }
    if (update.context.prompt) lines.push(`Goal: ${update.context.prompt}`)
    lines.push('Collaborators:')
    for (const agent of update.context.agents || []) {
      const runtime = [agent.runtime, agent.model].filter(Boolean).join(' / ')
      lines.push(`- ${agent.name} — ${agent.prettyName}${agent.role ? ` — ${agent.role}` : ''}${runtime ? ` — ${runtime}` : ''}`)
    }
  }
  if (messages.length > 0) {
    lines.push('', 'New messages:')
    for (const message of messages) {
      const label = message.intent === 'request' ? 'Request' : message.intent === 'result' ? 'Result' : message.intent === 'steer' ? 'Steering' : 'Message'
      lines.push('', `[${label} from ${message.sender.prettyName || message.sender.name}]`, message.body)
      if (message.intent === 'request') lines.push(`Request ID: ${message.id}`)
    }
  }
  return `${lines.join('\n')}\n`
}
