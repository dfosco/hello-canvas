import { normalizeSiteId, normalizeSiteRoute, normalizeSiteUrl, resolveSiteUrl } from './contract.js'

const LOOPBACK_HOSTNAME = /^(localhost|127\.0\.0\.1|::1|\[::1\])$/i

export function normalizeSiteReference(value = {}) {
  return {
    siteId: normalizeSiteId(value.siteId),
    route: normalizeSiteRoute(value.route),
    ...(value.title ? { title: String(value.title) } : {}),
    ...(value.width ? { width: positive(value.width, 800) } : {}),
    ...(value.height ? { height: positive(value.height, 600) } : {}),
  }
}

export function siteCaptureKey(reference, { bindingRevision = 0, theme = 'light' } = {}) {
  const normalized = normalizeSiteReference(reference)
  return stableHash(JSON.stringify({ ...normalized, bindingRevision, theme }))
}

function stableHash(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(16).padStart(8, '0').repeat(3).slice(0, 24)
}

export function createPublishedSiteFrame(reference, { productionBaseUrl, snapshotUrl, bindingRevision = 0, theme = 'light' } = {}) {
  const normalized = normalizeSiteReference(reference)
  const openUrl = resolveSiteUrl(productionBaseUrl, normalized.siteId, normalized.route)
  return {
    ...normalized,
    openUrl,
    snapshotUrl: snapshotUrl ?? null,
    captureKey: siteCaptureKey(normalized, { bindingRevision, theme }),
    mode: snapshotUrl ? 'snapshot' : 'unavailable',
  }
}

/**
 * Resolve a published Site Frame's production link.
 *
 * Unlike the development resolver, the configured production base URL is the
 * Site's actual web root: only the normalized route is appended — no Site ID
 * path segment is invented. Loopback bases are rejected because a published
 * frame must link to a real deployment.
 */
export function resolveProductionSiteUrl(productionBaseUrl, route = '') {
  if (!productionBaseUrl) {
    throw Object.assign(new Error('Production base URL is missing'), { code: 'FRAME_PRODUCTION_URL_MISSING' })
  }
  const base = new URL(normalizeSiteUrl(productionBaseUrl, { label: 'production base URL' }))
  if (LOOPBACK_HOSTNAME.test(base.hostname)) {
    throw Object.assign(new Error('Production Site URL must not be a localhost address'), { code: 'FRAME_PRODUCTION_URL_LOCAL' })
  }
  return new URL(normalizeSiteRoute(route) || '.', base).href
}

function positive(value, fallback) { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback }
