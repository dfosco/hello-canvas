/**
 * Figma URL utilities — detection, sanitization, and embed URL transformation.
 *
 * Supports three Figma link types:
 *   - Board:  figma.com/board/{key}/{name}
 *   - Design: figma.com/design/{key}/{name}
 *   - Proto:  figma.com/proto/{key}/{name}
 */

const FIGMA_HOST_RE = /^(www\.)?figma\.com$/
const FIGMA_PATH_RE = /^\/(board|design|proto)\/[A-Za-z0-9]+/

/** Params to strip from stored/embed URLs (session/tracking tokens). */
const STRIP_PARAMS = new Set(['t'])

/**
 * Check whether a URL string is a Figma board, design, or prototype link.
 * @param {string} url
 * @returns {boolean}
 */
export function isFigmaUrl(url) {
  try {
    const parsed = new URL(url)
    return FIGMA_HOST_RE.test(parsed.hostname) && FIGMA_PATH_RE.test(parsed.pathname)
  } catch {
    return false
  }
}

/**
 * Return the Figma link type: 'board', 'design', or 'proto'.
 * Returns null for non-Figma URLs.
 * @param {string} url
 * @returns {'board' | 'design' | 'proto' | null}
 */
export function getFigmaType(url) {
  try {
    const parsed = new URL(url)
    if (!FIGMA_HOST_RE.test(parsed.hostname)) return null
    const match = parsed.pathname.match(FIGMA_PATH_RE)
    if (!match) return null
    return match[1]
  } catch {
    return null
  }
}

/**
 * Sanitize a Figma URL for storage — strips tracking params like `t`.
 * Returns a canonical www.figma.com URL safe to persist in canvas data.
 * @param {string} url — raw pasted Figma URL
 * @returns {string} sanitized URL
 */
export function sanitizeFigmaUrl(url) {
  try {
    const parsed = new URL(url)
    if (!FIGMA_HOST_RE.test(parsed.hostname)) return url
    // Normalize to www.figma.com
    parsed.hostname = 'www.figma.com'
    for (const key of STRIP_PARAMS) {
      parsed.searchParams.delete(key)
    }
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * Transform a Figma URL into its embed counterpart.
 *
 * - Replaces host with `embed.figma.com`
 * - Strips tracking params (`t`)
 * - Appends `embed-host=share`
 *
 * @param {string} url — original Figma URL
 * @returns {string} embed URL, or the original URL if it can't be transformed
 */
export function toFigmaEmbedUrl(url) {
  try {
    const parsed = new URL(url)
    if (!FIGMA_HOST_RE.test(parsed.hostname)) return url

    parsed.hostname = 'embed.figma.com'

    // Strip tracking/session params
    for (const key of STRIP_PARAMS) {
      parsed.searchParams.delete(key)
    }

    // Ensure embed-host is set
    parsed.searchParams.set('embed-host', 'share')

    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * Extract a human-readable title from a Figma URL.
 * Uses the name segment from the path (e.g. "Security-Products-HQ").
 * @param {string} url
 * @returns {string}
 */
export function getFigmaTitle(url) {
  try {
    const parsed = new URL(url)
    // Path: /board|design|proto/{key}/{name}
    const segments = parsed.pathname.split('/').filter(Boolean)
    if (segments.length >= 3) {
      return segments[2].replace(/-/g, ' ')
    }
    return 'Figma'
  } catch {
    return 'Figma'
  }
}
