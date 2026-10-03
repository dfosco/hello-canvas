import { createServer } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_INSTANCE_PORT } from '../server/instance-proxy.js'

export const DESKTOP_EVENT_PREFIX = '__HYPERCANVAS_DESKTOP_EVENT__'

export function createDesktopEvent(event, details = {}) {
  return {
    schemaVersion: 1,
    source: 'storyboard-dev',
    event,
    ...details,
  }
}

export function encodeDesktopEvent(event, details = {}) {
  return JSON.stringify(createDesktopEvent(event, details))
}

export function encodeViteDesktopEvent(event, details = {}) {
  return `${DESKTOP_EVENT_PREFIX}${encodeDesktopEvent(event, details)}`
}

export function parseViteDesktopEvent(line) {
  const index = line.indexOf(DESKTOP_EVENT_PREFIX)
  if (index === -1) return null

  try {
    const event = JSON.parse(line.slice(index + DESKTOP_EVENT_PREFIX.length))
    if (event?.schemaVersion !== 1 || event?.source !== 'storyboard-dev' || typeof event?.event !== 'string') {
      return null
    }
    return event
  } catch {
    return null
  }
}

/** Prevent a disconnected desktop host from terminating the Vite process. */
export function ignoreBrokenPipeErrors(stream) {
  stream?.on?.('error', (error) => {
    if (error?.code !== 'EPIPE') throw error
  })
}

export function desktopUrl(host, port, basePath = '/') {
  const base = basePath.startsWith('/') ? basePath : `/${basePath}`
  return `http://${host}:${port}${base}`
}

export function selectEphemeralPort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Could not resolve an ephemeral TCP port'))
        return
      }
      server.close((error) => {
        if (error) reject(error)
        else resolve(address.port)
      })
    })
  })
}

/** Startup-only daemon policy. Notebook config wins over the launch config. */
export function readConfiguredUsePaseoApp({ cwd = process.cwd(), notebookRoot = process.env.HYPERCANVAS_NOTEBOOK_ROOT } = {}) {
  const roots = [...new Set([notebookRoot, cwd].filter(Boolean).map(root => resolve(root)))]
  for (const root of roots) {
    const file = resolve(root, 'storyboard.config.json')
    if (!existsSync(file)) continue
    let config
    try {
      config = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      throw new Error(`Could not read ${file}: ${error.message}`, { cause: error })
    }
    const value = config?.featureFlags?.usePaseoApp
    if (value === undefined) continue
    if (typeof value !== 'boolean') {
      throw new Error(`Invalid featureFlags.usePaseoApp in ${file}: expected a boolean`)
    }
    return value
  }
  return true
}

/** Read the preferred proxy port from the active Notebook, then the launch root. */
export function readConfiguredInstanceProxyPort({ cwd = process.cwd(), notebookRoot = process.env.HYPERCANVAS_NOTEBOOK_ROOT } = {}) {
  const roots = [...new Set([notebookRoot, cwd].filter(Boolean).map((root) => resolve(root)))]
  for (const root of roots) {
    const file = resolve(root, 'storyboard.config.json')
    if (!existsSync(file)) continue

    let config
    try {
      config = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      throw new Error(`Could not read ${file}: ${error.message}`, { cause: error })
    }
    const port = config?.hypercanvas?.proxyPort
    if (port === undefined) continue
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid hypercanvas.proxyPort in ${file}: expected an integer from 1 to 65535`)
    }
    return port
  }
  return null
}

/** Preferred instance-proxy port. Null disables the proxy (legacy behavior). */
export function resolveInstanceProxyPort(env = process.env, configuredPort = DEFAULT_INSTANCE_PORT) {
  if (env.HYPERCANVAS_INSTANCE_PROXY === '0') return null
  const raw = env.HYPERCANVAS_PROXY_PORT
  if (raw === undefined || raw === '') return configuredPort
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid HYPERCANVAS_PROXY_PORT: ${raw}`)
  }
  return port
}

export function isAllowedRequestOrigin(headers, { desktop = false, allowForwardedHttpsOrigin = false } = {}) {
  const host = headers.host
  if (!host) return false
  let loopbackHost = false
  try {
    const hostname = new URL(`http://${host}`).hostname
    loopbackHost = hostname === '127.0.0.1' || hostname === 'localhost' || hostname.endsWith('.localhost')
  } catch { return false }
  if (desktop && !allowForwardedHttpsOrigin && !loopbackHost) return false
  if (!headers.origin) return true
  try {
    const origin = new URL(headers.origin)
    if (origin.host !== host) return false
    if (origin.protocol === 'http:') return loopbackHost || !desktop
    return desktop && allowForwardedHttpsOrigin && origin.protocol === 'https:'
  } catch {
    return false
  }
}
