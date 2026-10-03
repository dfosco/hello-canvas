const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const SITE_ID_RE = /^[a-z0-9][a-z0-9-]*$/

export function normalizeSiteId(value) {
  const id = String(value ?? '').trim().toLowerCase()
  if (!SITE_ID_RE.test(id)) throw new Error('Site ID must be lowercase alphanumeric with dashes')
  return id
}

export function normalizeSiteUrl(value, { loopbackOnly = false, label = 'site URL' } = {}) {
  if (!value) throw new Error(`Missing required ${label}`)
  const url = new URL(String(value))
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Site URL must use HTTP or HTTPS')
  if (loopbackOnly && !LOOPBACK_HOSTS.has(url.hostname)) throw new Error('Development Site URL must use localhost, 127.0.0.1, or ::1')
  if (url.username || url.password || url.search || url.hash) throw new Error('Site URL must not contain credentials, query, or hash')
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.href
}

export function normalizeSiteRoute(value = '') {
  const raw = String(value ?? '').trim().replace(/^\/+/, '')
  if (!raw) return ''
  const base = new URL('https://site.invalid/_route_/')
  const resolved = new URL(raw, base)
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname)) throw new Error('Site route must stay inside its configured base URL')
  return `${resolved.pathname.slice(base.pathname.length)}${resolved.search}${resolved.hash}`
}

export function resolveSiteUrl(baseUrl, siteId, route = '') {
  const id = normalizeSiteId(siteId)
  const base = new URL(normalizeSiteUrl(baseUrl))
  const segments = base.pathname.split('/').filter(Boolean)
  if (segments.at(-1)?.toLowerCase() !== id) segments.push(id)
  const siteBase = new URL(`${segments.join('/')}/`, `${base.origin}/`)
  return new URL(normalizeSiteRoute(route) || '.', siteBase).href
}

/** Local dev servers own their path; the Site ID belongs only to the Core viewer URL. */
export function resolveSiteDevelopmentUrl(baseUrl, route = '') {
  const base = normalizeSiteUrl(baseUrl, { loopbackOnly: true, label: 'development base URL' })
  return new URL(normalizeSiteRoute(route) || '.', base).href
}

/** Build a same-origin Core URL for serving and tracking an embedded Site route. */
export function sitePreviewPath(basePath, siteId, route = '') {
  const base = `/${String(basePath || '/').split('/').filter(Boolean).join('/')}`
  const prefix = base === '/' ? '' : base
  const id = encodeURIComponent(normalizeSiteId(siteId))
  const normalizedRoute = normalizeSiteRoute(route)
  return `${prefix}/_storyboard/site/${id}/preview${normalizedRoute ? `/${normalizedRoute}` : '/'}`
}

/** Resolve a same-origin Site preview URL back to its route, including query/hash. */
export function siteRouteFromPreviewUrl(value, siteId, { basePath = '', origin = null } = {}) {
  try {
    const url = new URL(value, origin || 'http://hypercanvas.local')
    if (origin && url.origin !== new URL(origin).origin) return null
    const id = encodeURIComponent(normalizeSiteId(siteId))
    const prefix = `/_storyboard/site/${id}/preview`
    const pathname = withoutBranchPrefix(url.pathname, basePath).pathname
    if (pathname === prefix) return normalizeSiteRoute(`${url.search}${url.hash}`)
    if (pathname.startsWith(`${prefix}/`)) {
      return normalizeSiteRoute(`${pathname.slice(prefix.length + 1)}${url.search}${url.hash}`)
    }
    // Root-relative links inside a Site can leave the preview prefix. The
    // server redirects document requests back under the prefix; this fallback
    // covers client-side routers that update history without a network request.
    return normalizeSiteRoute(`${pathname.replace(/^\/+/, '')}${url.search}${url.hash}`)
  } catch {
    return null
  }
}

export function siteRouteForUrl(value, baseUrl, siteId, { basePath = '', siteIdInUrl = true } = {}) {
  try {
    const id = normalizeSiteId(siteId)
    const target = new URL(value)
    const base = new URL(normalizeSiteUrl(baseUrl))
    if (normalizedOrigin(target) !== normalizedOrigin(base)) return null
    const targetPath = withoutBranchPrefix(target.pathname, basePath).pathname
    const basePathname = withoutBranchPrefix(base.pathname, basePath).pathname
    const comparablePath = pathname => pathname.replace(/\/+$/, '') || '/'
    if (comparablePath(targetPath) === comparablePath(basePathname)) {
      return normalizeSiteRoute(`${target.search}${target.hash}`)
    }
    if (!siteIdInUrl) {
      const prefix = basePathname.endsWith('/') ? basePathname : `${basePathname}/`
      return targetPath.startsWith(prefix)
        ? normalizeSiteRoute(`${targetPath.slice(prefix.length)}${target.search}${target.hash}`)
        : null
    }
    const segments = basePathname.split('/').filter(Boolean)
    if (segments.at(-1)?.toLowerCase() !== id) segments.push(id)
    const sitePath = `/${segments.join('/')}`
    if (targetPath === sitePath) return normalizeSiteRoute(`${target.search}${target.hash}`)
    if (!targetPath.startsWith(`${sitePath}/`)) return null
    return normalizeSiteRoute(`${targetPath.slice(sitePath.length + 1)}${target.search}${target.hash}`)
  } catch {
    return null
  }
}

export function parseSiteUrl(value, { basePath = '', siteIdInUrl = true } = {}) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    const { pathname, prefixPath } = withoutBranchPrefix(url.pathname, basePath)
    const rest = pathname.replace(/^\/+/, '')
    const firstSlash = rest.indexOf('/')
    const encodedSiteId = firstSlash < 0 ? rest : rest.slice(0, firstSlash)
    let siteId = null
    if (encodedSiteId) {
      try { siteId = normalizeSiteId(decodeURIComponent(encodedSiteId)) } catch { return null }
    }
    const routePath = siteIdInUrl ? (firstSlash < 0 ? '' : rest.slice(firstSlash + 1)) : rest
    const route = normalizeSiteRoute(`${routePath}${url.search}${url.hash}`)
    return {
      origin: url.origin,
      baseUrl: `${url.origin}${prefixPath || ''}/`,
      siteId,
      route,
    }
  } catch {
    return null
  }
}

function normalizedOrigin(url) {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return LOOPBACK_HOSTS.has(hostname)
    ? `${url.protocol}//loopback:${url.port}`
    : url.origin.toLowerCase()
}

function withoutBranchPrefix(pathname, basePath = '') {
  const normalizedBase = String(basePath || '').replace(/\/+$/, '')
  if (normalizedBase && (pathname === normalizedBase || pathname.startsWith(`${normalizedBase}/`))) {
    return { pathname: pathname.slice(normalizedBase.length) || '/', prefixPath: normalizedBase }
  }
  const branch = pathname.match(/^\/(branch--[^/]+)(?=\/|$)/)
  if (branch) return { pathname: pathname.slice(branch[0].length) || '/', prefixPath: `/${branch[1]}` }
  return { pathname, prefixPath: '' }
}
