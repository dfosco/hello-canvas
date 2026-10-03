/**
 * Messaging Bus Core
 *
 * Transport/storage-agnostic publish/subscribe/read API.
 * Singleton within the server process — initialized once with a storage adapter.
 *
 * The bus validates event type prefixes against registered namespaces,
 * delegates persistence to the storage adapter, and notifies in-process
 * subscribers synchronously after append.
 */

import { validateEnvelope, createEnvelope } from './schema.js'

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

/** @type {import('./storage/types.js').MessageStorageAdapter | null} */
let adapter = null

/** @type {Map<string, Set<(event: object) => void>>} channel → subscriber set */
const subscribers = new Map()

/** @type {Map<string, { events: string[] }>} namespace → config */
const namespaces = new Map()

/** @type {Set<(channel: string, event: object) => void>} wildcard subscribers (all channels) */
const wildcardSubscribers = new Set()

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the bus with a storage adapter.
 * Must be called once before any publish/read calls.
 *
 * @param {import('./storage/types.js').MessageStorageAdapter} storageAdapter
 */
export function initBus(storageAdapter) {
  adapter = storageAdapter
}

/**
 * Get the current bus adapter (for tests / introspection).
 * @returns {import('./storage/types.js').MessageStorageAdapter | null}
 */
export function getAdapter() {
  return adapter
}

/**
 * Reset the bus state. Primarily for tests.
 */
export function resetBus() {
  adapter = null
  subscribers.clear()
  namespaces.clear()
  wildcardSubscribers.clear()
}

// ---------------------------------------------------------------------------
// Namespace registration
// ---------------------------------------------------------------------------

/**
 * Register an event namespace with its known event types.
 * Domain adapters call this at startup to declare their events.
 *
 * @param {string} namespace - e.g., 'message', 'hub', 'notification'
 * @param {{ events?: string[] }} [opts]
 */
export function registerEventNamespace(namespace, opts = {}) {
  namespaces.set(namespace, {
    events: opts.events || [],
  })
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

/**
 * Publish an event to a channel.
 *
 * 1. Creates a full envelope (fills in id, timestamp, defaults)
 * 2. Validates the envelope
 * 3. Warns if the event type namespace is unregistered (dev mode)
 * 4. Persists via the storage adapter
 * 5. Notifies in-process subscribers
 *
 * @param {string} channel
 * @param {object} eventFields - Partial envelope fields (channel is set automatically)
 * @returns {Promise<object>} The complete event envelope as persisted
 */
export async function publish(channel, eventFields) {
  if (!adapter) {
    throw new Error('Bus not initialized. Call initBus(adapter) first.')
  }

  const event = createEnvelope({ ...eventFields, channel })

  const { valid, errors } = validateEnvelope(event)
  if (!valid) {
    throw new Error(`Invalid message envelope: ${errors.join(', ')}`)
  }

  // Warn on unregistered namespace (non-fatal in dev)
  const ns = event.type.split(':')[0]
  if (!namespaces.has(ns)) {
    console.warn(`[messaging-bus] Unregistered event namespace: "${ns}" (type: ${event.type})`)
  }

  // Persist
  await adapter.append(channel, event)

  // Notify channel subscribers
  const channelSubs = subscribers.get(channel)
  if (channelSubs) {
    for (const handler of channelSubs) {
      try {
        handler(event)
      } catch (err) {
        console.error(`[messaging-bus] Subscriber error on ${channel}:`, err)
      }
    }
  }

  // Notify wildcard subscribers
  for (const handler of wildcardSubscribers) {
    try {
      handler(channel, event)
    } catch (err) {
      console.error('[messaging-bus] Wildcard subscriber error:', err)
    }
  }

  return event
}

// ---------------------------------------------------------------------------
// Subscribe
// ---------------------------------------------------------------------------

/**
 * Subscribe to events on a specific channel.
 * @param {string} channel
 * @param {(event: object) => void} handler
 * @returns {() => void} Unsubscribe function
 */
export function subscribe(channel, handler) {
  if (!subscribers.has(channel)) {
    subscribers.set(channel, new Set())
  }
  subscribers.get(channel).add(handler)

  return () => {
    const subs = subscribers.get(channel)
    if (subs) {
      subs.delete(handler)
      if (subs.size === 0) subscribers.delete(channel)
    }
  }
}

/**
 * Subscribe to events on ALL channels (wildcard).
 * Handler receives (channel, event).
 * @param {(channel: string, event: object) => void} handler
 * @returns {() => void} Unsubscribe function
 */
export function subscribeAll(handler) {
  wildcardSubscribers.add(handler)
  return () => wildcardSubscribers.delete(handler)
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read events from a channel.
 *
 * @param {string} channel
 * @param {import('./storage/types.js').ReadOptions} [opts]
 * @returns {Promise<object[]>}
 */
export async function read(channel, opts = {}) {
  if (!adapter) {
    throw new Error('Bus not initialized. Call initBus(adapter) first.')
  }
  return adapter.read(channel, opts)
}

/**
 * Read events from multiple channels in one call.
 *
 * @param {string[]} channels
 * @param {import('./storage/types.js').ReadOptions} [opts] - Applied per channel
 * @returns {Promise<Record<string, object[]>>} Map of channel → events
 */
export async function readMulti(channels, opts = {}) {
  if (!adapter) {
    throw new Error('Bus not initialized. Call initBus(adapter) first.')
  }
  const result = {}
  await Promise.all(
    channels.map(async (ch) => {
      result[ch] = await adapter.read(ch, opts)
    })
  )
  return result
}
