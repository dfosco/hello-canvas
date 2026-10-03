/** Lifecycle messages sent from Core to a supervising application wrapper. */
export const WRAPPER_EVENT_SOURCE = 'hypercanvas-core'
export const WRAPPER_EVENT_VERSION = 1

export function createWrapperEvent(event, details = {}) {
  if (!['starting', 'ready', 'running', 'error', 'stopped'].includes(event)) {
    throw new Error(`Unsupported wrapper lifecycle event: ${event}`)
  }
  return { ...details, schemaVersion: WRAPPER_EVENT_VERSION, source: WRAPPER_EVENT_SOURCE, event }
}

export function encodeWrapperEvent(event, details = {}) {
  return JSON.stringify(createWrapperEvent(event, details))
}
