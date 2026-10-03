const AGENT_IDS = new Set(['codex', 'claude', 'copilot', 'opencode'])
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/

export class HostToolsRequestError extends Error {
  constructor(message, { code = 'HOST_TOOLS_REQUEST_FAILED', status = 0 } = {}) {
    super(message)
    this.name = 'HostToolsRequestError'
    this.code = code
    this.status = status
  }
}

export function hostToolsApiBase(basePath = import.meta.env.BASE_URL || '/') {
  const normalized = String(basePath || '/')
    .replace(/^([^/])/, '/$1')
    .replace(/\/+$/, '')
  return `${normalized}/_storyboard/host-tools`
}

function assertResourceId(value, name) {
  if (typeof value !== 'string' || !RESOURCE_ID.test(value)) {
    throw new TypeError(`${name} must be a valid host-tools resource ID`)
  }
}

function assertAgentIds(agentIds) {
  if (
    !Array.isArray(agentIds)
    || new Set(agentIds).size !== agentIds.length
    || agentIds.some((id) => typeof id !== 'string' || !AGENT_IDS.has(id))
  ) {
    throw new TypeError('Agent IDs must be unique values from the host-tools catalog')
  }
}

export function createHostToolsBrowserClient({
  fetchImpl = globalThis.fetch,
  basePath = import.meta.env.BASE_URL || '/',
} = {}) {
  const apiBase = hostToolsApiBase(basePath)

  async function request(path, { method = 'GET', body } = {}) {
    if (typeof fetchImpl !== 'function') throw new HostToolsRequestError('Browser requests are unavailable')
    let response
    try {
      response = await fetchImpl(`${apiBase}${path}`, {
        method,
        ...(body === undefined ? {} : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      })
    } catch {
      throw new HostToolsRequestError('Could not reach the host-tools service')
    }

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      throw new HostToolsRequestError(
        payload?.error?.message || `Host-tools request failed (${response.status})`,
        { code: payload?.error?.code, status: response.status },
      )
    }
    return payload
  }

  return Object.freeze({
    preflight() {
      return request('/preflight')
    },
    plan(agentIds) {
      assertAgentIds(agentIds)
      return request('/plan', { method: 'POST', body: { selectedAgentIds: [...agentIds] } })
    },
    install(planId) {
      assertResourceId(planId, 'Plan ID')
      return request('/install', { method: 'POST', body: { planId, consent: true } })
    },
    operation(operationId) {
      assertResourceId(operationId, 'Operation ID')
      return request(`/operations/${encodeURIComponent(operationId)}`)
    },
    cancel(operationId) {
      assertResourceId(operationId, 'Operation ID')
      return request(`/operations/${encodeURIComponent(operationId)}/cancel`, { method: 'POST', body: {} })
    },
  })
}
