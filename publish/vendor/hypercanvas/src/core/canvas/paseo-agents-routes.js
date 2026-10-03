/**
 * Paseo Agents API routes — mounted at /_storyboard/paseo-agents/.
 *
 * Same-origin proxy in front of the Paseo daemon so daemon credentials never
 * reach the browser. All route inputs are validated before hitting the SDK.
 *
 * Routes:
 *   GET  /health            — runtime + connection diagnostics
 *   GET  /providers         — available providers (pre-launch picker)
 *   GET  /providers/models  — models for ?provider=
 *   GET  /agents            — list agents (optional ?subscribe=1)
 *   GET  /agents/:id        — refresh + fetch one agent snapshot
 *   POST /agents            — create agent { config: { provider, model, ... }, title, context: { workspaceId } }
 *   POST /agents/:id/send   — send message { text, messageId }
 *   POST /agents/:id/cancel — interrupt the active turn
 *   POST /agents/:id/permission — respond { requestId, response: { behavior, ... } }
 *   POST /agents/:id/timeline   — refetch timeline { direction, cursor, limit, projection }
 *   POST /agents/:id/archive    — archive agent
 *
 * Agent/timeline events reach the browser via the Vite custom HMR event
 * `storyboard:paseo-agent-event` (see paseo-agent-runtime.js).
 */

import { getPaseoAgentRuntime, MAX_TEXT_LENGTH } from './paseo-agent-runtime.js'
import { getPaseoConnectionDiagnostics } from './paseo-runtime-client.js'

const UUID_LIKE = /^[A-Za-z0-9_-]{1,128}$/

function safeId(value) {
  if (typeof value !== 'string' || !UUID_LIKE.test(value)) return null
  return value
}

function sendErr(sendJson, res, status, message, code) {
  sendJson(res, status, { error: message, ...(code ? { code } : {}) })
}

