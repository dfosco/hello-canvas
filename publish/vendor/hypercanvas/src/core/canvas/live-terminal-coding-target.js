import { initTerminalConfig, readTerminalConfigById, updateTerminalCodingContext } from './terminal-config.js'
import { resolveTerminalCodingTargets, selectTerminalCodingTarget, validateBoundCodingTarget } from './terminal-coding-target.js'
import { terminalContextPrompt, writeTerminalContext } from './terminal-context.js'
import { findSessionIdForWidget } from './terminal-registry.js'
import { submitTerminalText } from './terminal-runtime.js'

// Readiness is process-local. A Core restart cannot trust a persisted ready flag.
const launches = new Map()
const deliveries = new Map()
const keyFor = (root, widgetId) => `${root}\0${widgetId}`
const notifyDefault = (widgetId, state) => import('./terminal-server.js').then(module => module.notifyTerminalContext(widgetId, state)).catch(() => {})

function persist(root, widgetId, update, notify) {
  initTerminalConfig(root)
  const config = updateTerminalCodingContext(widgetId, update)
  if (config) notify(widgetId, config.contextState)
  return config
}

export function startTerminalContext(root, widgetId, { launchId, revision, interactive = true }, { notify = notifyDefault } = {}) {
  if (typeof interactive !== 'boolean') throw new Error('interactive must be a boolean')
  if (typeof launchId !== 'string' || !/^[a-f0-9-]{36}$/.test(launchId)) throw new Error('Invalid managed launch identity')
  initTerminalConfig(root)
  const config = readTerminalConfigById(widgetId)
  if (!config || config.contextRevision !== revision) throw new Error('Startup context changed; prepare the launch again')
  launches.set(keyFor(root, widgetId), { launchId, ready: false, interactive, revisions: new Set([revision]) })
  return persist(root, widgetId, () => ({ contextState: {
    revision, launchId, delivery: 'pending', phase: 'starting', targetStatus: 'available',
    target: config.codingTarget || null, candidates: resolveTerminalCodingTargets(root, config),
    message: 'Waiting for the primary agent to read startup context',
  } }), notify)?.contextState
}

export function stopTerminalContext(root, widgetId, launchId, { notify = notifyDefault } = {}) {
  initTerminalConfig(root)
  const key = keyFor(root, widgetId)
  const launch = launches.get(key)
  if (launchId && launch?.launchId !== launchId) return readTerminalConfigById(widgetId)?.contextState
  launches.delete(key)
  return persist(root, widgetId, current => ({ contextState: {
    ...current.contextState, phase: 'stopped', message: 'Agent process is stopped; context will be loaded at its next start',
  } }), notify)?.contextState
}

