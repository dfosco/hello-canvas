import fs from 'node:fs'
import path from 'node:path'

export const MAX_DIAGNOSTIC_LOG_ENTRIES = 20
const MAX_DIAGNOSTIC_STRING_LENGTH = 2000
const SECRET_KEY = /(?:token|secret|password|credential|authorization|auth(?:entication|_?header)?|api[_-]?key)/i

export function redactDiagnosticText(value) {
  return String(value ?? '')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:access_token|refresh_token|token|password|secret|api[_-]?key)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(["']?)([A-Z0-9_.-]*(?:TOKEN|SECRET|PASSWORD|AUTH(?:ORIZATION|ENTICATION|_HEADER)?|API[_-]?KEY|CREDENTIAL)[A-Z0-9_.-]*)(["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1$2$3[redacted]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,})\b/g, '[redacted]')
    .slice(0, MAX_DIAGNOSTIC_STRING_LENGTH)
}

export function sanitizeDiagnostics(value, key = '', depth = 0) {
  if (SECRET_KEY.test(key)) return '[redacted]'
  if (typeof value === 'string') return redactDiagnosticText(value)
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (depth >= 6) return '[truncated]'
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => sanitizeDiagnostics(entry, '', depth + 1))
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeDiagnostics(entryValue, entryKey, depth + 1),
    ]))
  }
  return String(value)
}

export function readRecentDiagnosticLogs(logsDirectory, { limit = MAX_DIAGNOSTIC_LOG_ENTRIES, now = new Date() } = {}) {
  const boundedLimit = Math.max(0, Math.min(MAX_DIAGNOSTIC_LOG_ENTRIES, Number(limit) || 0))
  if (!boundedLimit || typeof logsDirectory !== 'string') return []
  const filename = `${now.toISOString().slice(0, 10)}.jsonl`
  try {
    const lines = fs.readFileSync(path.join(logsDirectory, filename), 'utf8').split(/\r?\n/).filter(Boolean)
    return lines.slice(-boundedLimit).flatMap((line) => {
      try { return [sanitizeDiagnostics(JSON.parse(line))] } catch { return [] }
    })
  } catch { return [] }
}

export function createDiagnosticsHandler({ getSnapshot, sendJson } = {}) {
  if (typeof getSnapshot !== 'function' || typeof sendJson !== 'function') {
    throw new TypeError('getSnapshot and sendJson are required')
  }
  return async (_request, response, context = {}) => {
    if (context.method !== 'GET') {
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Diagnostics supports GET only.' } })
      return
    }
    try {
      sendJson(response, 200, sanitizeDiagnostics(await getSnapshot()))
    } catch {
      sendJson(response, 503, {
        error: { code: 'DIAGNOSTICS_UNAVAILABLE', message: 'Core diagnostics could not be collected.' },
      })
    }
  }
}
