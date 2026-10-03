import { AGENT_IDS } from './catalog.js'
import { createHostToolsInstaller } from './installer.js'
import { preflightHostTools } from './preflight.js'

const AGENT_ID_SET = new Set(AGENT_IDS)
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/

const ERROR_STATUS = Object.freeze({
  INVALID_INPUT: 400,
  INVALID_AGENT_SELECTION: 400,
  INVALID_OPERATION_ID: 400,
  PLAN_NOT_FOUND: 404,
  OPERATION_NOT_FOUND: 404,
  PLAN_ALREADY_USED: 409,
  OPERATION_ACTIVE: 409,
  STALE_PLAN: 409,
  CONSENT_REQUIRED: 422,
  UNSUPPORTED_PLATFORM: 422,
})

function apiError(code, message) {
  return Object.assign(new Error(message), { code })
}

function errorStatus(error) {
  return ERROR_STATUS[error?.code] || 500
}

function sendError(sendJson, res, error) {
  const status = errorStatus(error)
  sendJson(res, status, {
    error: {
      code: error?.code || 'HOST_TOOLS_FAILED',
      message: status === 500 ? 'Host tools request failed' : error.message,
    },
  })
}

function exactObject(value, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw apiError('INVALID_INPUT', 'Expected a JSON object')
  }
  const extra = Object.keys(value).filter((key) => !allowedKeys.includes(key))
  if (extra.length) throw apiError('INVALID_INPUT', `Unsupported request field: ${extra.join(', ')}`)
  return value
}

function planInput(body) {
  const input = exactObject(body, ['selectedAgentIds'])
  if (!Array.isArray(input.selectedAgentIds)) {
    throw apiError('INVALID_AGENT_SELECTION', 'selectedAgentIds must be an array')
  }
  const unique = new Set(input.selectedAgentIds)
  if (
    unique.size !== input.selectedAgentIds.length
    || input.selectedAgentIds.some((id) => typeof id !== 'string' || !AGENT_ID_SET.has(id))
  ) {
    throw apiError('INVALID_AGENT_SELECTION', `selectedAgentIds must contain unique values from: ${AGENT_IDS.join(', ')}`)
  }
  return { selectedAgentIds: [...input.selectedAgentIds] }
}

function installInput(body) {
  const input = exactObject(body, ['planId', 'consent'])
  if (typeof input.planId !== 'string' || !OPERATION_ID_PATTERN.test(input.planId)) {
    throw apiError('INVALID_INPUT', 'planId must be a valid plan ID')
  }
  if (input.consent !== true) throw apiError('CONSENT_REQUIRED', 'Explicit consent is required to install host tools')
  return { planId: input.planId, consent: true }
}

function operationId(value) {
  let decoded
  try {
    decoded = decodeURIComponent(value)
  } catch {
    throw apiError('INVALID_OPERATION_ID', 'operation ID is invalid')
  }
  if (!OPERATION_ID_PATTERN.test(decoded)) throw apiError('INVALID_OPERATION_ID', 'operation ID is invalid')
  return decoded
}

function isLoopback(address) {
  const value = String(address || '').toLowerCase()
  return value === '::1' || value === '127.0.0.1' || value.startsWith('::ffff:127.') || /^127(?:\.\d{1,3}){3}$/.test(value)
}

function requestProtocol(req) {
  const forwarded = req.headers?.['x-forwarded-proto']
  const value = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || '').split(',')[0].trim()
  if (value === 'http' || value === 'https') return value
  return req.socket?.encrypted ? 'https' : 'http'
}

function isLocalHostHeader(value) {
  try {
    const hostname = new URL(`http://${value}`).hostname.toLowerCase()
    return hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname === '127.0.0.1'
      || hostname === '[::1]'
  } catch {
    return false
  }
}

function assertMutationRequest(req) {
  if (!isLoopback(req.socket?.remoteAddress)) {
    throw apiError('LOOPBACK_REQUIRED', 'Host tools mutations are available only from loopback')
  }

  const host = req.headers?.host
  if (typeof host !== 'string' || !isLocalHostHeader(host)) {
    throw apiError('LOCAL_HOST_REQUIRED', 'Host tools mutations require a localhost request host')
  }

  const origin = req.headers?.origin
  if (origin !== undefined) {
    let expected
    try {
      expected = new URL(`${requestProtocol(req)}://${host}`).origin
    } catch {
      expected = null
    }
    let actual
    try {
      actual = typeof origin === 'string' ? new URL(origin).origin : null
    } catch {
      actual = null
    }
    if (!host || actual !== expected || origin !== actual) {
      throw apiError('ORIGIN_MISMATCH', 'Origin must match the request host and protocol')
    }
  }

  const contentType = req.headers?.['content-type']
  const mediaType = typeof contentType === 'string' ? contentType.split(';', 1)[0].trim().toLowerCase() : ''
  if (mediaType !== 'application/json') {
    throw apiError('UNSUPPORTED_MEDIA_TYPE', 'POST requests require application/json')
  }
}

function securityStatus(error) {
  if (error.code === 'LOOPBACK_REQUIRED' || error.code === 'LOCAL_HOST_REQUIRED' || error.code === 'ORIGIN_MISMATCH') return 403
  if (error.code === 'UNSUPPORTED_MEDIA_TYPE') return 415
  return null
}

/**
 * Framework-independent HTTP adapter for host preflight and installation.
 */
export function createHostToolsHandler({
  installer = createHostToolsInstaller(),
  preflight = preflightHostTools,
  sendJson,
} = {}) {
  if (typeof sendJson !== 'function') throw new TypeError('sendJson is required')

  return async function hostToolsHandler(req, res, ctx = {}) {
    const method = ctx.method || req.method || 'GET'
    const path = String(ctx.path || '/').split('?', 1)[0]
    const mutation = method === 'POST'

    try {
      if (mutation) assertMutationRequest(req)

      if (method === 'GET' && path === '/preflight') {
        sendJson(res, 200, await preflight())
        return
      }

      if (method === 'POST' && path === '/plan') {
        sendJson(res, 200, await installer.createPlan(planInput(ctx.body)))
        return
      }

      if (method === 'POST' && path === '/install') {
        sendJson(res, 202, await installer.startInstall(installInput(ctx.body)))
        return
      }

      const statusMatch = path.match(/^\/operations\/([^/]+)$/)
      if (method === 'GET' && statusMatch) {
        const operation = installer.getOperation(operationId(statusMatch[1]))
        if (!operation) throw apiError('OPERATION_NOT_FOUND', 'Installation operation was not found')
        sendJson(res, 200, operation)
        return
      }

      const cancelMatch = path.match(/^\/operations\/([^/]+)\/cancel$/)
      if (method === 'POST' && cancelMatch) {
        exactObject(ctx.body, [])
        sendJson(res, 200, installer.cancelOperation(operationId(cancelMatch[1])))
        return
      }

      sendJson(res, 404, { error: { code: 'ROUTE_NOT_FOUND', message: `Unknown host tools route: ${method} ${path}` } })
    } catch (error) {
      const status = securityStatus(error)
      if (status) {
        sendJson(res, status, { error: { code: error.code, message: error.message } })
        return
      }
      sendError(sendJson, res, error)
    }
  }
}