/** Explicit graph changes retarget. Same-Site bindings retain their pinned root. */
export async function refreshLiveCodingTarget(root, widgetId, { notify = notifyDefault, submit = submitTerminalText, sessionFor = findSessionIdForWidget, retry = false } = {}) {
  initTerminalConfig(root)
  let config = readTerminalConfigById(widgetId)
  if (!config) return null
  let launch = launches.get(keyFor(root, widgetId))
  if (launch && config.contextState?.phase === 'stopped') {
    launches.delete(keyFor(root, widgetId))
    launch = null
  }
  const candidates = resolveTerminalCodingTargets(root, config)
  let target = config.codingTarget || null
  let targetStatus = 'available', message = null
  // A stopped session's saved target belongs to its native ID. Preferences can
  // change now, but binding happens on the next fresh launch or explicit resume.
  if (launch) {
    let selection = config.widgetProps?.codingTargetSiteId
    if (selection && !candidates.some(candidate => candidate.siteId === selection)) selection = null
    try {
      const pinnedCandidates = candidates.map(candidate => candidate.siteId === target?.siteId
        ? { ...candidate, root: target.root, error: null } : candidate)
      const selected = selectTerminalCodingTarget(pinnedCandidates, selection)
      target = validateBoundCodingTarget(selected)
    } catch (error) {
      targetStatus = error.code === 'CODING_TARGET_REQUIRED' ? 'selection-required' : 'unavailable'
      message = error.message
    }
    config = updateTerminalCodingContext(widgetId, current => ({
      codingTarget: target,
      ...(launch.ready && current.lastAgentSessionId ? { lastAgentCodingTarget: target } : {}),
    }))
  }
  const context = writeTerminalContext(root, config, { targetState: targetStatus })
  if (config.contextState?.revision !== context.revision) {
    config = persist(root, widgetId, current => ({ contextState: {
      ...current.contextState, revision: context.revision, target, candidates, targetStatus,
      delivery: 'pending', message: message || 'Context update pending',
    } }), notify)
  }
  if (!launch && config.contextState?.phase === 'ready') {
    config = persist(root, widgetId, current => ({ contextState: {
      ...current.contextState, phase: 'unverified', delivery: 'pending',
      message: 'Managed readiness is unknown after a Core restart; restart the agent to load current context',
    } }), notify)
  }
  if (!launch?.ready || !launch.interactive) return config.contextState
  if (deliveries.has(keyFor(root, widgetId))) return deliveries.get(keyFor(root, widgetId))
  const state = config.contextState
  if (!retry && ['submitted', 'acknowledged', 'error'].includes(state?.delivery)) return state
  // At most one unacknowledged PTY message per managed process; newer changes
  // coalesce on disk until that message has been read.
  if (launch.inFlight && !retry) return state
  const operation = (async () => {
    const sessionId = sessionFor(widgetId)
    try {
      if (!sessionId) throw new Error('No live PTY is registered for this widget')
      if (launches.get(keyFor(root, widgetId)) !== launch || !launch.ready) return state
      launch.revisions.add(context.revision)
      launch.inFlight = context.revision
      await submit(sessionId, terminalContextPrompt(context, launch.launchId), { submit: true, paste: true, canWrite: () => {
        initTerminalConfig(root)
        return launches.get(keyFor(root, widgetId)) === launch && readTerminalConfigById(widgetId)?.contextState?.phase !== 'stopped'
      } })
      if (launches.get(keyFor(root, widgetId)) !== launch) return readTerminalConfigById(widgetId)?.contextState
      return persist(root, widgetId, current => current.contextState?.revision === context.revision && current.contextState?.acknowledgedRevision !== context.revision ? ({ contextState: {
        ...current.contextState, delivery: 'submitted', phase: 'ready',
        message: 'Submitted to the PTY; waiting for agent acknowledgement',
      } }) : {}, notify)?.contextState
    } catch (error) {
      if (launches.get(keyFor(root, widgetId)) !== launch) return readTerminalConfigById(widgetId)?.contextState
      launch.inFlight = null
      return persist(root, widgetId, current => ({ contextState: {
        ...current.contextState, delivery: 'error', message: error.message,
      } }), notify)?.contextState
    }
  })()
  const key = keyFor(root, widgetId)
  deliveries.set(key, operation)
  try { return await operation } finally { deliveries.delete(key) }
}

export async function acknowledgeTerminalContext(root, widgetId, { launchId, revision }, options = {}) {
  initTerminalConfig(root)
  const launch = launches.get(keyFor(root, widgetId))
  if (!launch || launch.launchId !== launchId || !launch.revisions.has(revision)) throw new Error('Context acknowledgement does not belong to this managed launch')
  launch.ready = true
  if (launch.inFlight === revision) launch.inFlight = null
  const config = persist(root, widgetId, current => ({ contextState: {
    ...current.contextState, phase: 'ready', acknowledgedRevision: revision,
    ...(current.contextState?.revision === revision ? { delivery: 'acknowledged', message: 'Primary agent acknowledged this context' } : {}),
  } }), options.notify || notifyDefault)
  // A change may have arrived during startup or a previous submission.
  if (config.contextState?.revision !== revision) return refreshLiveCodingTarget(root, widgetId, options)
  return config.contextState
}
