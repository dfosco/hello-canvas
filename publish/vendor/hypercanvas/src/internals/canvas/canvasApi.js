/**
 * Client-side API for canvas CRUD operations.
 * Calls the /_storyboard/canvas/ server endpoints.
 */

const BASE = '/_storyboard/canvas'
const WIDGET_REFS_KEY = '__storyboardCanvasWidgetRefs'

function getWidgetRefsStore() {
  const root = typeof window !== 'undefined' ? window : globalThis
  if (!root[WIDGET_REFS_KEY]) root[WIDGET_REFS_KEY] = new Map()
  return root[WIDGET_REFS_KEY]
}

export function setWidgetRef(id, ref) {
  if (!id) return
  const refs = getWidgetRefsStore()
  if (ref) refs.set(id, ref)
  else refs.delete(id)
}

export function getWidgetRef(id) {
  if (!id) return null
  return getWidgetRefsStore().get(id) ?? null
}

function getApiBase() {
  const base = (import.meta.env?.BASE_URL || '/').replace(/\/$/, '')
  return base + BASE
}

async function request(path, method, body) {
  const url = getApiBase() + path
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

/**
 * Like `request` but also returns the HTTP status code so callers can
 * distinguish between "endpoint succeeded but logical no-op" and "the
 * target resource is gone" (which undo/redo handle differently after
 * compaction wipes event ids).
 */
async function requestWithStatus(path, method, body) {
  const url = getApiBase() + path
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok, data }
}

export function listCanvases() {
  return request('/list', 'GET')
}

export function createCanvas(data) {
  return request('/create', 'POST', data)
}

export function updateCanvas(canvasId, { widgets, sources, settings, connectors }) {
  return request('/update', 'PUT', { name: canvasId, widgets, sources, settings, connectors })
}

export function patchWidget(canvasId, widgetId, { props, position } = {}) {
  return request('/widget', 'PATCH', { name: canvasId, widgetId, props, position })
}

export function undoEvent(canvasId, eventId) {
  return requestWithStatus('/undo', 'POST', { name: canvasId, eventId })
}

export function redoEvent(canvasId, eventId) {
  return requestWithStatus('/redo', 'POST', { name: canvasId, eventId })
}

export function addWidget(canvasId, { type, props, position, near, direction }) {
  return request('/widget', 'POST', { name: canvasId, type, props, position, near, direction })
}

export function removeWidget(canvasId, widgetId) {
  return request('/widget', 'DELETE', { name: canvasId, widgetId })
}

export function uploadImage(dataUrl, canvasId, filename) {
  const body = { dataUrl, canvasName: canvasId }
  if (filename) body.filename = filename
  return request('/image', 'POST', body)
}

export function toggleImagePrivacy(filename) {
  return request('/image/toggle-private', 'POST', { filename })
}

export function duplicateImage(filename) {
  return request('/image/duplicate', 'POST', { filename })
}

/**
 * Crop an image client-side and upload the result.
 * @param {string} imageSrc — current image filename, possibly prefixed with `drafts/` and/or `~`
 *   (e.g. "drafts/~canvas--2026-01-01--12-00-00.png")
 * @param {{ x: number, y: number, width: number, height: number }} cropRect — crop region in natural image pixels
 * @param {string} canvasId — canvas name for directory resolution (server uses this to decide drafts/ vs public)
 * @returns {Promise<{ success: boolean, filename: string }>}
 */
export async function cropAndUpload(imageSrc, cropRect, canvasId) {
  const imageUrl = (() => {
    const base = (import.meta.env?.BASE_URL || '/').replace(/\/$/, '')
    return `${base}/_storyboard/canvas/images/${imageSrc}`
  })()

  // Load the image into an offscreen canvas
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = reject
    img.src = imageUrl
  })

  // Draw the cropped region
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(cropRect.width)
  canvas.height = Math.round(cropRect.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(
    img,
    Math.round(cropRect.x), Math.round(cropRect.y),
    Math.round(cropRect.width), Math.round(cropRect.height),
    0, 0,
    canvas.width, canvas.height,
  )

  // Strip optional `drafts/` directory prefix — the server re-adds it based
  // on canvasId. We only pass the basename through the cropped-filename
  // pipeline (the server validates `--cropped--` filenames as basenames).
  const srcBase = imageSrc.includes('/') ? imageSrc.slice(imageSrc.lastIndexOf('/') + 1) : imageSrc

  // Determine output format from original filename
  const ext = srcBase.split('.').pop()?.toLowerCase() || 'png'
  const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }
  const mime = mimeMap[ext] || 'image/png'
  const dataUrl = canvas.toDataURL(mime, 0.92)

  // Build cropped filename: strip any previous --cropped-- suffix, append new one
  const privacyPrefix = srcBase.startsWith('~') ? '~' : ''
  const baseName = srcBase.replace(/^~/, '')
  const withoutCrop = baseName.replace(/--cropped--\d{4}-\d{2}-\d{2}--\d{2}-\d{2}-\d{2}/, '')
  const nameWithoutExt = withoutCrop.replace(/\.\w+$/, '')
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}--${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  const croppedFilename = `${privacyPrefix}${nameWithoutExt}--cropped--${ts}.${ext}`

  return uploadImage(dataUrl, canvasId, croppedFilename)
}

export function batchOperations(canvasId, operations) {
  return request('/batch', 'POST', { name: canvasId, operations })
}

export function getCanvas(canvasId) {
  return request(`/read?name=${encodeURIComponent(canvasId)}`, 'GET')
}

export function checkGitHubCliAvailable() {
  return request('/github/available', 'GET')
}

export function fetchGitHubEmbed(url) {
  return request('/github/embed', 'POST', { url })
}

export function renamePage(canvasId, newTitle) {
  return request('/rename-page', 'PUT', { name: canvasId, newTitle })
}

export function reorderPages(folder, order) {
  return request('/reorder-pages', 'PUT', { folder, order })
}

export function getPageOrder(folder) {
  return request(`/page-order?folder=${encodeURIComponent(folder)}`, 'GET')
}

export function updateFolderMeta(folder, title) {
  return request('/update-folder-meta', 'PUT', { folder, title })
}

export function duplicateCanvas(canvasId, newTitle) {
  return request('/duplicate', 'POST', { name: canvasId, newTitle })
}

export function addConnector(canvasId, { startWidgetId, startAnchor, endWidgetId, endAnchor, connectorType, meta }) {
  return request('/connector', 'POST', {
    name: canvasId,
    startWidgetId,
    startAnchor,
    endWidgetId,
    endAnchor,
    connectorType,
    meta,
  })
}

export function getHubRoles() {
  return request('/roles', 'GET')
}

export function removeConnector(canvasId, connectorId) {
  return request('/connector', 'DELETE', { name: canvasId, connectorId })
}

export function updateConnector(canvasId, connectorId, meta) {
  return request('/connector', 'PATCH', { name: canvasId, connectorId, meta })
}

export function setConnectorWaypoints(canvasId, connectorId, waypoints) {
  return request('/connector/waypoints', 'POST', { name: canvasId, connectorId, waypoints })
}

export function clearConnectorWaypoints(canvasId, connectorId) {
  return request('/connector/waypoints', 'DELETE', { name: canvasId, connectorId })
}
