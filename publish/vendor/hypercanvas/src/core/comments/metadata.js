/**
 * Metadata parser/serializer for comment body metadata blocks.
 *
 * Format: <!-- sb-meta {"x":45.2,"y":30.1} -->
 *
 * Embedded as an HTML comment at the start of the Discussion comment body.
 */

const META_REGEX = /<!--\s*sb-meta\s+(\{.*?\})\s*-->/

/**
 * Parse metadata from a comment body string.
 * @param {string} body - The full comment body
 * @returns {{ meta: object|null, text: string }} - Parsed meta and remaining text
 */
export function parseMetadata(body) {
  if (!body) return { meta: null, text: '' }

  const match = body.match(META_REGEX)
  if (!match) return { meta: null, text: body.trim() }

  try {
    const meta = JSON.parse(match[1])
    const text = body.replace(META_REGEX, '').trim()
    return { meta, text }
  } catch {
    return { meta: null, text: body.trim() }
  }
}

/**
 * Serialize metadata into a comment body string.
 * @param {object} meta - Metadata object (e.g. { x: 45.2, y: 30.1 })
 * @param {string} text - The comment text content
 * @returns {string} - Full comment body with embedded metadata
 */
export function serializeMetadata(meta, text) {
  const metaStr = `<!-- sb-meta ${JSON.stringify(meta)} -->`
  return `${metaStr}\n${text}`
}

/**
 * Update metadata in an existing comment body, preserving the text.
 * @param {string} body - The existing comment body
 * @param {object} updates - Fields to merge into the existing metadata
 * @returns {string} - Updated comment body
 */
export function updateMetadata(body, updates) {
  const { meta, text } = parseMetadata(body)
  const newMeta = { ...meta, ...updates }
  return serializeMetadata(newMeta, text)
}
