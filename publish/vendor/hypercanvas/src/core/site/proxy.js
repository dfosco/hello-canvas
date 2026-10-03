import http from 'node:http'
import https from 'node:https'
import { normalizeSiteRoute, normalizeSiteUrl } from './contract.js'

const PREVIEW_ROUTE = /^\/_storyboard\/site\/([^/]+)\/preview(?:\/(.*))?$/
const ASSET_ROUTE = /^\/_storyboard\/site\/([^/]+)\/asset(?:\/(.*))?$/
const CORE_SESSION_COOKIE = 'hc_session'
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function normalizeBasePath(base = '/') {
  const normalized = `/${String(base || '/').split('/').filter(Boolean).join('/')}`
  return normalized === '/' ? '' : normalized
}

function stripBasePath(pathname, basePath) {
  return basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))
    ? pathname.slice(basePath.length) || '/'
    : pathname
}

function withoutCoreBase(url, basePath) {
  const normalized = new URL(url.href)
  normalized.pathname = stripBasePath(normalized.pathname, basePath)
  return normalized
}

function parsePreviewPath(pathname, basePath) {
  const match = stripBasePath(pathname, basePath).match(PREVIEW_ROUTE)
  if (!match) return null
  try {
    return { siteId: decodeURIComponent(match[1]), route: decodeURIComponent(match[2] || '') }
  } catch {
    return null
  }
}

function parseAssetPath(pathname, basePath) {
  const match = stripBasePath(pathname, basePath).match(ASSET_ROUTE)
  if (!match) return null
  try {
    return { siteId: decodeURIComponent(match[1]), path: decodeURIComponent(match[2] || '') }
  } catch {
    return null
  }
}

function parseSitePath(pathname, basePath) {
  const match = stripBasePath(pathname, basePath).match(/^\/_storyboard\/site\/([^/]+)(?:\/.*)?$/)
  if (!match) return null
  try {
    return { siteId: decodeURIComponent(match[1]) }
  } catch {
    return null
  }
}

function relativeUrlPath(fromPathname, toPathname) {
  const fromDirectory = new URL('.', new URL(fromPathname, 'http://hypercanvas.local')).pathname
  const fromSegments = fromDirectory.split('/').filter(Boolean)
  const toSegments = toPathname.split('/').filter(Boolean)
  let commonLength = 0
  while (commonLength < fromSegments.length && fromSegments[commonLength] === toSegments[commonLength]) {
    commonLength += 1
  }

  const relativeSegments = [
    ...fromSegments.slice(commonLength).map(() => '..'),
    ...toSegments.slice(commonLength),
  ]
  const relativePath = relativeSegments.join('/') || '.'
  return toPathname.endsWith('/') && relativePath !== '.' ? `${relativePath}/` : relativePath
}

function resolveRelativePreviewUrl(requestUrl, refererUrl, previewRoute, developmentBaseUrl) {
  const upstreamBase = new URL(normalizeSiteUrl(developmentBaseUrl, { loopbackOnly: true, label: 'development base URL' }))
  const upstreamDocument = new URL(normalizeSiteRoute(previewRoute) || '.', upstreamBase)
  const relativePath = relativeUrlPath(refererUrl.pathname, requestUrl.pathname)
  const target = new URL(relativePath, upstreamDocument)
  target.search = requestUrl.search
  return target
}

function isDocumentNavigation(req) {
  const mode = req.headers?.['sec-fetch-mode']
  const destination = req.headers?.['sec-fetch-dest']
  return (mode === 'navigate' && ['document', 'iframe'].includes(destination))
    || (!mode && !destination && String(req.headers?.accept || '').includes('text/html'))
}

function previewPath(basePath, siteId, route = '') {
  const normalizedRoute = normalizeSiteRoute(route)
  return `${basePath}/_storyboard/site/${encodeURIComponent(siteId)}/preview${normalizedRoute ? `/${normalizedRoute}` : '/'}`
}

function assetPath(basePath, siteId, pathname, search = '') {
  const id = encodeURIComponent(siteId)
  const path = String(pathname || '/').replace(/^\/+/, '')
  return `${basePath}/_storyboard/site/${id}/asset/${path}${search}`
}

