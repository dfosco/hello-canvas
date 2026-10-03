/**
 * Agent Chat Transport — same-origin fetch wrapper for /_storyboard/paseo-agents.
 *
 * All daemon credentials stay server-side. This module only talks to
 * same-origin Storyboard routes. Injectable for tests.
 */

function base() {
  return (import.meta.env?.BASE_URL || '/').replace(/\/$/, '')
}

async function request(path, { method = 'GET', body } = {}) {
  const url = `${base()}/_storyboard/paseo-agents${path}`
  const opts = { method, headers: {}, credentials: 'same-origin' }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(url, opts)
  const json = await res.json().catch(() => null)
  if (!res.ok || json?.error) {
    const err = new Error(json?.error || `Request failed (${res.status})`)
    err.status = res.status
    err.code = json?.code || null
    throw err
  }
  return json
}

export const agentChatTransport = {
  health() { return request('/health') },
  listAvailableProviders() { return request('/providers') },
  listModels(provider) { return request(`/providers/models?provider=${encodeURIComponent(provider)}`) },
  createAgent(config, title, context) {
    return request('/agents', {
      method: 'POST',
      body: { config, title, ...(context ? { context } : {}) },
    })
  },
  getAgent(agentId) { return request(`/agents/${encodeURIComponent(agentId)}`) },
  listAgents() { return request('/agents') },
  sendMessage(agentId, text, clientMessageId) {
    return request(`/agents/${encodeURIComponent(agentId)}/send`, {
      method: 'POST',
      body: { text, messageId: clientMessageId },
    })
  },
  cancelTurn(agentId) {
    return request(`/agents/${encodeURIComponent(agentId)}/cancel`, { method: 'POST' })
  },
  respondToPermission(agentId, requestId, response) {
    return request(`/agents/${encodeURIComponent(agentId)}/permission`, {
      method: 'POST',
      body: { requestId, response },
    })
  },
  fetchTimeline(agentId, { direction, cursor, limit, projection } = {}) {
    return request(`/agents/${encodeURIComponent(agentId)}/timeline`, {
      method: 'POST',
      body: { direction, cursor, limit, projection },
    })
  },
  archiveAgent(agentId) {
    return request(`/agents/${encodeURIComponent(agentId)}/archive`, { method: 'POST' })
  },
}