export function createPaseoAgentsHandler(ctx) {
  const { root, sendJson, wsSend, workspaceIdResolver } = ctx

  async function requireRuntime(res) {
    const runtime = await getPaseoAgentRuntime({ root, wsSend, workspaceIdResolver })
    if (!runtime) {
      const diagnostics = getPaseoConnectionDiagnostics()
      if (diagnostics.lastError && !diagnostics.lastError.includes('Paseo SDK is unavailable')) {
        sendJson(res, 503, {
          error: diagnostics.lastError,
          code: 'DAEMON_UNAVAILABLE',
          diagnostics,
        })
      } else {
        sendJson(res, 503, {
          error: diagnostics.lastError || 'Paseo SDK unavailable. Install @getpaseo/client@0.8.0-beta.1.',
          code: 'SDK_UNAVAILABLE',
          diagnostics,
        })
      }
      return null
    }
    return runtime
  }

  return async function paseoAgentsHandler(req, res, { body = {}, path, method }) {
    // Path arrives without the /paseo-agents prefix (e.g. '/agents/xyz/send')
    // and may carry a query string.
    const parsedPath = new URL(`http://x${path || '/'}`, 'http://x')
    const query = parsedPath.searchParams
    const segments = parsedPath.pathname.split('/').filter(Boolean)
    const [head, id, action] = segments
    const agentId = safeId(id)

    try {
      if (head === 'health' && method === 'GET') {
        const runtime = await requireRuntime(res)
        if (!runtime) return
        return sendJson(res, 200, await runtime.health())
      }

      if (head === 'providers') {
        if (method !== 'GET') return sendErr(sendJson, res, 405, 'Method not allowed')
        const runtime = await requireRuntime(res)
        if (!runtime) return
        if (id === 'models') {
          const provider = query.get('provider')
          if (!provider) return sendErr(sendJson, res, 400, 'provider query param is required')
          return sendJson(res, 200, await runtime.listModels(provider))
        }
        return sendJson(res, 200, await runtime.listAvailableProviders())
      }

      if (head === 'agents') {
        if (method === 'GET' && !agentId) {
          const runtime = await requireRuntime(res)
          if (!runtime) return
          const subscribe = query.get('subscribe') === '1'
          const result = await runtime.listAgents({ subscribe })
          return sendJson(res, 200, { entries: result.entries || [], pageInfo: result.pageInfo || null })
        }
        if (method === 'POST' && !agentId && !action) {
          const runtime = await requireRuntime(res)
          if (!runtime) return
          const { config, title, context } = body
          if (!config || typeof config !== 'object' || !config.provider) {
            return sendErr(sendJson, res, 400, 'config.provider is required')
          }
          if (context !== undefined && (typeof context !== 'object' || context === null || Array.isArray(context))) {
            return sendErr(sendJson, res, 400, 'context must be an object when provided')
          }
          if (context?.widgetId !== undefined && (typeof context.widgetId !== 'string' || !safeId(context.widgetId))) {
            return sendErr(sendJson, res, 400, 'context.widgetId must be a valid widget id')
          }
          if (context?.workspaceId !== undefined && (typeof context.workspaceId !== 'string' || !safeId(context.workspaceId))) {
            return sendErr(sendJson, res, 400, 'context.workspaceId must be a valid workspace id')
          }
          const workspaceId = await runtime.resolveWorkspaceId()
          if (!workspaceId) return sendErr(sendJson, res, 400, 'The active Notebook has no Paseo workspace', 'WORKSPACE_REQUIRED')
          if (context?.workspaceId && context.workspaceId !== workspaceId) {
            return sendErr(sendJson, res, 409, 'context.workspaceId does not match the active Notebook', 'WORKSPACE_MISMATCH')
          }
          const result = await runtime.createAgent({
            config,
            ...(title !== undefined ? { title } : {}),
            context: { ...(context || {}), workspaceId },
          })
          return sendJson(res, 200, result)
        }
        if (!agentId) return sendErr(sendJson, res, 400, 'Invalid agent id', 'BAD_AGENT_ID')

        if (method === 'GET' && !action) {
          const runtime = await requireRuntime(res)
          if (!runtime) return
          return sendJson(res, 200, await runtime.getAgent(agentId))
        }
        if (method === 'POST' && action) {
          const runtime = await requireRuntime(res)
          if (!runtime) return
          if (action === 'send') {
            const { text, messageId } = body
            if (typeof text !== 'string' || !text.trim()) {
              return sendErr(sendJson, res, 400, 'text is required')
            }
            if (text.length > MAX_TEXT_LENGTH) {
              return sendErr(sendJson, res, 413, `text exceeds ${MAX_TEXT_LENGTH} characters`)
            }
            if (messageId != null && typeof messageId !== 'string') {
              return sendErr(sendJson, res, 400, 'messageId must be a string')
            }
            return sendJson(res, 200, await runtime.sendMessage(agentId, text, { messageId }))
          }
          if (action === 'cancel') {
            return sendJson(res, 200, await runtime.cancelTurn(agentId))
          }
          if (action === 'permission') {
            const { requestId, response } = body
            if (typeof requestId !== 'string' || !requestId) {
              return sendErr(sendJson, res, 400, 'requestId is required')
            }
            if (!response || typeof response !== 'object') {
              return sendErr(sendJson, res, 400, 'response is required')
            }
            return sendJson(res, 200, await runtime.respondToPermission(agentId, { requestId, response }))
          }
          if (action === 'timeline') {
            const { direction, cursor, limit, projection } = body
            if (direction && !['tail', 'before', 'after'].includes(direction)) {
              return sendErr(sendJson, res, 400, 'direction must be tail, before, or after')
            }
            if (projection && !['projected', 'canonical'].includes(projection)) {
              return sendErr(sendJson, res, 400, 'projection must be projected or canonical')
            }
            if (cursor && (typeof cursor !== 'object' || typeof cursor.epoch !== 'string' || !Number.isFinite(cursor.seq))) {
              return sendErr(sendJson, res, 400, 'cursor must be { epoch: string, seq: number }')
            }
            return sendJson(res, 200, await runtime.fetchTimeline(agentId, { direction, cursor, limit, projection }))
          }
          if (action === 'archive') {
            return sendJson(res, 200, await runtime.archiveAgent(agentId))
          }
          return sendErr(sendJson, res, 404, `Unknown action: ${action}`)
        }
        return sendErr(sendJson, res, 405, 'Method not allowed')
      }

      return sendErr(sendJson, res, 404, `Unknown paseo-agents route: ${path}`)
    } catch (error) {
      const message = error?.message || 'Paseo agents request failed'
      // Connection-level failures surface as 503 so the client store can
      // show a recoverable daemon-unavailable state instead of a generic 500.
      const diagnostics = getPaseoConnectionDiagnostics()
      if (
        error?.code === 'PASEO_UNAVAILABLE'
        || ['connecting', 'disconnected', 'disposed'].includes(diagnostics.status)
        || /ECONNREFUSED|transport not connected|connection (?:lost|closed|refused|timed out)/i.test(message)
      ) {
        return sendJson(res, 503, {
          error: 'Paseo daemon is unavailable; Hypercanvas will reconnect automatically when it returns.',
          code: 'DAEMON_UNAVAILABLE',
          diagnostics,
        })
      }
      return sendErr(sendJson, res, 500, message)
    }
  }
}
