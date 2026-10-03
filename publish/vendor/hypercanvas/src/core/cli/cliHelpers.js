/**
 * Shared CLI helpers for server communication.
 *
 * Lightweight wrappers around fetch() using the resolved server URL.
 * Unlike create.js helpers, these don't depend on @clack/prompts so
 * they can be used in simple/non-interactive CLI commands.
 */

import { getServerUrl } from './serverUrl.js'

function responseError(data, fallback) {
  return data?.error?.message || data?.error || fallback
}

/**
 * POST JSON to the dev server.
 * @param {string} path - URL path (e.g. '/_storyboard/canvas/widget')
 * @param {object} body - JSON body
 * @returns {Promise<object>} Parsed JSON response
 */
export async function post(path, body) {
  const base = getServerUrl()
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(responseError(data, `${res.status} ${res.statusText}`))
  }
  return data
}

/**
 * GET JSON from the dev server.
 * @param {string} path - URL path with query string
 * @returns {Promise<object>} Parsed JSON response
 */
export async function get(path) {
  const base = getServerUrl()
  const res = await fetch(`${base}${path}`, {
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(responseError(data, `${res.status} ${res.statusText}`))
  }
  return data
}

/**
 * PUT JSON to the dev server.
 * @param {string} path - URL path
 * @param {object} body - JSON body
 * @returns {Promise<object>} Parsed JSON response
 */
export async function put(path, body) {
  const base = getServerUrl()
  const res = await fetch(`${base}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(responseError(data, `${res.status} ${res.statusText}`))
  }
  return data
}

/**
 * PATCH JSON to the dev server.
 * @param {string} path - URL path
 * @param {object} body - JSON body
 * @returns {Promise<object>} Parsed JSON response
 */
export async function patch(path, body) {
  const base = getServerUrl()
  const res = await fetch(`${base}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(responseError(data, `${res.status} ${res.statusText}`))
  }
  return data
}

/**
 * DELETE JSON to the dev server.
 * @param {string} path - URL path
 * @param {object} body - JSON body
 * @returns {Promise<object>} Parsed JSON response
 */
export async function del(path, body) {
  const base = getServerUrl()
  const res = await fetch(`${base}${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(responseError(data, `${res.status} ${res.statusText}`))
  }
  return data
}

/**
 * Parse simple CLI args into { positional, flags }.
 */
export function parseSimpleArgs(args) {
  const result = { positional: [], flags: {} }
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2)
      const next = args[i + 1]
      if (next && !next.startsWith('--')) {
        result.flags[key] = next
        i++
      } else {
        result.flags[key] = true
      }
    } else if (args[i].startsWith('-') && args[i].length === 2) {
      const key = args[i].slice(1)
      const next = args[i + 1]
      if (next && !next.startsWith('-')) {
        result.flags[key] = next
        i++
      } else {
        result.flags[key] = true
      }
    } else {
      result.positional.push(args[i])
    }
  }
  return result
}

/**
 * Print JSON output and exit.
 */
export function jsonOut(data) {
  console.log(JSON.stringify(data, null, 2))
}

/**
 * Print error and exit.
 */
export function die(msg, code = 1) {
  console.error(`Error: ${msg}`)
  process.exit(code)
}
