/**
 * Broadcast-defined Hub manager.
 *
 * Membership is derived exclusively from messaging-enabled connectors. Hub
 * identity and context revisions are persisted on a per-canvas registry
 * channel so topology can be rebuilt without losing collaboration context.
 */

import { createHash } from 'node:crypto'
import { publish, read, registerEventNamespace } from './bus.js'

const COLLABORATOR_TYPES = new Set(['agent', 'terminal', 'prompt'])

registerEventNamespace('hub', { events: ['hub:context:updated', 'hub:context:dissolved'] })
registerEventNamespace('inbox', { events: ['inbox:available', 'inbox:consumed'] })

/** @type {Map<string, HubState>} */
const hubs = new Map()
/** @type {Map<string, Set<string>>} */
const canvasHubs = new Map()
const hydratedCanvases = new Set()
const materializationLocks = new Map()

/**
 * @typedef {Object} HubMember
 * @property {string} widgetId
 * @property {string} name
 * @property {string} prettyName
 * @property {string} type
 * @property {string} role
 * @property {string|null} runtime
 * @property {string|null} model
 * @property {string|null} initialPrompt
 * @property {string|null} promptSummary
 */

/**
 * @typedef {Object} HubState
 * @property {string} hubId
 * @property {string} canvasId
 * @property {Map<string, HubMember>} members
 * @property {Map<string, Set<string>>} routes
 * @property {object} context
 * @property {string} channel
 * @property {string} createdAt
 * @property {string} updatedAt
 */

export function hubRegistryChannel(canvasId) {
  return `hub-registry:${canvasId.replace(/\//g, '--')}`
}

export function hubChannel(canvasId, hubId) {
  return `hub:${canvasId.replace(/\//g, '--')}:${hubId}`
}

export function inboxChannel(canvasId, widgetId) {
  return `inbox:${canvasId.replace(/\//g, '--')}:${widgetId}`
}

export function stableHubId(canvasId, widgetIds) {
  const sorted = [...widgetIds].sort()
  const hash = createHash('sha1').update(`${canvasId}::${sorted.join(',')}`).digest('hex').slice(0, 10)
  return `hub_${hash}`
}

export function isBroadcastRelationship(connector) {
  const mode = connector?.meta?.messagingMode
  return mode === 'one-way' || mode === 'two-way'
}

