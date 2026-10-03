const ID = /^[A-Za-z0-9_-]{1,128}$/

function key(workspaceId, serviceName) {
  if (!ID.test(String(workspaceId || ''))) throw new Error('workspaceId is required')
  if (!ID.test(String(serviceName || ''))) throw new Error('serviceName is required')
  return `${workspaceId}:${serviceName}`
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol')
    return parsed.toString().replace(/\/$/, '')
  } catch {
    throw new Error('service URL must be an HTTP or HTTPS URL')
  }
}

export function createWorkspaceServiceRegistry() {
  const services = new Map()
  return {
    register({ workspaceId, serviceName, url, metadata = {} } = {}) {
      const entry = { workspaceId: String(workspaceId), serviceName: String(serviceName), url: normalizeUrl(url), metadata: { ...metadata }, updatedAt: new Date().toISOString() }
      services.set(key(workspaceId, serviceName), entry)
      return entry
    },
    resolve(workspaceId, serviceName) {
      return services.get(key(workspaceId, serviceName)) || null
    },
    unregister(workspaceId, serviceName) {
      return services.delete(key(workspaceId, serviceName))
    },
    list(workspaceId) {
      return [...services.values()].filter((entry) => !workspaceId || entry.workspaceId === workspaceId)
    },
  }
}

export function createWorkspaceServiceRoutes({ registry, sendJson }) {
  return async function workspaceServiceHandler(_req, res, { body = {}, path: routePath, method }) {
    const segments = String(routePath || '/').split('?')[0].split('/').filter(Boolean)
    if (segments[0] !== 'services') return sendJson(res, 404, { error: 'Unknown workspace service route' })
    if (method === 'GET' && segments.length === 1) {
      const workspaceId = new URL(`http://x${routePath || '/'}`).searchParams.get('workspaceId')
      return sendJson(res, 200, { services: registry.list(workspaceId) })
    }
    if (method === 'GET' && segments.length === 3) {
      const entry = registry.resolve(segments[1], segments[2])
      return entry ? sendJson(res, 200, entry) : sendJson(res, 404, { error: 'Workspace service not found', code: 'SERVICE_NOT_FOUND' })
    }
    if (method === 'PUT' && segments.length === 1) {
      try { return sendJson(res, 200, registry.register(body)) } catch (error) { return sendJson(res, 400, { error: error.message }) }
    }
    if (method === 'DELETE' && segments.length === 3) {
      registry.unregister(segments[1], segments[2])
      return sendJson(res, 204, null)
    }
    return sendJson(res, 405, { error: 'Method not allowed' })
  }
}
