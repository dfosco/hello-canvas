/**
 * CodePen URL utilities — parse, validate, and convert CodePen URLs
 * to their embeddable format.
 *
 * Supported URL formats:
 *   https://codepen.io/{user}/pen/{penId}
 *   https://codepen.io/{user}/full/{penId}
 *   https://codepen.io/{user}/details/{penId}
 *   https://codepen.io/{user}/embed/{penId}
 */

const CODEPEN_RE = /^https?:\/\/codepen\.io\/([^/]+)\/(pen|full|details|embed)\/([A-Za-z0-9]+)/

/**
 * Check if a URL is a valid CodePen pen URL.
 */
export function isCodePenUrl(url) {
  if (!url) return false
  return CODEPEN_RE.test(url)
}

/**
 * Convert any CodePen pen URL to the embed format.
 * Defaults to showing the result tab with a dark theme.
 */
export function toCodePenEmbedUrl(url) {
  const m = url?.match(CODEPEN_RE)
  if (!m) return ''
  const [, user, , penId] = m
  return `https://codepen.io/${user}/embed/${penId}?default-tab=result&editable=true`
}

/**
 * Extract a fallback title from a CodePen URL (user/penId).
 */
export function getCodePenTitle(url) {
  const m = url?.match(CODEPEN_RE)
  if (!m) return 'CodePen'
  return `${m[1]}/${m[3]}`
}

/**
 * Extract the username from a CodePen URL.
 */
export function getCodePenUser(url) {
  const m = url?.match(CODEPEN_RE)
  return m?.[1] || ''
}

/** In-memory cache for oEmbed results keyed by pen URL. */
const _oembedCache = new Map()

/**
 * Fetch pen metadata (title, author_name) via CodePen's oEmbed API.
 * Returns `{ title, author }` or null on failure. Results are cached.
 */
export async function fetchCodePenMeta(url) {
  if (!url || !isCodePenUrl(url)) return null
  if (_oembedCache.has(url)) return _oembedCache.get(url)

  try {
    const endpoint = `https://codepen.io/api/oembed?url=${encodeURIComponent(url)}&format=json`
    const res = await fetch(endpoint)
    if (!res.ok) return null
    const data = await res.json()
    const meta = {
      title: data.title || '',
      author: data.author_name || '',
    }
    _oembedCache.set(url, meta)
    return meta
  } catch {
    return null
  }
}
