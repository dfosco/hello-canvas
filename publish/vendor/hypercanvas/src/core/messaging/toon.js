/**
 * TOON Wire Format Boundary
 *
 * Thin wrapper around @toon-format/toon for HTTP content negotiation.
 * Used by routes.js to encode/decode TOON at the HTTP boundary.
 * The bus core and JSONL storage remain JSON — TOON is an agent-facing optimization.
 */

let _encode = null
let _decode = null
let _loaded = false

/**
 * Lazily load @toon-format/toon to avoid hard dependency errors
 * if the package isn't installed.
 */
async function loadToon() {
  if (_loaded) return { encode: _encode, decode: _decode }
  try {
    const toon = await import(/* @vite-ignore */ '@toon-format/toon')
    _encode = toon.encode || toon.default?.encode
    _decode = toon.decode || toon.default?.decode
    _loaded = true
  } catch {
    _loaded = true // Don't retry
    console.warn('[messaging-bus] @toon-format/toon not available, TOON format disabled')
  }
  return { encode: _encode, decode: _decode }
}

/**
 * Determine the response format from the Accept header.
 * @param {import('node:http').IncomingMessage} req
 * @returns {'toon' | 'json'}
 */
export function negotiateFormat(req) {
  const accept = req.headers?.accept || ''
  return accept.includes('text/toon') ? 'toon' : 'json'
}

/**
 * Serialize data for the response based on negotiated format.
 * Falls back to JSON if TOON encoding fails or isn't available.
 *
 * @param {any} data
 * @param {'toon' | 'json'} format
 * @returns {Promise<{ body: string, contentType: string }>}
 */
export async function serializeResponse(data, format) {
  if (format === 'toon') {
    const { encode } = await loadToon()
    if (encode) {
      try {
        return { body: encode(data), contentType: 'text/toon; charset=utf-8' }
      } catch {
        // Fall through to JSON
      }
    }
  }
  return { body: JSON.stringify(data), contentType: 'application/json' }
}

/**
 * Parse a request body based on Content-Type.
 * Supports application/json and text/toon.
 *
 * @param {string | object} body - Raw body string or already-parsed object
 * @param {string} [contentType]
 * @returns {Promise<any>}
 */
export async function parseRequestBody(body, contentType) {
  if (typeof body === 'object') return body // Already parsed by middleware

  if (contentType?.includes('text/toon')) {
    const { decode } = await loadToon()
    if (decode) return decode(body)
    throw new Error('TOON format requested but @toon-format/toon is not available')
  }

  return JSON.parse(body)
}
