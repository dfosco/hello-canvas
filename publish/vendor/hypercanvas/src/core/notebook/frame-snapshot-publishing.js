/**
 * Publish-time preparation for Frame snapshots.
 *
 * Published Site Frames are static: a portable poster image plus a link to
 * the Site's configured production URL. This module enumerates every
 * `site-frame` widget across the canvases being published, resolves its
 * persisted snapshot from the Notebook-owned store, and produces the published
 * frame data plus advisory warnings for unavailable previews/production URLs.
 * Incomplete frames must not prevent the rest of a Notebook from publishing.
 *
 * Prototype Frames keep their live bundled routes in publications; their
 * snapshot assets travel under `assets/canvas/snapshots/` (copied with the
 * Notebook's assets directory) and initial posters resolve through
 * `props.snapshot` when provided.
 */

import { frameSnapshotSourceKey, normalizeFrameSnapshotTarget } from '../canvas/frameSnapshotContract.js'
import { readFrameSnapshot } from '../canvas/frameSnapshotStore.js'
import { resolveProductionSiteUrl } from '../site/publish.js'
import { SiteStore } from '../site/site.js'

function frameWarning(canvas, widget, code, message) {
  return { canvas: canvas.id, widgetId: widget.id, title: widget.props?.title || '', code, message }
}

/**
 * Build published Site Frame data for the given materialized canvases.
 * Returns `{ frames, warnings }` where `frames` maps canvas slug → widget id
 * → partial or complete published frame data, and `warnings` lists optional
 * details that may be unavailable for an individual Site Frame.
 */
export async function preparePublishedFrames({ notebookRoot, canvases }) {
  const store = new SiteStore(notebookRoot)
  const frames = new Map()
  const warnings = []
  for (const canvas of canvases) {
    const widgets = Array.isArray(canvas.state?.widgets) ? canvas.state.widgets : []
    const canvasFrames = {}
    for (const widget of widgets) {
      if (widget?.type !== 'site-frame') continue
      const props = widget.props || {}
      const siteId = typeof props.siteId === 'string' ? props.siteId : ''
      if (!siteId) {
        warnings.push(frameWarning(canvas, widget, 'FRAME_SITE_ID_MISSING', 'Site Frame has no Site ID.'))
        continue
      }
      let target
      try {
        target = normalizeFrameSnapshotTarget({ kind: 'site', siteId, route: props.route, width: props.width, height: props.height })
      } catch (error) {
        warnings.push(frameWarning(canvas, widget, 'FRAME_TARGET_INVALID', error.message))
        continue
      }
      const sourceKey = frameSnapshotSourceKey(target)
      const descriptor = await readFrameSnapshot(notebookRoot, sourceKey)
      const light = descriptor.light
      const frameWarnings = []
      if (!light?.dataUrl) {
        frameWarnings.push(frameWarning(canvas, widget, 'FRAME_SNAPSHOT_MISSING', 'No captured preview is available for this Site Frame.'))
      }
      const site = store.get(siteId)
      const defaultDeployment = site?.defaultDeployment || 'production'
      const productionBaseUrl = site?.deployments?.[defaultDeployment]?.baseUrl || null
      let openUrl = null
      try {
        openUrl = resolveProductionSiteUrl(productionBaseUrl, target.route)
      } catch (error) {
        frameWarnings.push(frameWarning(canvas, widget, error.code || 'FRAME_PRODUCTION_URL_MISSING',
          error.code === 'FRAME_PRODUCTION_URL_MISSING'
            ? `Site "${siteId}" has no production deployment URL; its preview will not link to a live site.`
            : error.message))
      }
      warnings.push(...frameWarnings)
      canvasFrames[widget.id] = {
        siteId,
        title: props.title || site?.title || siteId,
        route: target.route,
        ...(openUrl ? { openUrl } : {}),
        ...(light?.dataUrl ? { snapshot: `assets/canvas/snapshots/frames/${sourceKey}/${descriptor.light.file}` } : {}),
        ...(descriptor.dark?.file ? { snapshotDark: `assets/canvas/snapshots/frames/${sourceKey}/${descriptor.dark.file}` } : {}),
        stale: Boolean(descriptor.light?.stale),
        ...(frameWarnings.length ? { warning: frameWarnings.map(warning => warning.message).join(' ') } : {}),
      }
    }
    if (Object.keys(canvasFrames).length) frames.set(canvas.slug, canvasFrames)
  }
  return { frames, warnings }
}
