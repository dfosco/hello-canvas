/** Build static Site page and Site Frame descriptors for Notebook exports. */

import { frameSnapshotSourceKey, normalizeFrameSnapshotTarget } from '../canvas/frameSnapshotContract.js'
import { readFrameSnapshot } from '../canvas/frameSnapshotStore.js'
import { resolveProductionSiteUrl } from '../site/publish.js'
import { SiteStore } from '../site/site.js'

function unavailable(message, code = 'SITE_PUBLICATION_UNAVAILABLE') {
  return { available: false, unavailable: true, diagnostics: [{ code, message }] }
}

function productionEntry(site) {
  const deployment = site?.deployments?.[site?.defaultDeployment]
  return deployment?.baseUrl || null
}

function snapshotPath(sourceKey, variant) {
  return `assets/canvas/snapshots/frames/${sourceKey}/${variant.file}`
}

async function snapshotFor(notebookRoot, target) {
  const sourceKey = frameSnapshotSourceKey(target)
  const descriptor = await readFrameSnapshot(notebookRoot, sourceKey)
  return { sourceKey, descriptor }
}

async function publishedSiteTarget({ notebookRoot, store, siteId, route, title, viewport }) {
  const site = store.get(siteId)
  if (!site) return { ...unavailable(`Site "${siteId}" is not registered in this Notebook.`, 'MISSING_SITE_DESCRIPTOR'), siteId, title, route }
  let openUrl
  try {
    openUrl = resolveProductionSiteUrl(productionEntry(site), route)
  } catch (error) {
    return { ...unavailable(error.message, error.code || 'SITE_PRODUCTION_URL_INVALID'), siteId, title: title || site.title || siteId, route }
  }

  const target = normalizeFrameSnapshotTarget({ kind: 'site', siteId, route, viewport })
  const { sourceKey, descriptor } = await snapshotFor(notebookRoot, target)
  const light = descriptor.light
  const dark = descriptor.dark
  const fallback = light || dark
  return {
    siteId,
    title: title || site.title || siteId,
    route,
    openUrl,
    available: true,
    unavailable: false,
    status: fallback ? 'snapshot' : 'link-only',
    snapshot: light ? snapshotPath(sourceKey, light) : null,
    snapshotDark: dark ? snapshotPath(sourceKey, dark) : null,
    stale: Boolean(fallback?.stale),
    sourceKey,
    viewport: target.viewport,
  }
}

/** Site pages always represent the local home route, independent of navigation. */
export async function preparePublishedSitePages({ notebookRoot, pages }) {
  const store = new SiteStore(notebookRoot)
  const result = new Map()
  for (const page of pages || []) {
    if (page?.type !== 'site') continue
    const published = await publishedSiteTarget({
      notebookRoot,
      store,
      siteId: page.siteId,
      route: '',
      title: page.title,
    })
    result.set(page.id, {
      ...page,
      available: page.available !== false && published.available,
      diagnostics: [...(page.diagnostics || []), ...(published.diagnostics || [])],
      productionUrl: published.openUrl || null,
      snapshot: published.snapshot || null,
      snapshotDark: published.snapshotDark || null,
      publicationStatus: published.status || 'unavailable',
    })
  }
  return result
}

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
