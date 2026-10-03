/**
 * Storyboard terminal session metadata.
 *
 * Hypercanvas PTY owns processes and PTYs. This registry owns product metadata
 * such as branch, canvas, widget, friendly name, archive state, and reconnect
 * generation. It intentionally persists no backend-specific identifiers.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  detachTerminalSession as detachRuntimeSession,
  listRuntimeSessions,
  registerRuntimeSession,
  terminalSessionExists,
  terminateTerminalSession,
  unregisterRuntimeSession,
} from './terminal-runtime.js'

const REGISTRY_DIR = '.storyboard'
const REGISTRY_FILE = 'terminal-sessions.json'
const SESSION_PREFIX = 'sb-'
const sessions = new Map()
const orphanTimers = new Map()
let registryPath = null
let defaultGracePeriod = 5 * 60 * 1000
const defaultBackgroundGracePeriod = 30 * 60 * 1000

const COLORS = [
  'red', 'blue', 'green', 'gold', 'violet', 'coral', 'cyan', 'amber',
  'rose', 'teal', 'plum', 'sage', 'rust', 'jade', 'peach', 'slate',
  'ivory', 'onyx', 'opal', 'ruby', 'moss', 'dusk', 'dawn', 'iron',
]
const BIRDS = [
  'robin', 'falcon', 'wren', 'hawk', 'sparrow', 'crane', 'finch', 'heron',
  'swift', 'lark', 'dove', 'raven', 'osprey', 'thrush', 'egret', 'magpie',
  'condor', 'owl', 'tern', 'kite', 'merlin', 'oriole', 'ibis', 'jay',
]

export function generateFriendlyName() {
  const used = new Set([...sessions.values()].map((entry) => entry.name).filter(Boolean))
  for (let index = 0; index < 100; index += 1) {
    const name = `${COLORS[Math.floor(Math.random() * COLORS.length)]}-${BIRDS[Math.floor(Math.random() * BIRDS.length)]}`
    if (!used.has(name)) return name
  }
  return `session-${Date.now()}`
}

export function findByName(name) {
  return [...sessions.values()].find((entry) => entry.name === name) || null
}

export function generateSessionId(branch, canvasId, widgetId) {
  const hash = createHash('sha256').update(`${branch}::${canvasId}::${widgetId}`).digest('hex').slice(0, 12)
  return `${SESSION_PREFIX}${hash}`
}

function normalizeEntry(entry) {
  const sessionId = entry.sessionId || entry.tmuxName || generateSessionId(
    entry.branch || 'unknown',
    entry.canvasId || 'unknown',
    entry.widgetId || 'unknown',
  )
  return {
    sessionId,
    runtimeSessionId: entry.runtimeSessionId || sessionId,
    name: entry.name || generateFriendlyName(),
    branch: entry.branch || 'unknown',
    canvasId: entry.canvasId || 'unknown',
    widgetId: entry.widgetId || 'unknown',
    createdAt: entry.createdAt || new Date().toISOString(),
    lastConnectedAt: entry.lastConnectedAt || null,
    status: entry.status === 'live' ? 'background' : (entry.status || 'background'),
    expiresAt: entry.expiresAt || null,
    generation: entry.generation || 0,
  }
}

export function initRegistry(root, options = {}) {
  if (options.gracePeriod != null) defaultGracePeriod = options.gracePeriod * 1000
  const dir = join(root, REGISTRY_DIR)
  registryPath = join(dir, REGISTRY_FILE)
  mkdirSync(dir, { recursive: true })
  sessions.clear()
  try {
    for (const persisted of JSON.parse(readFileSync(registryPath, 'utf8'))) {
      const entry = normalizeEntry(persisted)
      sessions.set(entry.sessionId, entry)
      registerRuntimeSession(entry.sessionId, entry.runtimeSessionId)
    }
  } catch { /* first run or corrupt local state */ }
  reconcileRegistry().catch(() => {})
  persist()
}

export async function reconcileRegistry() {
  const registrySnapshot = new Map([...sessions.values()].map((entry) => [entry.sessionId, {
    generation: entry.generation,
    runtimeSessionId: entry.runtimeSessionId,
  }]))
  const runtimeSessions = await listRuntimeSessions()
  const runtimeById = new Map(runtimeSessions.map((entry) => [entry.sessionId, entry]))
  const now = Date.now()
  for (const entry of sessions.values()) {
    const expected = registrySnapshot.get(entry.sessionId)
    if (!expected || expected.generation !== entry.generation || expected.runtimeSessionId !== entry.runtimeSessionId) continue
    const runtimeEntry = runtimeById.get(entry.runtimeSessionId)
    if (!runtimeEntry?.running && entry.status === 'live') entry.status = 'background'
    if (entry.status === 'background' && !entry.expiresAt) {
      entry.expiresAt = now + defaultBackgroundGracePeriod
    }
    if ((entry.status === 'background' || entry.status === 'archived') && entry.expiresAt) {
      if (entry.expiresAt <= now) await removeSession(entry.sessionId)
      else armOrphanTimer(entry.sessionId, entry.expiresAt - now)
    }
  }
  persist()
}

