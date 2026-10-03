/**
 * Terminal Config — per-terminal context files for agent awareness.
 *
 * Each terminal widget gets a config at `.storyboard/terminals/{hash}.json`
 * that agents read on startup to understand their canvas context.
 *
 * Files are keyed by a stable widget identity hash so renames do not break them.
 * The canvasId/widgetId are stored inside the JSON payload.
 *
 * Connected widget props are refreshed from materialized canvas state on edits.
 * Versioned snapshots make startup and live delivery inspectable.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, symlinkSync, unlinkSync, readdirSync, lstatSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { readCurrentViewport } from './selectedWidgets.js'

const TERMINALS_DIR = '.storyboard/terminals'

let rootDir = null

/** Initialize with the project root directory */
export function initTerminalConfig(root) {
  if (!root) {
    const error = new Error('No active Notebook is configured for terminal state.')
    error.code = 'NO_ACTIVE_NOTEBOOK'
    throw error
  }
  rootDir = root
  const dir = join(rootDir, TERMINALS_DIR)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/** Read storyboard.config.json for the dev domain (sourced from repository.name) */
function readDevDomain() {
  if (!rootDir) return 'storyboard'
  try {
    const raw = readFileSync(join(rootDir, 'storyboard.config.json'), 'utf8')
    return JSON.parse(raw).repository?.name || 'storyboard'
  } catch { return 'storyboard' }
}

/** Detect worktree name */
function getWorktreeName() {
  if (!rootDir) return 'main'
  try {
    // Check if we're in a worktrees/ directory
    const cwd = rootDir
    const match = cwd.match(/worktrees\/([^/]+)/)
    return match ? match[1] : 'main'
  } catch { return 'main' }
}

/** Generate a stable filename from branch + canvasId + widgetId */
function configKey(branch, canvasId, widgetId) {
  const input = `${branch}::${canvasId}::${widgetId}`
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

/** Public accessor for the per-widget key (used by agent-session capture). */
export function getConfigKey(branch, canvasId, widgetId) {
  return configKey(branch, canvasId, widgetId)
}

/** Get the config file path */
function configPath(branch, canvasId, widgetId) {
  if (!rootDir) throw new Error('No active Notebook is configured for terminal state.')
  return join(rootDir, TERMINALS_DIR, `${configKey(branch, canvasId, widgetId)}.json`)
}

/** Atomic write — write to temp then rename */
function atomicWrite(filePath, data) {
  const tmp = `${filePath}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, filePath)
}

/**
 * Pre-reserve terminal identity at widget creation time.
 * Called from POST /widget when a terminal/agent widget is added to the canvas,
 * BEFORE the widget renders or the WebSocket connects.
 *
 * Writes a minimal config file at `.storyboard/terminals/{widgetId}.json` so
 * agents (especially hot-pool sessions) can find their identity immediately.
 * The `reserved` flag marks this as a pre-reserve — writeTerminalConfig() will
 * later overwrite it with the full config.
 */
export function preReserveTerminalIdentity({ widgetId, preDisplayName, canvasId, branch, serverUrl, workspaceId = null, widgetProps = null }) {
  const dir = join(rootDir, TERMINALS_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const fp = join(dir, `${widgetId}.json`)
  const data = {
    widgetId,
    preDisplayName,
    displayName: preDisplayName,
    canvasId,
    branch,
    serverUrl: serverUrl || null,
    workspaceId: workspaceId || null,
    widgetProps: widgetProps || null,
    reserved: true,
    connectedWidgets: [],
    messaging: null,
    role: null,
    hubs: [],
    agentStatus: null,
    viewport: readCurrentViewport(rootDir) || null,
    updatedAt: new Date().toISOString(),
  }
  atomicWrite(fp, data)
}

/**
 * Write or update a terminal config file.
 * Called when a terminal widget is created or reconnected.
 */
export function writeTerminalConfig({ branch, canvasId, widgetId, canvasFile = null, serverUrl = null, workspaceId = null, sessionId = null, widgetProps = null, displayName = null }) {
  const fp = configPath(branch, canvasId, widgetId)
  const dir = dirname(fp)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  let existing = {}
  try {
    existing = JSON.parse(readFileSync(fp, 'utf8'))
  } catch {
    // Core can have a different branch from the active Notebook. Widget
    // identity already exists before the PTY and owns its live context.
    const reserved = readTerminalConfigById(widgetId)
    if (reserved?.canvasId === canvasId) existing = reserved
  }

  const worktree = getWorktreeName()
  const devDomain = readDevDomain()

  // The active Hypercanvas server is the only valid default. Consumers that
  // need a different workspace must pass its resolved service URL explicitly.
  if (!serverUrl) serverUrl = process.env.STORYBOARD_SERVER_URL || 'http://localhost:1234'

  const config = {
    ...existing,
    widgetId,
    displayName: displayName || existing.displayName || widgetProps?.alias || widgetProps?.prettyName || existing.widgetProps?.prettyName || null,
    canvasId,
    canvasFile: canvasFile || existing.canvasFile || null,
    branch,
    worktree,
    devDomain,
    serverUrl,
    workspaceId: workspaceId || existing.workspaceId || null,
    sessionId: sessionId || existing.sessionId || null,
    workingDirectory: rootDir,
    reserved: false,
    deleted: false,
    widgetProps: widgetProps || existing.widgetProps || null,
    connectedWidgets: existing.connectedWidgets || [],
    agentStatus: existing.agentStatus || null,
    role: existing.role || null,
    hubs: existing.hubs || [],
    viewport: readCurrentViewport(rootDir) || existing.viewport || null,
    updatedAt: new Date().toISOString(),
  }

  atomicWrite(fp, config)

  // Create a widgetId-named symlink so agents can find their config directly
  const hashName = `${configKey(branch, canvasId, widgetId)}.json`
  const symPath = join(dir, `${widgetId}.json`)
  try {
    if (existsSync(symPath)) unlinkSync(symPath)
    symlinkSync(hashName, symPath)
  } catch { /* symlink creation is best-effort */ }

  // Create a session-named symlink for process-level identity lookup.
  if (sessionId) {
    const sessionSymPath = join(dir, `${sessionId}.json`)
    try {
      if (existsSync(sessionSymPath)) unlinkSync(sessionSymPath)
      symlinkSync(hashName, sessionSymPath)
    } catch { /* best-effort */ }
  }

  return config
}

/**
 * Update connected widgets for a terminal.
 * Called when connectors are added/removed.
 * Stores full widget objects (id, type, props, position) so agents
 * can read context directly without additional API calls.
 */
export function updateTerminalConnections({
  branch,
  canvasId,
  widgetId,
  connectedWidgets,
  widgetProps = null,
  messaging = null,
  role = null,
  hubs = null,
}) {
  const live = readTerminalConfigById(widgetId)
  const fp = live?.reserved && live.canvasId === canvasId
    ? join(rootDir, TERMINALS_DIR, `${widgetId}.json`)
    : configPath(live?.canvasId === canvasId ? live.branch || branch : branch, canvasId, widgetId)
  let config = {}
  try {
    config = JSON.parse(readFileSync(fp, 'utf8'))
  } catch { /* file may not exist yet */ }

  if (widgetProps) {
    config.widgetProps = widgetProps
    // Promote displayName: alias > prettyName
    if (widgetProps.alias) config.displayName = widgetProps.alias
    else if (widgetProps.prettyName) config.displayName = widgetProps.prettyName
  }
  config.connectedWidgets = connectedWidgets || []
  config.messaging = messaging || null
  if (role !== null) config.role = role
  if (hubs !== null) config.hubs = hubs
  config.viewport = readCurrentViewport(rootDir) || config.viewport || null
  config.updatedAt = new Date().toISOString()

  atomicWrite(fp, config)
  return config
}

/**
 * Mark a terminal config as deleted (tombstone).
 * Called when a terminal widget is deleted.
 */
export function markTerminalDeleted({ branch, canvasId, widgetId }) {
  const fp = configPath(branch, canvasId, widgetId)
  try {
    const config = JSON.parse(readFileSync(fp, 'utf8'))
    config.deleted = true
    config.updatedAt = new Date().toISOString()
    atomicWrite(fp, config)
  } catch { /* file may not exist */ }
}

/**
 * Unmark a terminal config as deleted (undo).
 * Called when a deleted terminal widget is restored.
 */
export function unmarkTerminalDeleted({ branch, canvasId, widgetId }) {
  const fp = configPath(branch, canvasId, widgetId)
  try {
    const config = JSON.parse(readFileSync(fp, 'utf8'))
    config.deleted = false
    config.updatedAt = new Date().toISOString()
    atomicWrite(fp, config)
  } catch { /* file may not exist */ }
}

/**
 * Record the Paseo agent id backing an agent-chat widget so server-side
 * lookups (canvas agent lists, agent status) can resolve widget → agent.
 * Called when the browser creates or resumes an agent for the widget.
 */
export function recordWidgetAgentBinding({ widgetId, agentId }) {
  const config = readTerminalConfigById(widgetId)
  if (!config) return null
  config.widgetProps = { ...(config.widgetProps || {}), agentId }
  if (agentId) {
    config.lastAgentId = agentId
    config.lastAgentBoundAt = new Date().toISOString()
  }
  config.updatedAt = new Date().toISOString()
  const fp = configPath(config.branch || 'unknown', config.canvasId || 'unknown', widgetId)
  try {
    atomicWrite(fp, config)
  } catch { /* best-effort */ }
  return config
}

/**
 * Build the Hub bootstrap prompt for a widget joining one or more Hubs.
 * Shared by terminal PTY sessions (prepareTerminalFiles) and Paseo agent
 * chats (initial prompt injection at create time).
 */
export function buildHubBootstrapPrompt(terminalConfig, widgetId, agentProfile = 'terminal-agent') {
  const hubs = Array.isArray(terminalConfig?.hubs) ? terminalConfig.hubs : []
  if (!hubs.length) return null
  const labels = hubs.map((hub) => `${hub.hubId || 'unknown'}${hub.role ? ` (${hub.role})` : ''}`).join(', ')
  return [
    'You are joining a Storyboard Hub.',
    `Your widget id is ${widgetId}; current Hub membership: ${labels}.`,
    `Before doing any work, read '.agents/${agentProfile}.agent.md' when it exists, then run 'storyboard hub context', 'storyboard hub agents', and 'storyboard inbox poll'.`,
    'Every primary terminal agent explicitly loads shared canvas guidance at startup. Native profiles and optional custom subagents supplement it; the durable inbox remains authoritative for Hub state.',
    'The durable inbox is authoritative. Poll it between meaningful tool calls and act on requests or context updates you find there.',
    'Do not wait for a user to repeat the Hub objective; retrieve it from the Hub commands and inbox.',
  ].join('\n')
}

/**
 * Read a terminal config. Connected widgets are already inline —
 * no additional resolution needed.
 */
export function readTerminalConfig({ branch, canvasId, widgetId }) {
  const fp = configPath(branch, canvasId, widgetId)
  try {
    return JSON.parse(readFileSync(fp, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Update agent status in the terminal config.
 * Called by the signal endpoint.
 */
export function updateAgentStatus({ branch, canvasId, widgetId, status, message = null, data = null }) {
  const fp = configPath(branch, canvasId, widgetId)
  let config = {}
  try {
    config = JSON.parse(readFileSync(fp, 'utf8'))
  } catch { /* may not exist */ }

  config.agentStatus = {
    status,
    message,
    data,
    updatedAt: new Date().toISOString(),
  }
  config.updatedAt = new Date().toISOString()

  atomicWrite(fp, config)
  return config
}

/**
 * Read a terminal config by widget ID (searches by symlink).
 * @param {string} widgetId
 * @returns {Object|null}
 */
export function readTerminalConfigById(widgetId) {
  const dir = join(rootDir, TERMINALS_DIR)
  const symPath = join(dir, `${widgetId}.json`)
  try {
    return JSON.parse(readFileSync(symPath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * List storyboard-spawned agent sessions on a canvas.
 *
 * Scans `.storyboard/terminals/` for widget configs whose id starts with
 * `agent-` and matches the requested canvasId/branch. External agents
 * (running in a user's CLI / VS Code on the same repo) never write
 * to this directory, so they're excluded by construction.
 *
 * @param {{ branch?: string|null, canvasId: string }} args
 * @returns {Array<object>}
 */
export function listAgentsForCanvas({ branch = null, canvasId }) {
  if (!canvasId) return []
  const dir = join(rootDir, TERMINALS_DIR)
  if (!existsSync(dir)) return []
  let entries = []
  try {
    entries = readdirSync(dir)
      .filter((name) => name.endsWith('.json') && name.startsWith('agent-'))
      .filter((name) => {
        try { return lstatSync(join(dir, name)).isSymbolicLink() } catch { return true }
      })
  } catch { /* fall through */ }
  const out = []
  for (const name of entries) {
    const widgetId = name.replace(/\.json$/, '')
    let cfg = null
    try { cfg = JSON.parse(readFileSync(join(dir, name), 'utf8')) } catch { continue }
    if (!cfg) continue
    if (cfg.deleted) continue
    if (cfg.canvasId !== canvasId) continue
    if (branch && cfg.branch && cfg.branch !== branch) continue
    out.push({
      widgetId: cfg.widgetId || widgetId,
      canvasId: cfg.canvasId,
      branch: cfg.branch || null,
      worktree: cfg.worktree || null,
      displayName: cfg.displayName || null,
      agentId: cfg.widgetProps?.agentId || null,
      sessionId: cfg.sessionId || null,
      status: cfg.agentStatus?.status || 'idle',
      message: cfg.agentStatus?.message || null,
      statusUpdatedAt: cfg.agentStatus?.updatedAt || null,
      updatedAt: cfg.updatedAt || null,
    })
  }
  out.sort((a, b) => (b.statusUpdatedAt || b.updatedAt || '').localeCompare(a.statusUpdatedAt || a.updatedAt || ''))
  return out
}

/**
 * Save the latest output from an agent for peers to read.
 * @param {string} widgetId
 * @param {{ content: string, summary: string, updatedAt: string }} output
 */
export function updateLatestOutput(widgetId, output) {
  const config = readTerminalConfigById(widgetId)
  if (!config) return

  config.latestOutput = output
  config.updatedAt = new Date().toISOString()

  const fp = configPath(config.branch || 'unknown', config.canvasId || 'unknown', widgetId)
  atomicWrite(fp, config)
}

/**
 * Persist the captured agent CLI session id for a widget so the next
 * cold start can resume it instead of launching fresh.
 *
 * Called by the agent-session watcher after the SessionStart hook fires.
 */
export function recordAgentSession({ branch, canvasId, widgetId, agentId, sessionId }) {
  if (!sessionId) return null
  const fp = configPath(branch, canvasId, widgetId)
  let config = {}
  try { config = JSON.parse(readFileSync(fp, 'utf8')) } catch { /* may not exist */ }
  config.lastAgentSessionId = sessionId
  config.lastAgentSessionAt = new Date().toISOString()
  // Snapshot the target alongside the native ID. Connector updates only change
  // live context; they must not redirect a resumed coding session.
  config.lastAgentCodingTarget = config.codingTarget ?? null
  if (agentId) config.lastAgentId = agentId
  config.updatedAt = new Date().toISOString()
  try {
    if (!existsSync(dirname(fp))) mkdirSync(dirname(fp), { recursive: true })
    atomicWrite(fp, config)
  } catch { /* best-effort */ }
  return config
}

/** Bind a target for a native launch without changing the terminal's cwd. */
export function bindTerminalCodingTarget(widgetId, target) {
  const config = readTerminalConfigById(widgetId)
  if (!config) throw new Error(`Terminal config missing for ${widgetId}`)
  config.codingTarget = target ?? null
  config.updatedAt = new Date().toISOString()
  const file = config.reserved
    ? join(rootDir, TERMINALS_DIR, `${widgetId}.json`)
    : configPath(config.branch || 'unknown', config.canvasId || 'unknown', widgetId)
  atomicWrite(file, config)
  return config
}

/** Update runtime context without replacing concurrent live widget fields. */
export function updateTerminalCodingContext(widgetId, update) {
  const config = readTerminalConfigById(widgetId)
  if (!config) return null
  Object.assign(config, update(config))
  config.updatedAt = new Date().toISOString()
  const file = config.reserved
    ? join(rootDir, TERMINALS_DIR, `${widgetId}.json`)
    : configPath(config.branch || 'unknown', config.canvasId || 'unknown', widgetId)
  atomicWrite(file, config)
  return config
}

/**
 * Read the previously-captured agent session id for a widget, if any.
 * @returns {{ sessionId: string, agentId: string|null, capturedAt: string|null } | null}
 */
export function getLastAgentSession({ branch, canvasId, widgetId }) {
  const cfg = readTerminalConfig({ branch, canvasId, widgetId })
  if (!cfg?.lastAgentSessionId) return null
  return {
    sessionId: cfg.lastAgentSessionId,
    agentId: cfg.lastAgentId || null,
    capturedAt: cfg.lastAgentSessionAt || null,
  }
}