function routeForUpstreamPath(pathname, developmentBaseUrl) {
  const base = new URL(normalizeSiteUrl(developmentBaseUrl, { loopbackOnly: true, label: 'development base URL' }))
  const basePath = base.pathname.replace(/\/+$/, '')
  const routePath = basePath && pathname.startsWith(`${basePath}/`)
    ? pathname.slice(basePath.length + 1)
    : pathname.replace(/^\/+/, '')
  return normalizeSiteRoute(routePath)
}

function filteredHeaders(headers, { response = false } = {}) {
  const result = {}
  for (const [name, value] of Object.entries(headers || {})) {
    const lowerName = name.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lowerName)) continue
    // Core's browser session and the selected Site are separate trust domains.
    if (!response && ['cookie', 'host', 'origin', 'referer', 'authorization'].includes(lowerName)) continue
    if (response && ['set-cookie', 'content-security-policy', 'x-frame-options', 'cross-origin-resource-policy'].includes(lowerName)) continue
    result[name] = value
  }
  return result
}

function siteRequestCookies(header) {
  return String(header || '').split(';').map(cookie => cookie.trim()).filter(cookie => {
    if (!cookie) return false
    return cookie.slice(0, cookie.indexOf('=')).toLowerCase() !== CORE_SESSION_COOKIE
  }).join('; ')
}

function scopeSiteCookie(cookie, basePath, siteId) {
  const [nameValue, ...attributes] = String(cookie).split(';').map(part => part.trim())
  const prefix = `${basePath}/_storyboard/site/${encodeURIComponent(siteId)}`
  const pathAttribute = attributes.find(attribute => /^path=/i.test(attribute))
  const sitePath = pathAttribute
    ? `${prefix}${pathAttribute.slice(pathAttribute.indexOf('=') + 1).startsWith('/') ? pathAttribute.slice(pathAttribute.indexOf('=') + 1) : `/${pathAttribute.slice(pathAttribute.indexOf('=') + 1)}`}`
    : `${prefix}/`
  const preserved = attributes.filter(attribute => !/^domain=/i.test(attribute) && !/^path=/i.test(attribute))
  return [nameValue, `Path=${sitePath}`, ...preserved].join('; ')
}

function coreOriginFor(req) {
  const host = String(req.headers?.host || '')
  if (!host) return null
  const protocol = req.headers?.['x-forwarded-proto'] === 'https' ? 'https:' : 'http:'
  try { return new URL(`${protocol}//${host}`).origin } catch { return null }
}

function sameLoopbackHost(left, right) {
  const loopback = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
  return loopback.has(left.hostname.toLowerCase())
    && loopback.has(right.hostname.toLowerCase())
    && left.port === right.port
}

function sendError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(message)
}

function rewriteRedirect(location, upstreamBase, basePath, siteId) {
  let target
  try { target = new URL(location, upstreamBase) } catch { return location }
  if (target.origin !== upstreamBase.origin) return location
  return `${previewPath(basePath, siteId, routeForUpstreamPath(target.pathname, upstreamBase))}${target.search}${target.hash}`
}

function proxySiteRequest(req, res, { siteId, route, absolutePath, developmentBaseUrl, basePath }) {
  let upstreamBase
  let target
  try {
    upstreamBase = new URL(normalizeSiteUrl(developmentBaseUrl, { loopbackOnly: true, label: 'development base URL' }))
    target = absolutePath
      ? new URL(`${absolutePath.pathname}${absolutePath.search}`, upstreamBase.origin)
      : new URL(normalizeSiteRoute(route) || '.', upstreamBase)
  } catch (error) {
    sendError(res, 400, error.message)
    return
  }

  const coreOrigin = coreOriginFor(req)
  let requestOrigin
  try { requestOrigin = coreOrigin ? new URL(coreOrigin) : null } catch { requestOrigin = null }
  if (requestOrigin && sameLoopbackHost(target, requestOrigin)) {
    sendError(res, 508, 'Site preview cannot proxy back to Core')
    return
  }

  const transport = target.protocol === 'https:' ? https : http
  const headers = filteredHeaders(req.headers)
  const siteCookies = siteRequestCookies(req.headers?.cookie)
  if (siteCookies) headers.cookie = siteCookies
  if (req.headers?.origin) headers.origin = target.origin
  if (req.headers?.referer) headers.referer = upstreamBase.href
  const upstream = transport.request(target, { method: req.method, headers }, upstreamResponse => {
    const responseHeaders = filteredHeaders(upstreamResponse.headers, { response: true })
    const siteCookies = upstreamResponse.headers['set-cookie']
    if (siteCookies) {
      responseHeaders['set-cookie'] = (Array.isArray(siteCookies) ? siteCookies : [siteCookies])
        .map(cookie => scopeSiteCookie(cookie, basePath, siteId))
    }
    if (upstreamResponse.headers.location) {
      responseHeaders.location = rewriteRedirect(upstreamResponse.headers.location, target, basePath, siteId)
    }
    res.writeHead(upstreamResponse.statusCode || 502, responseHeaders)
    upstreamResponse.pipe(res)
  })
  upstream.once('error', error => {
    if (res.headersSent) return res.destroy(error)
    sendError(res, 502, `Site preview is unavailable: ${error.message}`)
  })
  req.pipe(upstream)
}