/** Compute components containing only collaborator endpoints and broadcast edges. */
export function computeComponents(widgets, connectors) {
  const ids = new Set(widgets.filter((widget) => COLLABORATOR_TYPES.has(widget.type)).map((widget) => widget.id))
  const participating = new Set()
  const adjacency = new Map()

  for (const connector of connectors.filter(isBroadcastRelationship)) {
    const startId = connector.start?.widgetId
    const endId = connector.end?.widgetId
    if (!startId || !endId || startId === endId || !ids.has(startId) || !ids.has(endId)) continue
    participating.add(startId)
    participating.add(endId)
    if (!adjacency.has(startId)) adjacency.set(startId, new Set())
    if (!adjacency.has(endId)) adjacency.set(endId, new Set())
    adjacency.get(startId).add(endId)
    adjacency.get(endId).add(startId)
  }

  const seen = new Set()
  const components = []
  for (const id of [...participating].sort()) {
    if (seen.has(id)) continue
    const queue = [id]
    const component = new Set()
    seen.add(id)
    while (queue.length > 0) {
      const current = queue.shift()
      component.add(current)
      for (const next of adjacency.get(current) || []) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    if (component.size >= 2) components.push(component)
  }
  return components
}

function addressableName(widget) {
  return widget.props?.alias || widget.props?.name || widget.props?.prettyName || widget.id
}

function memberFromWidget(widget, roleInfo) {
  return {
    widgetId: widget.id,
    name: addressableName(widget),
    prettyName: widget.props?.prettyName || widget.props?.alias || widget.id,
    type: widget.type,
    role: roleInfo.roleByWidget?.get(widget.id) || roleInfo.defaultRole || 'member',
    runtime: widget.props?.agentId || null,
    model: widget.props?.model || null,
    initialPrompt: widget.props?.initialPrompt || widget.props?.prompt || widget.props?.text || null,
    promptSummary: widget.props?.promptSummary || null,
  }
}

function overlapSize(memberIds, component) {
  let overlap = 0
  for (const id of memberIds) if (component.has(id)) overlap++
  return overlap
}

function memberFingerprint(members) {
  return JSON.stringify([...members.values()].sort((a, b) => a.widgetId.localeCompare(b.widgetId)))
}

function stateFromContext(context) {
  const members = new Map((context.agents || []).map((member) => [member.widgetId, member]))
  return {
    hubId: context.hubId,
    canvasId: context.canvasId,
    members,
    routes: new Map(),
    context,
    channel: hubChannel(context.canvasId, context.hubId),
    createdAt: context.createdAt,
    updatedAt: context.updatedAt,
  }
}

async function hydrateCanvas(canvasId) {
  if (hydratedCanvases.has(canvasId)) return
  let events = []
  try { events = await read(hubRegistryChannel(canvasId)) } catch { return }
  hydratedCanvases.add(canvasId)

  const restored = new Map()
  for (const event of events) {
    const context = event.payload?.context
    const hubId = event.payload?.hubId || context?.hubId
    if (!hubId) continue
    if (event.type === 'hub:context:dissolved') restored.delete(hubId)
    if (event.type === 'hub:context:updated' && context) restored.set(hubId, stateFromContext(context))
  }

  const ids = new Set()
  for (const [hubId, hub] of restored) {
    hubs.set(hubId, hub)
    ids.add(hubId)
  }
  canvasHubs.set(canvasId, ids)
}

function computeRoutes(component, connectors) {
  const adjacency = new Map([...component].map((widgetId) => [widgetId, new Set()]))
  for (const connector of connectors.filter(isBroadcastRelationship)) {
    const startId = connector.start?.widgetId
    const endId = connector.end?.widgetId
    if (!component.has(startId) || !component.has(endId)) continue
    adjacency.get(startId).add(endId)
    if (connector.meta.messagingMode === 'two-way') adjacency.get(endId).add(startId)
  }

  const routes = new Map()
  for (const senderId of component) {
    const reachable = new Set()
    const queue = [...(adjacency.get(senderId) || [])]
    while (queue.length > 0) {
      const recipientId = queue.shift()
      if (recipientId === senderId || reachable.has(recipientId)) continue
      reachable.add(recipientId)
      queue.push(...(adjacency.get(recipientId) || []))
    }
    routes.set(senderId, reachable)
  }
  return routes
}

function chooseAssignments(components, previousHubs) {
  const candidates = []
  components.forEach((component, componentIndex) => {
    for (const hub of previousHubs) {
      const overlap = overlapSize(hub.members.keys(), component)
      if (overlap > 0) candidates.push({ componentIndex, hub, overlap, anchor: [...component].sort()[0] })
    }
  })
  candidates.sort((a, b) => (
    b.overlap - a.overlap
    || a.anchor.localeCompare(b.anchor)
    || a.hub.createdAt.localeCompare(b.hub.createdAt)
    || a.hub.hubId.localeCompare(b.hub.hubId)
  ))

  const assignments = new Map()
  const claimedHubs = new Set()
  for (const candidate of candidates) {
    if (assignments.has(candidate.componentIndex) || claimedHubs.has(candidate.hub.hubId)) continue
    assignments.set(candidate.componentIndex, candidate.hub)
    claimedHubs.add(candidate.hub.hubId)
  }
  return assignments
}

function mergeOrigins(overlappingHubs) {
  const origins = []
  const seen = new Set()
  for (const hub of overlappingHubs) {
    const sourceEntries = hub.context.origins?.length
      ? hub.context.origins
      : (hub.context.prompt ? [{ hubId: hub.hubId, prompt: hub.context.prompt }] : [])
    for (const source of sourceEntries) {
      const key = `${source.hubId || ''}:${source.prompt || ''}`
      if (seen.has(key)) continue
      seen.add(key)
      origins.push(source)
    }
  }
  return origins
}

async function publishContext(hub, change) {
  const context = hub.context
  await publish(hubRegistryChannel(hub.canvasId), {
    type: 'hub:context:updated', senderId: 'hypercanvas', body: `Hub context updated to v${context.version}`,
    payload: { hubId: hub.hubId, context, change },
  })
  await publish(hub.channel, {
    type: 'hub:context:updated', senderId: 'hypercanvas', body: `Hub context updated to v${context.version}`,
    payload: { hubId: hub.hubId, context, change },
  })
  await Promise.all([...hub.members.keys()].map((widgetId) => publish(inboxChannel(hub.canvasId, widgetId), {
    type: 'inbox:available', senderId: 'hypercanvas', senderName: 'Hypercanvas', body: `Hub context changed: ${change}`,
    hubId: hub.hubId, hubContextVersion: context.version,
    payload: { kind: 'hub-context-change', hubId: hub.hubId, contextVersion: context.version, context, change },
  })))
}

async function publishDissolved(hub, reason, notifyMembers = true) {
  await publish(hubRegistryChannel(hub.canvasId), {
    type: 'hub:context:dissolved', senderId: 'hypercanvas', body: reason,
    payload: { hubId: hub.hubId, context: hub.context, reason },
  })
  if (!notifyMembers) return
  await Promise.all([...hub.members.keys()].map((widgetId) => publish(inboxChannel(hub.canvasId, widgetId), {
    type: 'inbox:available', senderId: 'hypercanvas', senderName: 'Hypercanvas', body: reason,
    hubId: hub.hubId, hubContextVersion: hub.context.version + 1,
    payload: { kind: 'hub-context-change', hubId: hub.hubId, contextVersion: hub.context.version + 1, context: null, change: reason },
  })))
}

/** Materialize broadcast components and preserve Hub identity by maximum overlap. */
async function materializeHubsUnlocked(canvasId, widgets, connectors, roleInfo = {}) {
  await hydrateCanvas(canvasId)
  const widgetMap = new Map(widgets.map((widget) => [widget.id, widget]))
  const components = computeComponents(widgets, connectors)
  const previousIds = canvasHubs.get(canvasId) || new Set()
  const previousHubs = [...previousIds].map((hubId) => hubs.get(hubId)).filter(Boolean)
  const assignments = chooseAssignments(components, previousHubs)
  const nextIds = new Set()
  const created = []
  const dissolved = []
  const updated = []

  for (let index = 0; index < components.length; index++) {
    const component = components[index]
    const existing = assignments.get(index) || null
    let hubId = existing?.hubId || stableHubId(canvasId, component)
    if (!existing && hubs.has(hubId) && !previousIds.has(hubId)) hubId = `${hubId}_${Date.now().toString(36)}`

    const overlappingHubs = previousHubs.filter((hub) => overlapSize(hub.members.keys(), component) > 0)
    const members = new Map([...component]
      .map((widgetId) => widgetMap.get(widgetId))
      .filter(Boolean)
      .map((widget) => [widget.id, memberFromWidget(widget, roleInfo)]))
    const contextSource = existing || overlappingHubs
      .slice()
      .sort((a, b) => overlapSize(b.members.keys(), component) - overlapSize(a.members.keys(), component) || a.hubId.localeCompare(b.hubId))[0]
    const membershipChanged = !existing || memberFingerprint(existing.members) !== memberFingerprint(members)
    const now = new Date().toISOString()
    const context = {
      hubId, canvasId,
      version: existing ? existing.context.version + (membershipChanged ? 1 : 0) : 1,
      prompt: contextSource?.context.prompt || roleInfo.prompt || '',
      promptSummary: contextSource?.context.promptSummary || null,
      origins: mergeOrigins(overlappingHubs),
      agents: [...members.values()],
      createdAt: existing?.createdAt || now,
      updatedAt: membershipChanged ? now : (existing?.updatedAt || now),
    }
    const hub = {
      hubId, canvasId, members, context,
      routes: computeRoutes(component, connectors),
      channel: hubChannel(canvasId, hubId),
      createdAt: context.createdAt,
      updatedAt: context.updatedAt,
    }
    hubs.set(hubId, hub)
    nextIds.add(hubId)

    if (!existing) {
      created.push(hubId)
      await publishContext(hub, overlappingHubs.length > 1 ? 'hubs merged' : 'hub created')
    } else if (membershipChanged) {
      updated.push(hubId)
      await publishContext(hub, 'membership changed')
    }
  }

  for (const previousHub of previousHubs) {
    if (nextIds.has(previousHub.hubId)) continue
    hubs.delete(previousHub.hubId)
    dissolved.push(previousHub.hubId)
    const membersMoved = [...previousHub.members.keys()].some((widgetId) =>
      [...nextIds].some((hubId) => hubs.get(hubId)?.members.has(widgetId)))
    await publishDissolved(previousHub, membersMoved ? 'Hub merged or split' : 'Broadcast relationships removed', !membersMoved)
  }

  const nextMemberIds = new Set([...nextIds].flatMap((hubId) => [...(hubs.get(hubId)?.members.keys() || [])]))
  for (const previousHub of previousHubs) {
    if (!nextIds.has(previousHub.hubId)) continue
    const departed = [...previousHub.members.keys()].filter((widgetId) => (
      !hubs.get(previousHub.hubId)?.members.has(widgetId) && !nextMemberIds.has(widgetId)
    ))
    await Promise.all(departed.map((widgetId) => publish(inboxChannel(canvasId, widgetId), {
      type: 'inbox:available', senderId: 'hypercanvas', senderName: 'Hypercanvas',
      body: 'Hub membership ended', hubId: previousHub.hubId,
      hubContextVersion: previousHub.context.version + 1,
      payload: {
        kind: 'hub-context-change', hubId: previousHub.hubId,
        contextVersion: previousHub.context.version + 1,
        context: null, change: 'Hub membership ended',
      },
    })))
  }

  canvasHubs.set(canvasId, nextIds)
  return { created, dissolved, updated }
}

export function materializeHubs(canvasId, widgets, connectors, roleInfo = {}) {
  const prior = materializationLocks.get(canvasId) || Promise.resolve()
  const current = prior.catch(() => {}).then(() => materializeHubsUnlocked(canvasId, widgets, connectors, roleInfo))
  materializationLocks.set(canvasId, current)
  current.then(
    () => { if (materializationLocks.get(canvasId) === current) materializationLocks.delete(canvasId) },
    () => { if (materializationLocks.get(canvasId) === current) materializationLocks.delete(canvasId) },
  )
  return current
}

export function getHub(hubId) { return hubs.get(hubId) || null }

export function getHubsForCanvas(canvasId) {
  return [...(canvasHubs.get(canvasId) || [])].map((hubId) => hubs.get(hubId)).filter(Boolean)
}

export function getHubsForWidget(widgetId) {
  return [...hubs.values()].filter((hub) => hub.members.has(widgetId))
}

export function resolveHubForWidget(widgetId, hubId = null, canvasId = null) {
  if (hubId) {
    const hub = getHub(hubId)
    if (!hub) return { error: `Hub ${hubId} not found` }
    if (canvasId && hub.canvasId !== canvasId) return { error: `Hub ${hubId} is not on canvas ${canvasId}` }
    if (!hub.members.has(widgetId)) return { error: `Widget ${widgetId} is not a member of hub ${hubId}` }
    return { hub }
  }
  const matches = getHubsForWidget(widgetId).filter((hub) => !canvasId || hub.canvasId === canvasId)
  if (matches.length === 0) return { error: `Widget ${widgetId} is not in a broadcast Hub` }
  if (matches.length > 1) return { error: `Widget ${widgetId} belongs to multiple Hubs; specify --hub` }
  return { hub: matches[0] }
}

export function serializeHub(hub, perspectiveWidgetId = null) {
  const peers = [...hub.members.values()].filter((member) => member.widgetId !== perspectiveWidgetId)
  return { ...hub.context, role: perspectiveWidgetId ? (hub.members.get(perspectiveWidgetId)?.role || null) : null, peers, channel: hub.channel }
}

export async function setHubContext(hubId, senderId, { prompt, promptSummary } = {}) {
  const hub = getHub(hubId)
  if (!hub) return { ok: false, error: `Hub ${hubId} not found` }
  if (!hub.members.has(senderId)) return { ok: false, error: `Widget ${senderId} is not a member of hub ${hubId}` }
  if (typeof prompt !== 'string' || !prompt.trim()) return { ok: false, error: 'Hub prompt is required' }

  const now = new Date().toISOString()
  hub.context = {
    ...hub.context,
    version: hub.context.version + 1,
    prompt: prompt.trim(),
    promptSummary: typeof promptSummary === 'string' && promptSummary.trim() ? promptSummary.trim() : null,
    origins: hub.context.origins?.length ? hub.context.origins : [{ hubId, prompt: prompt.trim() }],
    updatedAt: now,
  }
  hub.updatedAt = now
  await publishContext(hub, 'prompt updated')
  return { ok: true, context: hub.context }
}

export async function dissolveHubsForCanvas(canvasId) {
  for (const hub of getHubsForCanvas(canvasId)) {
    await publishDissolved(hub, 'Hub dissolved')
    hubs.delete(hub.hubId)
  }
  canvasHubs.delete(canvasId)
}

export function resetHubs() {
  hubs.clear()
  canvasHubs.clear()
  hydratedCanvases.clear()
  materializationLocks.clear()
}

export function getHubsMap() { return hubs }
export function getCanvasHubsMap() { return canvasHubs }
