/**
 * Presence Registry — heartbeat-based agent availability tracking.
 *
 * Agents publish `presence:join` on startup and `presence:heartbeat` every 30s.
 * No explicit deregister — entries expire after 90s without heartbeat (crash-safe).
 *
 * The registry maintains an in-memory Map rebuilt from the bus log on startup.
 * Presence events are published to per-canvas channels: `presence:{branch}:{canvasId}`.
 */

import { publish, read, subscribe, registerEventNamespace } from './bus.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL = 30_000 // 30s between heartbeats
const EXPIRY_TTL = 90_000 // 90s = 3 missed heartbeats → expired
const SWEEP_INTERVAL = 15_000 // check for expired entries every 15s

// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PresenceEntry
 * @property {string} widgetId
 * @property {string} senderName
 * @property {string} branch
 * @property {string} canvasId
 * @property {string} channel - The presence channel this entry belongs to
 * @property {number} lastSeen - Date.now() of last heartbeat
 * @property {object} [capabilities] - Agent-declared capabilities
 * @property {string} [agentType] - e.g. 'copilot', 'claude', 'codex', 'opencode'
 */

/** @type {Map<string, PresenceEntry>} widgetId → PresenceEntry */
const registry = new Map()

/** @type {Map<string, () => void>} channel → unsubscribe function */
const channelSubs = new Map()

/** @type {NodeJS.Timeout | null} */
let sweepTimer = null

/** @type {Map<string, NodeJS.Timeout>} widgetId → heartbeat interval timer */
const heartbeatTimers = new Map()

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the presence system. Call once after `initBus()`.
 * Registers the `presence` event namespace and starts the expiry sweeper.
 */
export function initPresence() {
  registerEventNamespace('presence', {
    events: ['presence:join', 'presence:heartbeat'],
  })

  // Start periodic sweep for expired entries
  if (!sweepTimer) {
    sweepTimer = setInterval(sweepExpired, SWEEP_INTERVAL)
    if (sweepTimer.unref) sweepTimer.unref() // don't keep process alive
  }
}

/**
 * Rebuild presence state from persisted bus log for a canvas.
 * Call on server startup to recover presence from the JSONL log.
 *
 * @param {string} branch
 * @param {string} canvasId
 */
export async function rehydratePresence(branch, canvasId) {
  const channel = presenceChannel(branch, canvasId)
  try {
    const events = await read(channel)
    for (const event of events) {
      if (event.type === 'presence:join' || event.type === 'presence:heartbeat') {
        applyPresenceEvent(event, channel)
      }
    }
    // After rehydrating, immediately sweep stale entries
    sweepExpired()
  } catch {
    // Channel may not exist yet — that's fine
  }

  // Subscribe for live updates on this channel
  if (!channelSubs.has(channel)) {
    const unsub = subscribe(channel, (event) => {
      if (event.type === 'presence:join' || event.type === 'presence:heartbeat') {
        applyPresenceEvent(event, channel)
      }
    })
    channelSubs.set(channel, unsub)
  }
}

// ---------------------------------------------------------------------------
// Publish presence
// ---------------------------------------------------------------------------

/**
 * Register an agent as present on a canvas.
 * Publishes a `presence:join` event and starts the heartbeat interval.
 *
 * @param {Object} opts
 * @param {string} opts.widgetId
 * @param {string} opts.senderName
 * @param {string} opts.branch
 * @param {string} opts.canvasId
 * @param {string} [opts.agentType]
 * @param {object} [opts.capabilities]
 * @returns {Promise<{ stop: () => void }>} Call stop() to cease heartbeating
 */
