/**
 * Pure, dependency-free viewport math for Frame snapshots.
 *
 * Shared by the browser Frame renderers (PrototypeEmbed, SiteFrame) and the
 * Node-only capture service so both agree on the exact content viewport a
 * snapshot represents: widget chrome (the title bar) is excluded, Prototype
 * zoom scales the embedded document, and dimensions are integer-rounded.
 */

export const FRAME_HEADER_HEIGHT = 37

function positive(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

/** Content viewport of a Prototype Frame widget at its persisted zoom. */
export function prototypeContentViewport({ width = 800, height = 600, zoom = 100 } = {}) {
  const scale = positive(zoom, 100) / 100
  return {
    width: Math.round(positive(width, 800) / scale),
    height: Math.round(Math.max(0, positive(height, 600) - FRAME_HEADER_HEIGHT) / scale),
  }
}

/** Content viewport of a Site Frame widget (title bar excluded). */
export function siteContentViewport({ width = 800, height = 600 } = {}) {
  return {
    width: Math.round(positive(width, 800)),
    height: Math.round(Math.max(0, positive(height, 600) - FRAME_HEADER_HEIGHT)),
  }
}

/** Hard bounds applied to any capture viewport before launching a browser. */
export function clampCaptureViewport(viewport = {}) {
  return {
    width: Math.min(4000, Math.max(200, Math.round(positive(viewport.width, 800)))),
    height: Math.min(4000, Math.max(200, Math.round(positive(viewport.height, 600)))),
  }
}

/**
 * Stable identity of a Frame target excluding its viewport, used client-side
 * to decide whether a previous preview may be retained as a stale fallback
 * across resizes (same logical route) or must be discarded (new route).
 */
export function frameTargetIdentityKey(target = {}) {
  return JSON.stringify({
    kind: target.kind === 'site' ? 'site' : 'prototype',
    src: target.kind === 'site' ? undefined : target.src,
    siteId: target.kind === 'site' ? target.siteId : undefined,
    route: target.kind === 'site' ? target.route : undefined,
    zoom: target.kind === 'site' ? undefined : target.zoom,
  })
}
