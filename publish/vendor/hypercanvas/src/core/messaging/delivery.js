/**
 * Optional proactive delivery adapters layered over the durable inbox.
 *
 * Skill-driven `storyboard inbox poll` is the portable baseline. Adapters use
 * the same read/consume functions and never write messages through PTY stdin.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { subscribe } from './bus.js'
import { consumeInbox, formatInboxBatch, readInbox } from './coordination-service.js'
import { inboxChannel } from './hub-manager.js'

const execFileAsync = promisify(execFile)
const bindings = new Map()
const flushTimers = new Map()
let rootDir = ''
let runCommand = execFileAsync
const codexQueueAvailability = new Map()

export function initDeliveryBridge({ root, execute = execFileAsync }) {
  rootDir = root
  runCommand = execute
}

async function detectCodexQueue(command = 'codex') {
  if (codexQueueAvailability.has(command)) return codexQueueAvailability.get(command)
  try {
    await runCommand(command, ['queue', '--help'], { cwd: rootDir, timeout: 5000 })
    codexQueueAvailability.set(command, true)
  } catch {
    codexQueueAvailability.set(command, false)
  }
  return codexQueueAvailability.get(command)
}

export async function supportsRuntimeAdapter(binding) {
  if (binding.adapter?.type !== 'codex-queue' || !binding.threadId) return false
  return detectCodexQueue(binding.adapter.command || 'codex')
}

async function deliverWithAdapter(binding, text) {
  if (!await supportsRuntimeAdapter(binding)) return false
  await runCommand(binding.adapter.command || 'codex', [
    'queue', '--thread', binding.threadId, '--message', text,
  ], { cwd: rootDir, timeout: binding.adapter.timeoutMs || 15_000, maxBuffer: 1024 * 1024 })
  return true
}

/** Optional native Codex delivery. Managed canvas context uses the PTY API. */
export async function deliverRuntimeContext(widgetId, text) {
  const binding = bindings.get(widgetId)
  if (!binding?.threadId) return { status: 'pending', message: 'Waiting for the agent session' }
  if (binding.adapter?.type !== 'codex-queue') return { status: 'unsupported', message: 'This binding has no native queue adapter. Use the terminal context API for managed canvas sessions.' }
  try {
    if (!await deliverWithAdapter(binding, text)) return { status: 'unsupported', message: 'The installed Codex CLI does not support native queue delivery' }
    return { status: 'queued', message: 'Context queued for the current Codex session' }
  } catch (error) {
    return { status: 'error', message: `Context delivery failed: ${error.message}` }
  }
}

function scheduleFlush(widgetId) {
  if (flushTimers.has(widgetId)) return
  const timer = setTimeout(() => {
    flushTimers.delete(widgetId)
    flushWidget(widgetId).catch(() => {})
  }, 100)
  timer.unref?.()
  flushTimers.set(widgetId, timer)
}

export async function flushWidget(widgetId) {
  const binding = bindings.get(widgetId)
  if (!binding || binding.flushing) return { delivered: false, reason: 'not-ready' }
  binding.flushing = true
  try {
    const inbox = await readInbox({ canvasId: binding.canvasId, widgetId, limit: 50 })
    if (!inbox.ok || inbox.items.length === 0) return { delivered: false, reason: 'empty' }
    const text = formatInboxBatch(inbox.items)
    if (!text || !await deliverWithAdapter(binding, text)) return { delivered: false, reason: 'unsupported' }
    const result = await consumeInbox({
      canvasId: binding.canvasId,
      widgetId,
      itemIds: inbox.items.map((item) => item.id),
      consumer: binding.adapter.type,
    })
    return { delivered: true, consumed: result.consumed }
  } catch (error) {
    binding.lastError = error.message
    return { delivered: false, reason: 'failed', error: error.message }
  } finally {
    binding.flushing = false
  }
}

/** Bind an active agent runtime to an optional native context adapter. */
export async function bindWidget({ widgetId, sessionId, branch, canvasId, displayName, runtime = null, threadId = null, adapter = null }) {
  unbindWidget(widgetId)
  const channel = inboxChannel(canvasId, widgetId)
  const binding = {
    widgetId, sessionId, branch, canvasId, displayName: displayName || widgetId,
    runtime, threadId,
    adapter,
    channel, unsub: null, flushing: false, lastError: null,
  }
  binding.unsub = subscribe(channel, (event) => {
    if (event.type === 'inbox:available') scheduleFlush(widgetId)
  })
  bindings.set(widgetId, binding)
  scheduleFlush(widgetId)
  return { channel, proactive: await supportsRuntimeAdapter(binding) }
}

export function unbindWidget(widgetId) {
  const timer = flushTimers.get(widgetId)
  if (timer) clearTimeout(timer)
  flushTimers.delete(widgetId)
  const binding = bindings.get(widgetId)
  binding?.unsub?.()
  bindings.delete(widgetId)
}

export function rebindWidget(widgetId, newSessionId) {
  const binding = bindings.get(widgetId)
  if (binding) binding.sessionId = newSessionId
}

export function updateWidgetAdapter(widgetId, updates = {}) {
  const binding = bindings.get(widgetId)
  if (!binding) return false
  Object.assign(binding, updates)
  scheduleFlush(widgetId)
  return true
}

export function terminalChannel(branch, canvasId, widgetId) {
  return inboxChannel(canvasId, widgetId)
}

export function isBound(widgetId) { return bindings.has(widgetId) }

export function getBinding(widgetId) {
  const binding = bindings.get(widgetId)
  if (!binding) return null
  const serializable = { ...binding }
  delete serializable.unsub
  delete serializable.flushing
  return serializable
}

export function getBindings() {
  return [...bindings.keys()].map(getBinding)
}

export function resetDeliveryBridge() {
  for (const widgetId of [...bindings.keys()]) unbindWidget(widgetId)
  codexQueueAvailability.clear()
  rootDir = ''
  runCommand = execFileAsync
}