export async function joinPresence({ widgetId, senderName, branch, canvasId, agentType, capabilities }) {
  const channel = presenceChannel(branch, canvasId)

  // Publish join event
  await publish(channel, {
    type: 'presence:join',
    senderId: widgetId,
    senderName,
    widgetId,
    branch,
    canvasId,
    agentType: agentType || null,
    capabilities: capabilities || null,
  })

  // Also update registry directly (in case no subscription exists for this channel yet)
  applyPresenceEvent({ type: 'presence:join', widgetId, senderName, branch, canvasId, agentType, capabilities, timestamp: new Date().toISOString() }, channel)

  // Start heartbeat
  const timer = setInterval(async () => {
    try {
      await publish(channel, {
        type: 'presence:heartbeat',
        senderId: widgetId,
        senderName,
        widgetId,
        branch,
        canvasId,
      })
    } catch {
      // Bus might be shutting down — ignore
    }
  }, HEARTBEAT_INTERVAL)
  if (timer.unref) timer.unref()

  // Track timer so we can stop it
  const prev = heartbeatTimers.get(widgetId)
  if (prev) clearInterval(prev)
  heartbeatTimers.set(widgetId, timer)

  return {
    stop() {
      clearInterval(timer)
      heartbeatTimers.delete(widgetId)
      registry.delete(widgetId)
    },
  }
}

/**
 * Remove an agent from the presence registry and stop its heartbeat.
 * Call on disconnect/close — does not require storing the stop() handle.
 * @param {string} widgetId
 */
export function leavePresence(widgetId) {
  const timer = heartbeatTimers.get(widgetId)
  if (timer) {
    clearInterval(timer)
    heartbeatTimers.delete(widgetId)
  }
  registry.delete(widgetId)
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Get all currently-present agents on a canvas.
 * @param {string} branch
 * @param {string} canvasId
 * @returns {PresenceEntry[]}
 */
export function getPresent(branch, canvasId) {
  const now = Date.now()
  const results = []
  for (const entry of registry.values()) {
    if (entry.branch === branch && entry.canvasId === canvasId && (now - entry.lastSeen) < EXPIRY_TTL) {
      results.push({ ...entry })
    }
  }
  return results
}

/**
 * Check if a specific agent is present.
 * @param {string} widgetId
 * @returns {PresenceEntry | null}
 */
export function isPresent(widgetId) {
  const entry = registry.get(widgetId)
  if (!entry) return null
  if ((Date.now() - entry.lastSeen) >= EXPIRY_TTL) {
    registry.delete(widgetId)
    return null
  }
  return { ...entry }
}

/**
 * Get all present agents across all canvases.
 * @returns {PresenceEntry[]}
 */
export function getAllPresent() {
  const now = Date.now()
  const results = []
  for (const entry of registry.values()) {
    if ((now - entry.lastSeen) < EXPIRY_TTL) {
      results.push({ ...entry })
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build the presence channel name */
function presenceChannel(branch, canvasId) {
  return `presence:${branch}:${canvasId}`
}

/** Apply a presence event to the in-memory registry */
function applyPresenceEvent(event, channel) {
  const widgetId = event.widgetId || event.senderId
  if (!widgetId) return

  const existing = registry.get(widgetId)
  const lastSeen = event.timestamp ? new Date(event.timestamp).getTime() : Date.now()

  registry.set(widgetId, {
    widgetId,
    senderName: event.senderName || existing?.senderName || widgetId,
    branch: event.branch || existing?.branch || '',
    canvasId: event.canvasId || existing?.canvasId || '',
    channel,
    lastSeen,
    capabilities: event.capabilities || existing?.capabilities || null,
    agentType: event.agentType || existing?.agentType || null,
  })
}

/** Remove expired entries from the registry */
function sweepExpired() {
  const now = Date.now()
  for (const [widgetId, entry] of registry) {
    if ((now - entry.lastSeen) >= EXPIRY_TTL) {
      registry.delete(widgetId)
    }
  }
}

// ---------------------------------------------------------------------------
// Shutdown / Reset
// ---------------------------------------------------------------------------

/**
 * Stop all presence activity. Call during server shutdown.
 */
export function resetPresence() {
  for (const unsub of channelSubs.values()) unsub()
  channelSubs.clear()

  for (const timer of heartbeatTimers.values()) clearInterval(timer)
  heartbeatTimers.clear()

  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }

  registry.clear()
}

// Re-export constants for tests and configuration
export { HEARTBEAT_INTERVAL, EXPIRY_TTL, presenceChannel }