export function registerSession({ branch, canvasId, widgetId, prettyName, runtimeSessionId }) {
  const sessionId = generateSessionId(branch, canvasId, widgetId)
  const existing = sessions.get(sessionId)
  let conflict = null
  if (existing) {
    if (existing.status === 'live' && existing.branch !== branch) {
      conflict = {
        currentBranch: existing.branch,
        currentCanvas: existing.canvasId,
        currentWidget: existing.widgetId,
      }
    }
    cancelOrphanTimer(sessionId)
    Object.assign(existing, {
      branch,
      canvasId,
      widgetId,
      name: prettyName || existing.name,
      runtimeSessionId: runtimeSessionId || existing.runtimeSessionId || sessionId,
      lastConnectedAt: new Date().toISOString(),
      status: 'live',
      expiresAt: null,
      generation: (existing.generation || 0) + 1,
    })
    registerRuntimeSession(sessionId, existing.runtimeSessionId)
    persist()
    return { entry: existing, conflict }
  }
  const entry = {
    sessionId,
    runtimeSessionId: runtimeSessionId || sessionId,
    name: prettyName || generateFriendlyName(),
    branch,
    canvasId,
    widgetId,
    createdAt: new Date().toISOString(),
    lastConnectedAt: new Date().toISOString(),
    status: 'live',
    expiresAt: null,
    generation: 1,
  }
  sessions.set(sessionId, entry)
  registerRuntimeSession(sessionId, entry.runtimeSessionId)
  persist()
  return { entry, conflict }
}

export function adoptRuntimeSession(sessionId, runtimeSessionId) {
  const entry = sessions.get(sessionId)
  if (!entry) return null
  entry.runtimeSessionId = runtimeSessionId
  registerRuntimeSession(sessionId, runtimeSessionId)
  persist()
  return entry
}

export function disconnectSession(sessionId, generation) {
  const entry = sessions.get(sessionId)
  if (!entry || entry.generation !== generation || entry.status !== 'live') return
  entry.status = 'background'
  entry.expiresAt = Date.now() + defaultBackgroundGracePeriod
  persist()
  detachRuntimeSession(sessionId, entry.expiresAt).catch(() => {})
  armOrphanTimer(sessionId, defaultBackgroundGracePeriod)
}

export function orphanSession(sessionId, gracePeriod = defaultGracePeriod) {
  const entry = sessions.get(sessionId)
  if (!entry) return null
  entry.status = 'archived'
  entry.expiresAt = Date.now() + gracePeriod
  entry.generation = (entry.generation || 0) + 1
  persist()
  detachRuntimeSession(sessionId, entry.expiresAt).catch(() => {})
  armOrphanTimer(sessionId, gracePeriod)
  return entry
}

export function orphanSessionByWidget(branch, canvasId, widgetId, gracePeriod) {
  return orphanSession(generateSessionId(branch, canvasId, widgetId), gracePeriod)
}

export function detachSession(sessionId) {
  const entry = sessions.get(sessionId)
  if (!entry) return null
  entry.status = 'background'
  entry.expiresAt = Date.now() + defaultBackgroundGracePeriod
  cancelOrphanTimer(sessionId)
  armOrphanTimer(sessionId, defaultBackgroundGracePeriod)
  persist()
  detachRuntimeSession(sessionId, entry.expiresAt).catch(() => {})
  return entry
}

export async function killSession(sessionId) {
  return removeSession(sessionId)
}

async function removeSession(sessionId) {
  cancelOrphanTimer(sessionId)
  const entry = sessions.get(sessionId)
  if (entry) {
    const runtimeSessions = await listRuntimeSessions()
    if (runtimeSessions.some((runtimeEntry) => runtimeEntry.sessionId === entry.runtimeSessionId)) {
      await terminateTerminalSession(sessionId)
    } else {
      unregisterRuntimeSession(sessionId)
    }
  } else {
    if (await terminalSessionExists(sessionId)) await terminateTerminalSession(sessionId)
    else unregisterRuntimeSession(sessionId)
  }
  const removed = sessions.delete(sessionId)
  persist()
  return removed
}

export async function bulkCleanup({ statuses }) {
  const wanted = new Set(statuses)
  const ids = [...sessions.values()]
    .filter((entry) => wanted.has(entry.status))
    .map((entry) => entry.sessionId)
  await Promise.all(ids.map((sessionId) => removeSession(sessionId)))
  return { removed: ids.length, remaining: getSessionStats() }
}

export function getSessionStats() {
  const stats = { live: 0, background: 0, archived: 0, total: 0 }
  for (const entry of sessions.values()) {
    if (Object.hasOwn(stats, entry.status)) stats[entry.status] += 1
    stats.total += 1
  }
  return stats
}

export function getSession(sessionId) {
  return sessions.get(sessionId) || null
}

export function getSessionByWidget(branch, canvasId, widgetId) {
  return sessions.get(generateSessionId(branch, canvasId, widgetId)) || null
}

export function listSessions(filterBranch = null) {
  const order = { live: 0, background: 1, archived: 2 }
  return [...sessions.values()]
    .filter((entry) => !filterBranch || entry.branch === filterBranch)
    .map((entry) => ({ ...entry }))
    .sort((left, right) => (order[left.status] ?? 3) - (order[right.status] ?? 3))
}

export function findSessionIdForWidget(widgetId) {
  return [...sessions.values()].find((entry) => entry.widgetId === widgetId)?.sessionId || null
}

function persist() {
  if (!registryPath) return
  try { writeFileSync(registryPath, JSON.stringify([...sessions.values()], null, 2)) } catch { /* local durability is best effort */ }
}

function armOrphanTimer(sessionId, delayMs) {
  cancelOrphanTimer(sessionId)
  const timer = setTimeout(() => {
    const entry = sessions.get(sessionId)
    if (!entry || (entry.status !== 'archived' && entry.status !== 'background')) return
    removeSession(sessionId).catch(() => {})
  }, delayMs)
  timer.unref?.()
  orphanTimers.set(sessionId, timer)
}

function cancelOrphanTimer(sessionId) {
  const timer = orphanTimers.get(sessionId)
  if (timer) clearTimeout(timer)
  orphanTimers.delete(sessionId)
}

export function resetRegistryForTests() {
  for (const timer of orphanTimers.values()) clearTimeout(timer)
  orphanTimers.clear()
  sessions.clear()
  registryPath = null
}
