import { invoke, isTauriAvailable } from './tauri-bridge.js'

export function isBrowserCoreMode() {
  return typeof window !== 'undefined' && window.__HYPERCANVAS_CORE_MODE__ === true
}

export const PENDING_NOTEBOOK_REDIRECT_KEY = 'hypercanvas.pendingNotebookRedirect'
const NOTEBOOK_REDIRECT_TTL_MS = 2 * 60 * 1000

export function resumePendingNotebookRedirect({ storage, location, navigate, now = Date.now() } = {}) {
  const browserWindow = typeof window !== 'undefined' ? window : null
  const targetStorage = storage || (() => {
    try { return browserWindow?.sessionStorage || null } catch { return null }
  })()
  const currentLocation = location || browserWindow?.location
  if (!targetStorage || !currentLocation) return false

  let pending
  try {
    const value = targetStorage.getItem(PENDING_NOTEBOOK_REDIRECT_KEY)
    if (!value) return false
    pending = JSON.parse(value)
  } catch {
    try { targetStorage.removeItem(PENDING_NOTEBOOK_REDIRECT_KEY) } catch { /* storage may be unavailable */ }
    return false
  }

  const discard = () => {
    try { targetStorage.removeItem(PENDING_NOTEBOOK_REDIRECT_KEY) } catch { /* storage may be unavailable */ }
  }
  if (typeof pending?.url !== 'string' || !Number.isFinite(pending.expiresAt) || pending.expiresAt <= now) {
    discard()
    return false
  }
  try {
    const target = new URL(pending.url, currentLocation.href)
    if (target.origin !== currentLocation.origin) {
      discard()
      return false
    }
    const nextPath = `${target.pathname}${target.search}${target.hash}`
    const currentPath = `${currentLocation.pathname}${currentLocation.search}${currentLocation.hash}`
    if (nextPath === currentPath) {
      discard()
      return false
    }
    ;(navigate || (url => browserWindow.location.replace(url)))(nextPath)
    return true
  } catch {
    discard()
    return false
  }
}

if (typeof window !== 'undefined') resumePendingNotebookRedirect()

export function coreApiPath(pathname) {
  const basePath = typeof window !== 'undefined'
    ? window.__STORYBOARD_BASE_PATH__ || import.meta.env?.BASE_URL || '/'
    : import.meta.env?.BASE_URL || '/'
  return `${String(basePath).replace(/\/+$/, '')}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
}

export function browserAgentSessionUrl({ agentId, widgetId, canvasId } = {}) {
  if (typeof agentId !== 'string' || !agentId.trim()) return null
  const params = new URLSearchParams({ panel: 'agent', agentId: agentId.trim() })
  if (widgetId) params.set('widgetId', String(widgetId))
  if (canvasId) params.set('canvasId', String(canvasId))
  return coreApiPath(`/workspace?${params.toString()}`)
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(coreApiPath(pathname), options)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body?.error?.message || body?.error || `Core request failed (${response.status})`)
    error.status = response.status
    error.code = body?.error?.code || body?.code || null
    throw error
  }
  return body
}

export async function selectNotebookDirectory({ purpose = 'notebook' } = {}) {
  const injectedPicker = globalThis.__STORYBOARD_PICK_NOTEBOOK_FOLDER__
  if (typeof injectedPicker === 'function') return injectedPicker({ purpose })
  if (isTauriAvailable()) return invoke('pick_notebook_folder')
  const result = await requestJson('/_storyboard/system/select-directory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose }),
  })
  return result?.path || null
}

export async function selectCoreFile() {
  const result = await requestJson('/_storyboard/system/select-file', { method: 'POST' })
  return result?.path || null
}

export async function importCoreFile() {
  return requestJson('/_storyboard/system/import-file', { method: 'POST' })
}

export async function openNotebookPath(root) {
  const injectedOpener = globalThis.__STORYBOARD_OPEN_NOTEBOOK__
  if (typeof injectedOpener === 'function') return injectedOpener(root)

  const fallbackRedirect = coreApiPath('/workspace')
  const savePendingRedirect = url => {
    try {
      const target = new URL(url, window.location.href)
      if (target.origin !== window.location.origin) return
      window.sessionStorage.setItem(PENDING_NOTEBOOK_REDIRECT_KEY, JSON.stringify({
        url: `${target.pathname}${target.search}${target.hash}`,
        expiresAt: Date.now() + NOTEBOOK_REDIRECT_TTL_MS,
      }))
    } catch { /* storage can be disabled; readiness polling remains available */ }
  }
  const clearPendingRedirect = () => {
    try { window.sessionStorage.removeItem(PENDING_NOTEBOOK_REDIRECT_KEY) } catch { /* storage can be disabled */ }
  }

  savePendingRedirect(fallbackRedirect)
  let response
  try {
    response = await requestJson('/_storyboard/notebook-runtime/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root }),
    })
  } catch (error) {
    if (error.status || error.code) clearPendingRedirect()
    throw error
  }
  const redirect = response.redirect || fallbackRedirect
  if (!response.restarting) {
    clearPendingRedirect()
    return response
  }
  savePendingRedirect(redirect)
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 250))
    try {
      const status = await requestJson('/_storyboard/notebook-runtime/status')
      if (status.active && !status.restarting) {
        window.location.assign(redirect)
        return status
      }
    } catch { /* Vite may be restarting; retry the branch-aware Core route. */ }
  }
  clearPendingRedirect()
  throw new Error('Core did not finish switching Notebook before the timeout.')
}

export { requestJson as coreRequestJson }
