import fs from 'node:fs'
import path from 'node:path'

const DIRECTORY_GRANT_PURPOSES = new Set(['notebook', 'site'])
const DEFAULT_DIRECTORY_GRANT_TTL_MS = 10 * 60 * 1000
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function isLoopbackHostname(hostname) {
  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.localhost')
}

export function isFilesystemGrantPurpose(purpose) {
  return DIRECTORY_GRANT_PURPOSES.has(purpose)
}

function grantError(code, message) {
  return Object.assign(new Error(message), { code })
}

function canonicalDirectory(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw grantError('INVALID_FILESYSTEM_ROOT', 'Choose an absolute directory through Core.')
  }
  let canonical
  try {
    canonical = fs.realpathSync.native(path.resolve(value))
    if (!fs.statSync(canonical).isDirectory()) throw new Error('not a directory')
  } catch {
    throw grantError('FILESYSTEM_ROOT_UNAVAILABLE', 'The selected directory is no longer available.')
  }
  if (canonical === path.parse(canonical).root) {
    throw grantError('FILESYSTEM_ROOT_FORBIDDEN', 'The filesystem root cannot be granted to Hypercanvas.')
  }
  return canonical
}

export function isBrowserFilesystemRequest(request) {
  const headers = request?.headers || {}
  if (!headers.origin && !headers['sec-fetch-site']) return !/^node(?:\/|$)/i.test(String(headers['user-agent'] || ''))
  const origin = request?.headers?.origin
  if (typeof origin === 'string') {
    try { return ['http:', 'https:'].includes(new URL(origin).protocol) || Boolean(headers['sec-fetch-site']) } catch { return true }
  }
  return true
}

function loopbackOrigin(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && isLoopbackHostname(url.hostname) ? url.origin : null
  } catch { return null }
}

function requestOrigin(request) {
  const origin = request?.headers?.origin
  if (origin) return loopbackOrigin(origin)
  if (request?.headers?.['sec-fetch-site'] === 'same-origin' && request?.headers?.host) {
    return loopbackOrigin(`http://${request.headers.host}`)
  }
  return null
}

/** Short-lived Core picker grants for browser-selected Notebook and Site roots. */
export function createFilesystemGrants({ ttlMs = DEFAULT_DIRECTORY_GRANT_TTL_MS, now = Date.now } = {}) {
  const grants = new Map()
  const browserOrigins = new Set()

  function registerBrowserOrigin(origin) {
    const normalized = loopbackOrigin(origin)
    if (!normalized) return false
    browserOrigins.add(normalized)
    return true
  }

  function requireTrustedBrowserOrigin(request) {
    const origin = requestOrigin(request)
    if (!origin || !browserOrigins.has(origin)) {
      throw grantError('FILESYSTEM_ORIGIN_NOT_ALLOWED', 'Core filesystem access requires its registered loopback browser origin.')
    }
    return origin
  }

  function grantDirectory(directory, { purpose = 'notebook', request = null } = {}) {
    if (!DIRECTORY_GRANT_PURPOSES.has(purpose)) {
      throw grantError('INVALID_FILESYSTEM_GRANT_PURPOSE', 'Directory grant purpose must be notebook or site.')
    }
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
      throw grantError('INVALID_FILESYSTEM_ROOT', 'Core directory picker must return an absolute path.')
    }
    const root = canonicalDirectory(directory)
    const record = grants.get(root) || { purposes: new Map() }
    record.purposes.set(purpose, {
      expiresAt: now() + ttlMs,
      origin: isBrowserFilesystemRequest(request) ? requireTrustedBrowserOrigin(request) : null,
    })
    grants.set(root, record)
    return root
  }

  function resolveDirectory(request, directory, { purpose = 'notebook', consume = true, allowedRoots = [] } = {}) {
    if (!DIRECTORY_GRANT_PURPOSES.has(purpose)) {
      throw grantError('INVALID_FILESYSTEM_GRANT_PURPOSE', 'Directory grant purpose must be notebook or site.')
    }
    if (!isBrowserFilesystemRequest(request) && purpose === 'notebook' && typeof directory === 'string' && directory.trim()) {
      // The local CLI is an explicit user command and Notebook creation may
      // target a directory that Core will initialize after authorization.
      return path.resolve(directory)
    }
    const browserRequest = isBrowserFilesystemRequest(request)
    const origin = browserRequest ? requireTrustedBrowserOrigin(request) : null
    const root = canonicalDirectory(directory)
    if (!browserRequest) return root

    for (const allowedRoot of allowedRoots) {
      let canonicalAllowed
      try { canonicalAllowed = canonicalDirectory(allowedRoot) } catch { /* unavailable Core-owned roots do not grant access */ }
      if (canonicalAllowed === root) return root
    }

    const record = grants.get(root)
    const grant = record?.purposes.get(purpose)
    if (!grant || grant.expiresAt <= now()) {
      record?.purposes.delete(purpose)
      if (record && record.purposes.size === 0) grants.delete(root)
      throw grantError('FILESYSTEM_GRANT_REQUIRED', 'Choose this directory through Core before using it.')
    }
    if (grant.origin && grant.origin !== origin) {
      throw grantError('FILESYSTEM_GRANT_ORIGIN_MISMATCH', 'The selected directory grant belongs to another browser origin.')
    }
    if (consume) {
      record.purposes.delete(purpose)
      if (record.purposes.size === 0) grants.delete(root)
    }
    return root
  }

  function hasDirectoryGrant(request, directory, options = {}) {
    try {
      resolveDirectory(request, directory, { ...options, consume: false })
      return true
    } catch { return false }
  }

  function clear() {
    grants.clear()
  }

  return Object.freeze({ registerBrowserOrigin, grantDirectory, resolveDirectory, hasDirectoryGrant, clear })
}

export const filesystemGrants = createFilesystemGrants()
