/** Minimal Tauri bridge that keeps the external Notebook runtime dependency-free. */

function internals() {
  return globalThis.__TAURI_INTERNALS__
}

function devlog(message, details = {}) {
  console.debug('[devlog][tauri-bridge]', message, details)
}

export function isTauriAvailable() {
  const available = Boolean(internals()?.invoke)
  devlog('availability check', { available, hasInternals: Boolean(internals()), hasInvoke: Boolean(internals()?.invoke) })
  return available
}

export function invoke(command, args = {}) {
  const api = internals()
  devlog('invoke start', { command, args, available: Boolean(api?.invoke) })
  if (!api?.invoke) {
    const error = new Error('Native Hypercanvas bridge is unavailable.')
    devlog('invoke rejected: bridge unavailable', { command, error: error.message })
    return Promise.reject(error)
  }
  return api.invoke(command, args)
    .then(result => {
      devlog('invoke succeeded', { command, result })
      return result
    })
    .catch(error => {
      devlog('invoke failed', { command, error: error?.message || String(error), name: error?.name })
      throw error
    })
}

export async function listen(event, handler) {
  const api = internals()
  devlog('listen start', { event, available: Boolean(api?.invoke && api?.transformCallback) })
  if (!api?.invoke || !api?.transformCallback) {
    throw new Error('Native Hypercanvas event bridge is unavailable.')
  }
  const eventId = await api.invoke('plugin:event|listen', {
    event,
    target: { kind: 'Any' },
    handler: api.transformCallback(handler),
  })
  devlog('listen succeeded', { event, eventId })
  return () => api.invoke('plugin:event|unlisten', { event, eventId })
}