/**
 * Keep Site previews on the Core origin so the parent can observe their URL.
 * Root-relative Site assets are associated with the preview through Referer;
 * document navigations are redirected back under the per-Site preview path.
 */
export function createSitePreviewMiddleware({ base = '/', authorizeRequest = () => true, getDevelopmentBaseUrl } = {}) {
  const basePath = normalizeBasePath(base)

  return function sitePreviewMiddleware(req, res, next) {
    let requestUrl
    try { requestUrl = new URL(req.url || '/', 'http://hypercanvas.local') } catch { return next() }
    const directPreview = parsePreviewPath(requestUrl.pathname, basePath)
    const directAsset = parseAssetPath(requestUrl.pathname, basePath)
    let refererUrl = null
    let referringPreview = null
    let referringAsset = null
    try {
      refererUrl = new URL(req.headers?.referer || '')
      referringPreview = parsePreviewPath(refererUrl.pathname, basePath)
      referringAsset = parseAssetPath(refererUrl.pathname, basePath)
    } catch { /* request was not initiated by a Site preview */ }
    const referring = referringPreview || referringAsset
    const preview = directPreview || directAsset || referring
    if (!preview) return next()
    if (typeof getDevelopmentBaseUrl !== 'function' || !authorizeRequest(req)) {
      return sendError(res, 401, 'Site preview requires an authenticated Core session')
    }

    let developmentBaseUrl
    try { developmentBaseUrl = getDevelopmentBaseUrl(preview.siteId) } catch { developmentBaseUrl = null }
    if (!developmentBaseUrl) return sendError(res, 404, 'Site is not running')

    const sitePath = !directPreview && !directAsset ? parseSitePath(requestUrl.pathname, basePath) : null
    const escapedPreviewRequest = Boolean(
      referringPreview
      && sitePath?.siteId === referringPreview.siteId
      && refererUrl,
    )
    let relativePreviewUrl = null
    if (escapedPreviewRequest) {
      try {
        relativePreviewUrl = resolveRelativePreviewUrl(requestUrl, refererUrl, referringPreview.route, developmentBaseUrl)
      } catch (error) {
        return sendError(res, 400, error.message)
      }
    }

    if (!directPreview && !directAsset && isDocumentNavigation(req)) {
      let route
      try { route = routeForUpstreamPath(stripBasePath(requestUrl.pathname, basePath), developmentBaseUrl) } catch (error) { return sendError(res, 400, error.message) }
      res.writeHead(302, {
        Location: `${previewPath(basePath, preview.siteId, route)}${requestUrl.search}`,
        'Cache-Control': 'no-store',
      })
      res.end()
      return
    }

    if (!directPreview && !directAsset) {
      if (relativePreviewUrl) {
        return proxySiteRequest(req, res, {
          siteId: preview.siteId,
          route: '',
          absolutePath: relativePreviewUrl,
          developmentBaseUrl,
          basePath,
        })
      }
      res.writeHead(302, {
        Location: assetPath(basePath, preview.siteId, stripBasePath(requestUrl.pathname, basePath), requestUrl.search),
        'Cache-Control': 'no-store',
      })
      res.end()
      return
    }

    const assetRequestPath = directAsset
      ? `/${normalizeSiteRoute(directAsset.path)}`
      : null
    const assetRequestUrl = assetRequestPath
      ? new URL(`${assetRequestPath}${requestUrl.search}`, 'http://hypercanvas.local')
      : null
    proxySiteRequest(req, res, {
      siteId: preview.siteId,
      route: directPreview ? `${directPreview.route}${requestUrl.search}` : '',
      absolutePath: assetRequestUrl || (directPreview ? null : withoutCoreBase(requestUrl, basePath)),
      developmentBaseUrl,
      basePath,
    })
  }
}
