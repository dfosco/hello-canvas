/**
 * Canvas Identity — path-based canvas ID utilities.
 *
 * Canonical canvas IDs are normalized relative paths derived from the file
 * location. They uniquely identify a canvas even when two canvases share the
 * same basename in different folders.
 *
 * Format examples:
 *   src/canvas/overview.canvas.jsonl                  → "overview"
 *   src/canvas/design.folder/overview.canvas.jsonl    → "design/overview"
 *   src/canvas/design.folder/sub.folder/a.canvas.jsonl → "design/sub/a"
 *   src/prototypes/Main/board.canvas.jsonl            → "proto:Main/board"
 *
 * Canvases under src/canvas/ get plain IDs; those under src/prototypes/ get
 * a "proto:" prefix so the two namespaces never collide.
 *
 * Legacy IDs (bare names like "overview") remain supported as aliases when
 * they resolve to exactly one canvas.
 *
 * @module canvas/identity
 */

const CANVAS_SUFFIX_RE = /\.canvas\.jsonl$/
const FOLDER_SUFFIX_RE = /([^/]+)\.folder\//g

/**
 * Convert a relative file path to a canonical canvas ID.
 *
 * @param {string} relPath — path relative to project root
 * @returns {string} canonical canvas ID
 */
export function toCanvasId(relPath) {
  let p = relPath.replace(/\\/g, '/')

  let prefix = ''
  if (p.startsWith('src/canvas/')) {
    p = p.slice('src/canvas/'.length)
  } else if (p.startsWith('src/prototypes/')) {
    p = p.slice('src/prototypes/'.length)
    prefix = 'proto:'
  }

  // Strip .canvas.jsonl suffix
  p = p.replace(CANVAS_SUFFIX_RE, '')

  // Normalize .folder segments: "design.folder/" → "design/"
  p = p.replace(FOLDER_SUFFIX_RE, '$1/')

  // Clean up double slashes and trailing slash
  p = p.replace(/\/+/g, '/').replace(/\/$/, '')

  return prefix + (p || 'unknown')
}

/**
 * Parse a canvas ID into its segments.
 *
 * @param {string} id — canonical canvas ID
 * @returns {{ namespace: 'canvas' | 'prototype', segments: string[], name: string }}
 */
export function parseCanvasId(id) {
  let namespace = 'canvas'
  let raw = id
  if (raw.startsWith('proto:')) {
    namespace = 'prototype'
    raw = raw.slice('proto:'.length)
  }
  const segments = raw.split('/').filter(Boolean)
  const name = segments[segments.length - 1] || raw
  return { namespace, segments, name }
}

/**
 * Extract the basename from a canvas ID (the last segment).
 * Useful for backward-compatible lookups.
 *
 * @param {string} id
 * @returns {string}
 */
export function canvasIdBasename(id) {
  return parseCanvasId(id).name
}

/**
 * Check whether an ID is a legacy bare name (no path segments, no namespace prefix).
 *
 * @param {string} id
 * @returns {boolean}
 */
export function isLegacyCanvasId(id) {
  return !id.includes('/') && !id.startsWith('proto:')
}

/**
 * Known consumers of canvas identity that must be updated when migrating
 * from basename-only to path-based IDs. This inventory is used by downstream
 * slices to track migration completeness.
 */
export const CANVAS_IDENTITY_CONSUMERS = [
  'packages/react/src/vite/data-plugin.js — index & HMR payloads',
  'packages/core/src/canvas/server.js — findCanvasPath() & all API routes',
  'packages/react/src/context.jsx — canvasRouteMap',
  'packages/react/src/canvas/CanvasPage.jsx — cross-canvas copy/paste (canvasName/widgetId)',
  'packages/react/src/canvas/CanvasPage.jsx — viewport persistence keys',
  'packages/core/src/viewfinder.js — canvas listing',
  'packages/core/src/rename-watcher/watcher.js — canvas rename route inference',
]
