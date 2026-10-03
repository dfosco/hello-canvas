/**
 * GitHub GraphQL client for comments.
 *
 * Minimal fetch wrapper with retry, auth header injection, and error handling.
 * PAT is read from auth module at call time.
 */

import { getToken } from './auth.js'

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql'

/**
 * Execute a GitHub GraphQL query/mutation.
 * @param {string} query - GraphQL query or mutation string
 * @param {object} [variables] - GraphQL variables
 * @param {object} [options] - Options
 * @param {number} [options.retries=2] - Number of retries on transient errors
 * @returns {Promise<object>} - The `data` field from the GraphQL response
 */
export async function graphql(query, variables = {}, options = {}) {
  const { retries = 2 } = options
  const token = getToken()
  if (!token) {
    throw new Error('Not authenticated — no GitHub PAT found. Please sign in.')
  }

  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(GITHUB_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          Authorization: `bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      })

      if (res.status === 401) {
        throw new Error('GitHub PAT is invalid or expired. Please sign in again.')
      }

      if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`)
      }

      const json = await res.json()
      if (json.errors?.length) {
        throw new Error(`GraphQL error: ${json.errors.map((e) => e.message).join(', ')}`)
      }

      return json.data
    } catch (err) {
      lastError = err
      // Don't retry auth errors
      if (err.message.includes('401') || err.message.includes('Not authenticated') || err.message.includes('invalid or expired')) {
        throw err
      }
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
      }
    }
  }
  throw lastError
}
