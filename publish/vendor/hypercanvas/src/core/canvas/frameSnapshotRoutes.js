/**
 * HTTP routes for Frame snapshots: `/_storyboard/frame-snapshot`.
 *
 *   GET  /            — read the persisted descriptor for a Frame target (query params)
 *   POST /            — capture one Frame target (JSON body), bounded and queued
 *   GET  /capability  — capture browser availability and actionable diagnostics
 *
 * GET is side-effect free and works without a running source server. For Site
 * Frames whose portable snapshot is missing, the legacy `.storyboard/site-captures`
 * image for the current binding revision is adopted (marked stale) when present.
 */

import fs from 'node:fs'
import path from 'node:path'
import { frameSnapshotSourceKey, frameSnapshotThemes, normalizeFrameSnapshotTarget, normalizeSnapshotTheme } from './frameSnapshotContract.js'
import { adoptLegacySiteCapture, readFrameSnapshot } from './frameSnapshotStore.js'
import { siteCaptureKey } from '../site/publish.js'
import { resolveNotebookRuntimePath } from '../notebook/runtime.js'

function identity(source) {
  const identity = {}
  if (source.canvasId) identity.canvasId = String(source.canvasId)
  if (source.widgetId) identity.widgetId = String(source.widgetId)
  return identity
}

export function createFrameSnapshotRoutes({ root, sendJson, capture, siteStore = null, eventSender = null }) {
  async function adoptLegacySiteCaptures(target, params, themes) {
    if (!siteStore || target.kind !== 'site') return false
    let binding = null
    try { binding = siteStore.getBinding(target.siteId) } catch { /* unknown Site */ }
    if (!binding) return false
    const revision = Number.isInteger(binding.revision) ? binding.revision : 0
    const reference = { siteId: target.siteId, route: target.route, width: params.width, height: params.height }
    const runtimeDir = resolveNotebookRuntimePath(root, `site-captures/${target.siteId}`)
    let adopted = false
    for (const theme of themes) {
      const legacyPath = path.join(runtimeDir, `${siteCaptureKey(reference, { bindingRevision: revision, theme })}.png`)
      if (!fs.existsSync(legacyPath)) continue
      adopted = (await adoptLegacySiteCapture({ notebookRoot: root, sourceKey: frameSnapshotSourceKey(target), target, variant: theme, legacyPath })) || adopted
    }
    return adopted
  }

  return async function frameSnapshotHandler(req, res, { body = {}, path: routePath = '/', method }) {
    const route = '/' + String(routePath || '/').split('?')[0].replace(/^\//, '')
    try {
      if (method === 'GET' && route === '/capability') {
        let available = false
        let message = 'Frame capture browser is not installed. Run: npx playwright install chromium'
        try {
          const playwright = await import('playwright')
          available = Boolean(playwright?.chromium)
          if (available) message = 'Frame capture browser is available'
        } catch { /* playwright is an optional peer dependency */ }
        return sendJson(res, 200, { capability: { available, browser: 'chromium', message } })
      }

      if (method === 'GET' && (route === '/' || route === '/read')) {
        const query = new URL(req.url, 'http://localhost').searchParams
        const params = Object.fromEntries(query)
        const target = normalizeFrameSnapshotTarget(params)
        const sourceKey = frameSnapshotSourceKey(target)
        const themes = frameSnapshotThemes(params.theme)
        let descriptor = await readFrameSnapshot(root, sourceKey)
        if (descriptor.status === 'missing' && descriptor.light === null && descriptor.dark === null) {
          if (await adoptLegacySiteCaptures(target, params, themes)) {
            descriptor = await readFrameSnapshot(root, sourceKey)
          }
        }
        return sendJson(res, 200, { snapshot: { ...descriptor, identity: identity(params) } })
      }

      if (method === 'POST' && (route === '/' || route === '/capture')) {
        const params = { ...body }
        const target = normalizeFrameSnapshotTarget(params)
        // captureUrl is capture-only input carried on the raw body — the
        // normalized target drops it, so re-attach it for the capture service
        // (prototype captures resolve their document URL from it).
        const captureTarget = typeof params.captureUrl === 'string'
          ? { ...target, captureUrl: params.captureUrl }
          : target
        const result = await capture.capture(captureTarget, {
          theme: params.theme || 'light',
          force: params.force === true,
          origin: params.origin,
          identity: identity(params),
        })
        return sendJson(res, 200, { snapshot: { ...result, identity: identity(params) } })
      }

      return sendJson(res, 404, { error: `Unknown Frame snapshot route: ${method} ${route}` })
    } catch (error) {
      const status = error?.code === 'SITE_NOT_RUNNING' ? 409
        : error?.code === 'FRAME_SOURCE_NOT_LOCAL' || error?.code === 'FRAME_CAPTURE_URL_NOT_LOCAL' || error?.code === 'FRAME_CAPTURE_ORIGIN_NOT_ALLOWED' ? 403
        : 400
      if (error?.code === 'FRAME_SOURCE_NOT_LOCAL') eventSender?.({ type: 'custom', event: 'storyboard:frame-snapshot:failed', data: { code: error.code } })
      return sendJson(res, status, { error: error.message, ...(error.code ? { code: error.code } : {}) })
    }
  }
}

export { normalizeSnapshotTheme }
