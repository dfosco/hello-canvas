/**
 * Fuzzy Search — lightweight substring + fuzzy scoring for the command palette.
 *
 * Scoring tiers (highest → lowest):
 *   1. Exact prefix match           — query matches start of text
 *   2. Word-boundary match          — query matches at a word boundary
 *   3. Consecutive substring match  — query appears as a contiguous substring
 *   4. Fuzzy character match        — all query chars appear in order
 *
 * Each tier gets a base score, with bonuses for shorter text (tighter match)
 * and penalties for distance between matched characters (fuzzy only).
 */

const SCORE_PREFIX = 100
const SCORE_WORD_BOUNDARY = 75
const SCORE_SUBSTRING = 50
const SCORE_FUZZY = 25

/**
 * Score a single text against a query.
 *
 * @param {string} text   — the string to search in
 * @param {string} query  — the search query (already lowercased by caller)
 * @returns {number} Score ≥ 0 if matched, -1 if no match
 */
export function scoreMatch(text, query) {
  if (!query) return 0
  if (!text) return -1

  const lower = text.toLowerCase()
  const qLen = query.length
  const tLen = lower.length

  // Exact prefix
  if (lower.startsWith(query)) {
    return SCORE_PREFIX + (1 - qLen / tLen) * 10
  }

  // Word-boundary match — query matches right after a non-alphanumeric char
  const boundaryIdx = findWordBoundaryMatch(lower, query)
  if (boundaryIdx >= 0) {
    return SCORE_WORD_BOUNDARY + (1 - boundaryIdx / tLen) * 10
  }

  // Consecutive substring
  const subIdx = lower.indexOf(query)
  if (subIdx >= 0) {
    return SCORE_SUBSTRING + (1 - subIdx / tLen) * 10
  }

  // Fuzzy — all characters in order
  return fuzzyScore(lower, query)
}

/**
 * Find where query matches starting at a word boundary in text.
 * Word boundaries: start of string, after space, /, -, _, .
 */
function findWordBoundaryMatch(text, query) {
  const boundaries = /[\s/\-_.]/
  for (let i = 1; i <= text.length - query.length; i++) {
    if (boundaries.test(text[i - 1]) && text.startsWith(query, i)) {
      return i
    }
  }
  return -1
}

/**
 * Fuzzy match — all query chars must appear in text in order.
 * Score decreases with gaps between matched characters.
 */
function fuzzyScore(text, query) {
  let qi = 0
  let totalGap = 0
  let lastMatch = -1

  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) {
      if (lastMatch >= 0) totalGap += ti - lastMatch - 1
      lastMatch = ti
      qi++
    }
  }

  if (qi < query.length) return -1 // not all chars matched

  const gapPenalty = Math.min(totalGap * 2, 20)
  return SCORE_FUZZY - gapPenalty
}

/**
 * Search an array of items and return scored, sorted results.
 *
 * @param {Array<{ label: string, [key: string]: any }>} items
 * @param {string} query — raw search input
 * @param {{ key?: string, maxResults?: number }} [opts]
 * @returns {Array<{ item: object, score: number }>}
 */
export function fuzzySearch(items, query, opts = {}) {
  const key = opts.key || 'label'
  const max = opts.maxResults || 50
  const q = query.toLowerCase().trim()

  if (!q) return items.slice(0, max).map(item => ({ item, score: 0 }))

  const scored = []
  for (const item of items) {
    const text = item[key]
    if (!text) continue
    const score = scoreMatch(text, q)
    if (score >= 0) scored.push({ item, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, max)
}
