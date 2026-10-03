/**
 * Node-side contract for persistent Frame snapshots.
 *
 * A snapshot target is the canonical identity of what a Prototype or Site
 * Frame preview represents: the logical route (including query and hash),
 * the content viewport, and theme-independent rendering options. Titles,
 * widget positions, dev origins/ports, and binding revisions are excluded
 * from portable identity. Theme variants share one target manifest but get
 * distinct capture keys.
 */

import { createHash } from 'node:crypto'
import { normalizeSiteId, normalizeSiteRoute } from '../site/contract.js'
import { clampCaptureViewport, prototypeContentViewport, siteContentViewport } from './frameSnapshotViewport.js'

export const FRAME_SNAPSHOT_FORMAT_VERSION = 1

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function snapshotError(code, message) {
  return Object.assign(new Error(message), { code })
}
function positive(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function targetViewport(input, fallback) {
  const viewport = input.viewport
  if (viewport && typeof viewport === 'object' && !Array.isArray(viewport)) {
    return clampCaptureViewport(viewport)
  }
  return clampCaptureViewport(fallback())
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

/**
 * Loopback hostnames only. Subdomains under the reserved `.localhost` TLD
 * (e.g. `hypercanvas.localhost` — the local instance proxy domain) resolve
 * to loopback just like bare `localhost`, so they are valid dev origins too.
 */
function isLoopbackHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost')
}

/**
 * Normalize a Prototype Frame route for identity. Legacy branch prefixes are
 * stripped so a Frame's identity is stable across branch deployments; user
 * query and hash state are preserved.
 */
function normalizePrototypeSrc(value) {
  const src = String(value ?? '').trim()
  if (!src) throw snapshotError('FRAME_SOURCE_REQUIRED', 'Prototype Frame snapshot requires a prototype route')
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) {
    let parsed = null
    try { parsed = new URL(src) } catch { throw snapshotError('FRAME_SOURCE_INVALID', `Prototype Frame source is not a valid URL: ${src}`) }
    if (!['http:', 'https:'].includes(parsed.protocol) || !isLoopbackHostname(parsed.hostname)) {
      throw snapshotError('FRAME_SOURCE_NOT_LOCAL', 'Prototype Frame snapshots capture same-origin or localhost routes only')
    }
    if (parsed.username || parsed.password) throw snapshotError('FRAME_SOURCE_NOT_LOCAL', 'Prototype Frame snapshots must not include credentials')
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  }
  return src.replace(/^\/branch--[^/]+/, '') || '/'
}

/**
 * Canonical snapshot target for one Frame widget. Throws with stable error
 * codes for invalid input so callers can surface actionable messages.
 */
export function normalizeFrameSnapshotTarget(input = {}) {
  const kind = input.kind === 'site' ? 'site' : 'prototype'
  if (kind === 'site') {
    const siteId = normalizeSiteId(input.siteId)
    const route = normalizeSiteRoute(input.route)
    const viewport = targetViewport(input, () => siteContentViewport(input))
    return { kind, siteId, route, viewport }
  }
  const src = normalizePrototypeSrc(input.src)
  const zoom = positive(input.zoom, 100)
  const viewport = targetViewport(input, () => prototypeContentViewport({ width: input.width, height: input.height, zoom }))
  return { kind, src, zoom, viewport }
}

/** 128-bit portable identity of a snapshot target (stable across sessions). */
export function frameSnapshotSourceKey(target) {
  return digest(`${FRAME_SNAPSHOT_FORMAT_VERSION}\n${stableStringify(target)}`)
}

/** Identity of one theme variant of a target. */
export function frameSnapshotVariantKey(sourceKey, theme) {
  return digest(`${sourceKey}\n${theme === 'dark' ? 'dark' : 'light'}`)
}

export function normalizeSnapshotTheme(value) {
  return value === 'dark' ? 'dark' : 'light'
}

/** Expand a requested theme option into the concrete variants to capture. */
export function frameSnapshotThemes(value) {
  if (value === 'both') return ['light', 'dark']
  return [normalizeSnapshotTheme(value)]
}

/**
 * Validate and absolutize a capture URL supplied by a Frame renderer. Only
 * same-origin relative paths and loopback http(s) URLs are allowed — this is
 * Frame identity, not an arbitrary screenshot service.
 */
export function normalizeFrameCaptureUrl(value, { origin = null } = {}) {
  const raw = String(value ?? '').trim()
  if (!raw) throw snapshotError('FRAME_CAPTURE_URL_REQUIRED', 'Frame capture requires the Frame document URL')
  if (!raw.startsWith('/') && !/^https?:\/\//i.test(raw)) {
    throw snapshotError('FRAME_CAPTURE_URL_INVALID', `Frame capture URL must be a path or an absolute URL: ${raw}`)
  }
  let base = null
  if (origin) {
    const parsedOrigin = new URL(String(origin))
    if (!['http:', 'https:'].includes(parsedOrigin.protocol) || !isLoopbackHostname(parsedOrigin.hostname)) {
      throw snapshotError('FRAME_CAPTURE_ORIGIN_NOT_ALLOWED', 'Frame capture origin must be a local development origin')
    }
    base = parsedOrigin
  }
  let parsed
  try { parsed = new URL(raw, base || 'http://localhost/') } catch { throw snapshotError('FRAME_CAPTURE_URL_INVALID', `Frame capture URL is invalid: ${raw}`) }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw snapshotError('FRAME_CAPTURE_URL_INVALID', 'Frame capture URL must use HTTP or HTTPS')
  if (!isLoopbackHostname(parsed.hostname)) throw snapshotError('FRAME_CAPTURE_URL_NOT_LOCAL', 'Frame capture URL must be a localhost development server')
  if (parsed.username || parsed.password) throw snapshotError('FRAME_CAPTURE_URL_INVALID', 'Frame capture URL must not contain credentials')
  return parsed.href
}
