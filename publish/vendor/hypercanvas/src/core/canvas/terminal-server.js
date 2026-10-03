import { ensureTerminalAgentProfiles } from './terminal-agent-profiles.js'
/**
 * Terminal WebSocket bridge backed by the Hypercanvas PTY runtime.
 *
 * The browser protocol is intentionally unchanged: raw terminal text flows in
 * both directions and resize requests remain JSON control messages. Broker
 * sequences, authentication, and process ownership stay server-side.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import {
  buildHostWorkloadEnv,
  HostRuntimeError,
  HOST_RUNTIME_ERROR_CODES,
  quoteShellWord,
  resolveAgentHostRuntime,
  resolveTerminalHostRuntime,
  rewriteAgentConfig,
} from '../host-tools/runtime.js'
import { getAgentDefinition } from '../host-tools/catalog.js'
import { devLog } from '../logger/devLogger.js'
import { bindWidget, unbindWidget, updateWidgetAdapter } from '../messaging/delivery.js'
import { joinPresence, leavePresence } from '../messaging/presence.js'
import { findByWorktree } from '../worktree/serverRegistry.js'
import { detectWorktreeName } from '../worktree/port.js'
import {
  adoptRuntimeSession,
  disconnectSession,
  findSessionIdForWidget,
  generateSessionId,
  getSessionByWidget,
  getSessionStats,
  initRegistry,
  killSession,
  orphanSession,
  registerSession,
} from './terminal-registry.js'
import {
  createTerminalSession,
  resizeTerminalSession,
  snapshotTerminalSession,
  subscribeTerminalSession,
  terminalSessionExists,
  withTerminalStartup,
  writeTerminalBytes,
  writeTerminalText,
} from './terminal-runtime.js'
import {
  buildHubBootstrapPrompt,
  getLastAgentSession,
  initTerminalConfig,
  readTerminalConfigById,
  recordAgentSession,
  updateAgentStatus,
  writeTerminalConfig,
} from './terminal-config.js'
import { readAgentsConfig, readTerminalSettings } from './configReader.js'
import { initPaseoTerminalRuntime } from './paseo-terminal-runtime.js'
import { confirmNotebookPaseoBinding } from './paseo-notebook-binding.js'
import { isAllowedRequestOrigin } from '../cli/devContract.js'
import { codingTargetBootstrap } from './terminal-coding-target.js'
import {
  captureFilePath,
  ensureClaudeCaptureHookInstalled,
  ensureCodexCaptureHookInstalled,
  ensureCopilotCaptureHookInstalled,
  watchSessionIdFile,
} from './agent-session.js'

let WebSocketServer
try {
  WebSocketServer = createRequire(import.meta.url)('ws').WebSocketServer
} catch {
  WebSocketServer = null
}

const TERMINAL_PATH_PREFIX = '/_storyboard/terminal/'
const BUFFER_MAX_AGE_MS = 5 * 60 * 1000
const SNAPSHOT_MAX_AGE_MS = 60 * 1000
const SNAPSHOT_INDEX_JSON = 'agents.snapshot.json'
const SNAPSHOT_INDEX_TXT = 'agents-txt.snapshot.json'
const SNAPSHOT_INDEX_MAX_ENTRIES = 50
const wsConnections = new Map()
const subscriptions = new Map()
const sessionCaptureStops = new Map()
const snapshotIntervals = new Map()
const rollingBuffers = new Map()

let currentBranch = 'unknown'
let actualServerPort = null
let actualBase = '/'
let actualHttpServer = null
let runtimeReadyRef = Promise.resolve(true)
let hotPoolRef = null
let projectRoot = null
let workspaceIdResolver = null
let snapshotIndexCache = null
let snapshotTxtIndexCache = null
let snapshotLegacyFilesCleaned = false

function resolveStoryboardCli() {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const cliPath = resolve(here, '..', 'cli', 'index.js')
    if (existsSync(cliPath)) return `${quoteShellWord(process.execPath)} ${quoteShellWord(cliPath)}`
  } catch { /* packaged fallback */ }
  return null
}

const STORYBOARD_CLI_CMD = resolveStoryboardCli()

function terminalSettings() {
  return readTerminalSettings(projectRoot || undefined)
}

async function resolveVerifiedAgent(agentId) {
  const runtime = await resolveAgentHostRuntime(projectRoot, agentId)
  const config = readAgentsConfig(projectRoot)?.[agentId]
  if (!config) {
    throw new HostRuntimeError(
      HOST_RUNTIME_ERROR_CODES.COMMAND_INVALID,
      `Agent ${agentId} is not configured.`,
      { agentId },
    )
  }
  return { id: agentId, runtime, config: rewriteAgentConfig(runtime, config) }
}

function configuredAgentIdForCommand(command) {
  const executable = typeof command === 'string' ? command.trim().match(/^[^\s]+/)?.[0] : null
  if (!executable) return null
  return Object.entries(readAgentsConfig(projectRoot) || {}).find(([id, config]) => (
    getAgentDefinition(id) && config?.startupCommand?.trim().match(/^[^\s]+/)?.[0] === executable
  ))?.[0] || null
}

function serverUrl() {
  let port = actualServerPort
  if (!port && actualHttpServer) {
    try { port = actualHttpServer.address()?.port || null } catch { /* not listening */ }
  }
  if (!port) {
    try { port = findByWorktree(detectWorktreeName())[0]?.port || null } catch { /* no registry */ }
  }
  const host = process.env.STORYBOARD_DESKTOP === '1' ? '127.0.0.1' : 'localhost'
  const base = (actualBase || '/').replace(/\/$/, '')
  return `http://${host}:${port || 1234}${base}`
}

async function resolveActiveWorkspaceId() {
  if (typeof workspaceIdResolver === 'function') return workspaceIdResolver(projectRoot)
  // Fallback for direct runtime use — still gates on the verified binding so
  // failures are recorded instead of silently degrading.
  const confirmed = await confirmNotebookPaseoBinding(projectRoot)
  return confirmed.workspaceId
}

function safeCanvasDir(canvasId) {
  return canvasId.replace(/\//g, '--')
}

function legacySnapshotDir(canvasId) {
  return join(projectRoot, '.storyboard', 'terminal-snapshots', safeCanvasDir(canvasId))
}

function bufferDir() {
  return join(projectRoot, '.storyboard', 'terminal-buffers')
}

function publicSnapshotDir() {
  return join(projectRoot, 'assets', '.storyboard-public', 'terminal-snapshots')
}

function appendToRollingBuffer(sessionId, data) {
  const entries = rollingBuffers.get(sessionId) || []
  entries.push({ ts: Date.now(), data })
  const cutoff = Date.now() - BUFFER_MAX_AGE_MS
  while (entries[0]?.ts < cutoff) entries.shift()
  rollingBuffers.set(sessionId, entries)
}

function getRollingBufferContent(sessionId, maxAgeMs = BUFFER_MAX_AGE_MS) {
  const cutoff = Date.now() - maxAgeMs
  return (rollingBuffers.get(sessionId) || [])
    .filter((entry) => entry.ts >= cutoff)
    .map((entry) => entry.data)
    .join('')
}

function stripAnsi(value) {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\].*?(\x07|\x1b\\)/g, '')
}

function emptyIndex() {
  return { version: 1, updatedAt: null, agents: {} }
}

function readIndexFile(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    if (parsed?.agents && typeof parsed.agents === 'object') return parsed
  } catch { /* absent or invalid */ }
  return emptyIndex()
}

function loadSnapshotIndexes() {
  snapshotIndexCache ||= readIndexFile(join(publicSnapshotDir(), SNAPSHOT_INDEX_JSON))
  snapshotTxtIndexCache ||= readIndexFile(join(publicSnapshotDir(), SNAPSHOT_INDEX_TXT))
  return { jsonIndex: snapshotIndexCache, txtIndex: snapshotTxtIndexCache }
}

function atomicWriteJson(filePath, data) {
  const temporary = `${filePath}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(data, null, 2), 'utf8')
    renameSync(temporary, filePath)
  } catch (error) {
    try { unlinkSync(temporary) } catch { /* absent */ }
    throw error
  }
}

function writeSnapshotIndexes(jsonIndex, txtIndex) {
  mkdirSync(publicSnapshotDir(), { recursive: true })
  const now = new Date().toISOString()
  jsonIndex.updatedAt = now
  txtIndex.updatedAt = now
  atomicWriteJson(join(publicSnapshotDir(), SNAPSHOT_INDEX_JSON), jsonIndex)
  atomicWriteJson(join(publicSnapshotDir(), SNAPSHOT_INDEX_TXT), txtIndex)
}

function cleanupLegacySnapshotFiles() {
  if (snapshotLegacyFilesCleaned) return
  snapshotLegacyFilesCleaned = true
  try {
    for (const file of readdirSync(publicSnapshotDir())) {
      if (file === SNAPSHOT_INDEX_JSON || file === SNAPSHOT_INDEX_TXT) continue
      if (file.endsWith('.snapshot.json') || file.endsWith('.snapshot.txt')) {
        try { unlinkSync(join(publicSnapshotDir(), file)) } catch { /* best effort */ }
      }
    }
  } catch { /* directory absent */ }
}

function isWidgetPrivate(widgetId) {
  return readTerminalConfigById(widgetId)?.widgetProps?.private === true
}

async function captureSnapshot({ sessionId, widgetId, canvasId, prettyName, createdAt }) {
  let snapshot
  try { snapshot = await snapshotTerminalSession(sessionId) } catch { return }
  const now = new Date().toISOString()
  const paneContent = snapshot.screen || ''
  const rawTail = getRollingBufferContent(sessionId)
  const data = {
    widgetId,
    canvasId,
    sessionId,
    prettyName: prettyName || null,
    createdAt: createdAt || now,
    timestamp: now,
    cols: snapshot.cols || 80,
    rows: snapshot.rows || 24,
    paneContent,
    scrollback: rawTail || snapshot.text || '',
    sequence: snapshot.sequence || 0,
  }
  mkdirSync(bufferDir(), { recursive: true })
  atomicWriteJson(join(bufferDir(), `${widgetId}.buffer.json`), data)
  writeFileSync(
    join(bufferDir(), `${widgetId}.buffer.txt`),
    `[${widgetId}${prettyName ? ` | ${prettyName}` : ''} | ${now}]\n\n--- screen ---\n${stripAnsi(paneContent) || '(empty)'}\n\n--- scrollback ---\n${stripAnsi(data.scrollback)}\n`,
  )

  cleanupLegacySnapshotFiles()
  const { jsonIndex, txtIndex } = loadSnapshotIndexes()
  if (isWidgetPrivate(widgetId)) {
    delete jsonIndex.agents[widgetId]
    delete txtIndex.agents[widgetId]
    writeSnapshotIndexes(jsonIndex, txtIndex)
    return
  }
  const publicScrollback = stripAnsi(getRollingBufferContent(sessionId, SNAPSHOT_MAX_AGE_MS) || snapshot.text || '')
  jsonIndex.agents[widgetId] = {
    widgetId,
    canvasId,
    prettyName: prettyName || null,
    timestamp: now,
    cols: data.cols,
    rows: data.rows,
    paneContent: stripAnsi(paneContent),
    scrollback: publicScrollback,
  }
  const separator = '='.repeat(80)
  txtIndex.agents[widgetId] = `SESSION: ${widgetId}${prettyName ? ` | ${prettyName}` : ''}\nCANVAS:  ${canvasId}\nBRANCH:  ${currentBranch}\nTIME:    ${now}\n\n${separator}\nSCREEN\n${separator}\n\n${stripAnsi(paneContent) || '(empty)'}\n\n${separator}\nSCROLLBACK (last 60s)\n${separator}\n\n${publicScrollback}\n`
  const keys = Object.keys(jsonIndex.agents)
  if (keys.length > SNAPSHOT_INDEX_MAX_ENTRIES) {
    keys.sort((left, right) => String(jsonIndex.agents[left]?.timestamp).localeCompare(String(jsonIndex.agents[right]?.timestamp)))
    for (const key of keys.slice(0, keys.length - SNAPSHOT_INDEX_MAX_ENTRIES)) {
      delete jsonIndex.agents[key]
      delete txtIndex.agents[key]
    }
  }
  writeSnapshotIndexes(jsonIndex, txtIndex)
}

function startSnapshotCapture(options) {
  if (snapshotIntervals.has(options.sessionId)) return
  const interval = terminalSettings().snapshotInterval ?? 5000
  const timer = setInterval(() => captureSnapshot(options).catch(() => {}), interval)
  timer.unref?.()
  snapshotIntervals.set(options.sessionId, timer)
}

function stopSnapshotCapture(sessionId, options) {
  const timer = snapshotIntervals.get(sessionId)
  if (timer) clearInterval(timer)
  snapshotIntervals.delete(sessionId)
  if (options) captureSnapshot(options).catch(() => {})
  rollingBuffers.delete(sessionId)
}

function sendJson(ws, value) {
  if (ws.readyState === 1) ws.send(JSON.stringify(value))
}

export function notifyTerminalContext(widgetId, state) {
  const sessionId = findSessionIdForWidget(widgetId)
  const ws = sessionId && wsConnections.get(sessionId)
  if (ws) sendJson(ws, { type: 'context-state', state })
}

async function submit(sessionId, text) {
  if (!text) return
  await writeTerminalText(sessionId, text, { submit: true })
}

function prepareTerminalFiles({ widgetId, canvasId, prettyName, branch, server }) {
  if (!STORYBOARD_CLI_CMD) throw new Error('The bundled Storyboard CLI could not be resolved.')
  ensureTerminalAgentProfiles(projectRoot)
  const directory = join(projectRoot, '.storyboard', 'terminals')
  const binDirectory = join(directory, 'bin')
  mkdirSync(binDirectory, { recursive: true })
  const identity = {
    STORYBOARD_WIDGET_ID: widgetId,
    STORYBOARD_CANVAS_ID: canvasId,
    STORYBOARD_BRANCH: branch,
    STORYBOARD_SERVER_URL: server,
    STORYBOARD_PROJECT_ROOT: projectRoot,
  }
  const envFile = join(directory, `${widgetId}.env.sh`)
  const terminalConfig = readTerminalConfigById(widgetId)
  const explicitPrompt = terminalConfig?.widgetProps?.initialPrompt
    || terminalConfig?.widgetProps?.prompt
  const initialPrompt = terminalConfig?.codingTarget ? codingTargetBootstrap(projectRoot, terminalConfig, terminalConfig.codingTarget) : [
    'Before starting, read `.agents/terminal-agent.agent.md` when it exists and follow its behavioral guidance.',
    explicitPrompt,
    buildHubBootstrapPrompt(terminalConfig, widgetId),
  ].filter((value, index, values) => typeof value === 'string' && value.trim() && values.indexOf(value) === index).join('\n\n')
  const initialPromptFile = join(directory, `${widgetId}.initial-prompt.md`)
  if (typeof initialPrompt === 'string' && initialPrompt.trim()) {
    writeFileSync(initialPromptFile, `${initialPrompt.trim()}\n`)
  } else {
    rmSync(initialPromptFile, { force: true })
  }
  writeFileSync(envFile, Object.entries(identity).map(([key, value]) => `export ${key}=${quoteShellWord(value)}`).join('\n') + '\n')
  const canvasArg = canvasId !== 'unknown' ? canvasId : ''
  const nameArg = prettyName ? ` --name ${quoteShellWord(prettyName)}` : ''
  const welcome = `${STORYBOARD_CLI_CMD} terminal-welcome --branch ${quoteShellWord(branch)} --canvas ${quoteShellWord(canvasArg)}${nameArg}`
  for (const file of readdirSync(binDirectory)) rmSync(join(binDirectory, file), { force: true })
  // Ensure agents resolve the CLI bundled with this server, rather than an
  // older global/npx installation that may not have the durable inbox routes.
  const storyboardShim = join(binDirectory, 'storyboard')
  writeFileSync(storyboardShim, `#!/usr/bin/env sh\nexec ${STORYBOARD_CLI_CMD} "$@"\n`, { mode: 0o755 })
  const agentCases = []
  const wrappers = []
  for (const [id, config] of Object.entries(readAgentsConfig(projectRoot) || {})) {
    if (!getAgentDefinition(id) || !config?.startupCommand) continue
    agentCases.push(`  ${id})\n    startup=${quoteShellWord(config.startupCommand)}\n    if [ "$#" -gt 0 ]; then startup="$startup $*"; fi\n    exec ${welcome} --agent ${quoteShellWord(id)} --startup "$startup"\n    ;;`)
    wrappers.push(id)
  }
  const startPath = join(binDirectory, 'start')
  const startScript = `#!/usr/bin/env sh
if [ "$#" -eq 0 ]; then exec ${welcome}; fi
agent="$1"
shift
case "$agent" in
  shell) exec ${welcome} --startup 'shell' ;;
${agentCases.join('\n')}
  *) printf '%s\n' 'Use start with shell or a configured agent ID.' >&2; exit 2 ;;
esac
`
  writeFileSync(startPath, startScript, { mode: 0o755 })
  for (const id of wrappers) {
    writeFileSync(join(binDirectory, id), `#!/usr/bin/env sh\nexec ${quoteShellWord(startPath)} ${quoteShellWord(id)} "$@"\n`, { mode: 0o755 })
  }
  return { identity, envFile, binDirectory, welcome }
}

async function waitForReadiness(sessionId, readyFile, signal, timeoutMs = 60_000, afterSequence = null) {
  if (!readyFile && !signal) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 1500))
    return
  }
  const baseline = afterSequence == null
    ? await snapshotTerminalSession(sessionId).then((snapshot) => snapshot.sequence || 0).catch(() => 0)
    : afterSequence
  let output = ''
  let subscription = null
  let fileTimer = null
  let timeout = null
  let finished = false
  let resolveWait
  const waiting = new Promise((resolve) => { resolveWait = resolve })
  const finish = (result = 'ready') => {
    if (finished) return
    finished = true
    if (fileTimer) clearInterval(fileTimer)
    if (timeout) clearTimeout(timeout)
    subscription?.close()
    resolveWait(result)
  }
  if (readyFile) {
    if (existsSync(readyFile)) finish('ready')
    else {
      fileTimer = setInterval(() => { if (existsSync(readyFile)) finish('ready') }, 250)
      fileTimer.unref?.()
    }
  }
  if (signal && !finished) {
    subscription = await subscribeTerminalSession(sessionId, {
      readOnly: true,
      afterSequence: baseline,
      onOutput: (event) => {
        output += Buffer.from(event.bytes || []).toString('utf8')
        if (output.includes(signal)) finish('ready')
      },
      onExit: () => finish('exit'),
    }).catch(() => null)
  }
  if (!finished) {
    timeout = setTimeout(() => finish('timeout'), timeoutMs)
    timeout.unref?.()
  }
  const result = await waiting
  if (result === 'exit') throw new Error('Agent exited before becoming ready')
  if (result === 'timeout') throw new Error(`Agent readiness timed out${signal ? ` waiting for ${JSON.stringify(signal)}` : ''}`)
}

async function bindAgentSession(sessionId, context, agentConfig, runtimeId = null) {
  const { widgetId, branch, canvasId, prettyName } = context
  if (agentConfig?.postStartup) await submit(sessionId, agentConfig.postStartup).catch(() => {})
  const terminalConfig = readTerminalConfigById(widgetId)
  await bindWidget({
    widgetId,
    sessionId,
    branch,
    canvasId,
    displayName: prettyName,
    runtime: runtimeId,
    threadId: terminalConfig?.lastAgentSessionId || null,
    adapter: agentConfig?.contextAdapter || null,
  }).catch(() => {})
  await joinPresence({ widgetId, senderName: prettyName || widgetId, branch, canvasId }).catch(() => {})
}

function watchNativeSession(sessionId, context, agentId, agentConfig) {
  sessionCaptureStops.get(sessionId)?.()
  sessionCaptureStops.delete(sessionId)
  if (!agentConfig?.sessionIdEnv) return
  const stop = watchSessionIdFile(captureFilePath(projectRoot, context.widgetId), (nativeSessionId) => {
    recordAgentSession({ ...context, agentId, sessionId: nativeSessionId })
    updateWidgetAdapter(context.widgetId, { threadId: nativeSessionId })
  })
  sessionCaptureStops.set(sessionId, stop)
}

export async function activateTerminalAgent({ widgetId, canvasId = 'unknown', branch = currentBranch, agentId = null, prettyName = null }) {
  const sessionId = findSessionIdForWidget(widgetId)
  if (!sessionId) throw new Error(`No active terminal session for widget ${widgetId}`)
  const resolvedAgent = await resolveVerifiedAgent(agentId)
  const { config: agentConfig } = resolvedAgent
  const snapshot = await snapshotTerminalSession(sessionId)
  watchNativeSession(sessionId, { widgetId, canvasId, branch }, resolvedAgent.id, agentConfig)
  waitForReadiness(sessionId, null, agentConfig.readinessSignal, 60_000, snapshot.sequence || 0).then(async () => {
    updateAgentStatus({ branch, canvasId, widgetId, status: 'ready', message: 'Agent ready' })
    await bindAgentSession(sessionId, {
      widgetId,
      canvasId,
      branch,
      prettyName,
      server: serverUrl(),
    }, agentConfig, resolvedAgent.id)
  }).catch((error) => {
    updateAgentStatus({ branch, canvasId, widgetId, status: 'error', message: error.message })
  })
  return { sessionId, agentId: resolvedAgent.id }
}

async function startSessionCommand(sessionId, context, startupCommand, resolvedAgent) {
  const files = prepareTerminalFiles(context, resolvedAgent?.id)
  const command = startupCommand
  const agentConfig = resolvedAgent?.config || null
  let resumeSessionId = null
  if (agentConfig?.sessionIdEnv) {
    const saved = getLastAgentSession({
      branch: context.branch,
      canvasId: context.canvasId,
      widgetId: context.widgetId,
    })
    if (saved?.sessionId && (!saved.agentId || saved.agentId === resolvedAgent?.id)) resumeSessionId = saved.sessionId
  }
  watchNativeSession(sessionId, context, resolvedAgent?.id || null, agentConfig)
  const readyFile = agentConfig?.sessionIdEnv ? join(projectRoot, '.storyboard', 'terminals', `${context.widgetId}.ready`) : null
  if (readyFile) rmSync(readyFile, { force: true })
  const startup = !command
    ? `clear && ${files.welcome}`
    : `${files.welcome}${resolvedAgent ? ` --agent ${quoteShellWord(resolvedAgent.id)}` : ''}${resumeSessionId ? ` --resume-session ${quoteShellWord(resumeSessionId)}` : ''} --startup ${quoteShellWord(command === 'shell' ? 'shell' : command)}`
  const readinessBaseline = agentConfig
    ? await snapshotTerminalSession(sessionId).then((snapshot) => snapshot.sequence || 0).catch(() => 0)
    : 0
  await submit(sessionId, `source ${quoteShellWord(files.envFile)} && ${startup}`)
  if (agentConfig) {
    waitForReadiness(sessionId, readyFile, agentConfig.readinessSignal, 60_000, readinessBaseline)
      .then(async () => {
        updateAgentStatus({
          branch: context.branch,
          canvasId: context.canvasId,
          widgetId: context.widgetId,
          status: 'ready',
          message: 'Agent ready',
        })
        await bindAgentSession(sessionId, context, agentConfig, resolvedAgent?.id || null)
      })
      .catch((error) => {
        updateAgentStatus({
          branch: context.branch,
          canvasId: context.canvasId,
          widgetId: context.widgetId,
          status: 'error',
          message: error.message,
        })
      })
  }
}

async function executeStartupSequence(sessionId, ws, sequence) {
  if (!sequence?.steps?.length) return
  const keys = { '{enter}': '\r', '{tab}': '\t', '{escape}': '\u001b', '{space}': ' ' }
  let outputBaseline = null
  for (let index = 0; index < sequence.steps.length; index += 1) {
    const step = sequence.steps[index]
    try {
      if (step.type === 'command') {
        outputBaseline = await snapshotTerminalSession(sessionId).then((snapshot) => snapshot.sequence || 0).catch(() => 0)
        await submit(sessionId, step.value)
      }
      else if (step.type === 'keystroke') await writeTerminalText(sessionId, keys[step.value] || step.value)
      else if (step.type === 'wait' && (step.until === 'ready' || step.until === 'output')) {
        await waitForReadiness(sessionId, null, step.match, step.timeout || 10_000, outputBaseline)
        outputBaseline = null
      } else if (step.type === 'wait') {
        await new Promise((resolveWait) => setTimeout(resolveWait, step.ms || 1000))
      } else if (step.type === 'env') {
        await submit(sessionId, `export ${step.name}=${JSON.stringify(step.value || '')}`)
      } else {
        devLog().logEvent('warn', `Unsupported terminal startup step: ${step.type}`, { stepType: step.type })
      }
    } catch (error) {
      devLog().logEvent('warn', 'Terminal startup step failed', { step: index, error: error.message })
    }
    if (index === sequence.renderAfterStep) sendJson(ws, { type: 'render' })
  }
}

export async function orphanTerminalSession(widgetId) {
  const sessionId = findSessionIdForWidget(widgetId)
  if (!sessionId) return
  orphanSession(sessionId)
  subscriptions.get(sessionId)?.close()
  subscriptions.delete(sessionId)
  subscriptions.delete(sessionId)
  const ws = wsConnections.get(sessionId)
  if (ws?.readyState <= 1) ws.close()
  wsConnections.delete(sessionId)
}

export function setupTerminalServer(
  httpServer,
  base = '/',
  branch = 'unknown',
  hotPoolManager = null,
  runtimeReady = null,
  root = null,
  resolveWorkspaceId = null,
) {
  if (!WebSocketServer) {
    devLog().logEvent('warn', 'ws is unavailable; terminal widgets are disabled')
    return
  }
  currentBranch = branch
  hotPoolRef = hotPoolManager
  runtimeReadyRef = runtimeReady || Promise.resolve(true)
  workspaceIdResolver = resolveWorkspaceId
  if (!root) throw new Error('Terminal server requires the Vite project root.')
  projectRoot = resolve(root)
  actualBase = base || '/'
  actualHttpServer = httpServer
  try { actualServerPort = httpServer.address()?.port || null } catch { /* not listening */ }
  if (!actualServerPort) httpServer.once('listening', () => {
    try { actualServerPort = httpServer.address()?.port || null } catch { /* ignored */ }
  })
  initRegistry(projectRoot, { gracePeriod: terminalSettings().orphanGracePeriod })
  initTerminalConfig(projectRoot)
  for (const install of [ensureCopilotCaptureHookInstalled, ensureClaudeCaptureHookInstalled, ensureCodexCaptureHookInstalled]) {
    try { install() } catch { /* optional CLI hook */ }
  }
  console.log(`[storyboard] terminal server ready (Hypercanvas PTY) [branch: ${branch}]`)

  const wss = new WebSocketServer({ noServer: true })
  const baseNoTrail = (base || '/').replace(/\/$/, '')
  httpServer.on('upgrade', (request, socket, head) => {
    let pathname = request.url || ''
    if (baseNoTrail && pathname.startsWith(baseNoTrail)) pathname = pathname.slice(baseNoTrail.length) || '/'
    if (!pathname.startsWith(TERMINAL_PATH_PREFIX)) return
    if (!isAllowedTerminalOrigin(request)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return socket.destroy()
    }
    const [widgetId, query = ''] = pathname.slice(TERMINAL_PATH_PREFIX.length).split('?')
    if (!widgetId) return socket.destroy()
    const params = new URLSearchParams(query)
    wss.handleUpgrade(request, socket, head, (ws) => {
      const context = {
        widgetId,
        canvasId: params.get('canvas') || 'unknown',
        prettyName: params.get('name') || null,
        agentId: params.get('agentId') || null,
        startupCommand: params.get('startupCommand') || null,
        cols: Math.min(1000, Math.max(10, Number.parseInt(params.get('cols'), 10) || 80)),
        rows: Math.min(1000, Math.max(4, Number.parseInt(params.get('rows'), 10) || 24)),
      }
      if (params.get('readOnly') === '1') handleReadOnlyConnection(ws, context).catch((error) => failConnection(ws, error))
      else handleConnection(ws, context).catch((error) => failConnection(ws, error))
    })
  })
}

export function isAllowedTerminalOrigin(request) {
  return isAllowedRequestOrigin(request.headers, {
    desktop: process.env.STORYBOARD_DESKTOP === '1',
  })
}

function failConnection(ws, error) {
  devLog().logEvent('error', 'Terminal connection failed', { error: error.message, code: error.code || null })
  sendJson(ws, {
    type: error.code === 'RUNTIME_ERROR' && /PTY|allocate/i.test(error.message) ? 'resource-limited' : 'error',
    message: error.message,
    code: error.code || null,
    counts: getSessionStats(),
  })
  if (ws.readyState <= 1) ws.close()
}

async function handleReadOnlyConnection(ws, { widgetId, canvasId }) {
  const sessionId = findSessionIdForWidget(widgetId) || generateSessionId(currentBranch, canvasId, widgetId)
  let subscription = null
  let disconnected = false
  const close = () => {
    if (disconnected) return
    disconnected = true
    subscription?.close()
  }
  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(Buffer.from(message).toString('utf8'))
      if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
        resizeTerminalSession(sessionId, parsed.cols, parsed.rows).catch((error) => failConnection(ws, error))
      }
    } catch { /* read-only terminals ignore input */ }
  })
  ws.on('close', close)
  ws.on('error', close)
  try {
    if (disconnected || ws.readyState >= 2) return
    const decoder = new StringDecoder('utf8')
    subscription = await subscribeTerminalSession(sessionId, {
      readOnly: true,
      restore: true,
      onOutput: (event) => { if (ws.readyState === 1) ws.send(decoder.write(Buffer.from(event.bytes))) },
      onGap: (event) => sendTerminalRestore(ws, event.snapshot),
      onExit: () => { if (ws.readyState <= 1) ws.close() },
      onError: (error) => failConnection(ws, error),
    })
    if (disconnected || ws.readyState >= 2) return subscription.close()
    sendJson(ws, { type: 'session-info', sessionId, readOnly: true })
  } catch (error) {
    close()
    throw error
  }
}

async function handleConnection(ws, context) {
  return withTerminalStartup(`${context.canvasId}:${context.widgetId}`, async () => {
    let runtime = await runtimeReadyRef
    if (!runtime) {
      if (process.env.STORYBOARD_DESKTOP === '1' || process.env.STORYBOARD_DISABLE_PTY_RUNTIME === '1') {
        throw new Error('Hypercanvas PTY runtime is unavailable')
      }
      runtimeReadyRef = initPaseoTerminalRuntime(projectRoot, { startupTimeoutMs: 30_000 }).catch(() => null)
      runtime = await runtimeReadyRef
    }
    if (!runtime) throw new Error('Hypercanvas PTY runtime is unavailable')
    return handleConnectionUnlocked(ws, context)
  })
}

function sendTerminalRestore(ws, snapshot) {
  sendJson(ws, {
    type: 'terminal-restore',
    cols: snapshot?.cols,
    rows: snapshot?.rows,
    data: snapshot?.ansi || snapshot?.screen || '',
  })
}

async function handleConnectionUnlocked(ws, { widgetId, canvasId, prettyName, agentId, startupCommand: requestedStartup, cols = 80, rows = 24 }) {
  const branch = currentBranch
  const sessionId = generateSessionId(branch, canvasId, widgetId)
  const existing = wsConnections.get(sessionId)
  if (existing && existing !== ws && existing.readyState <= 1) {
    sendJson(existing, { type: 'detached', message: 'Terminal is attached in another view. Reconnect explicitly to use it here.' })
    existing.close(4001, 'Terminal view replaced')
  }
  subscriptions.get(sessionId)?.close()
  wsConnections.set(sessionId, ws)

  let entry = null
  let priorRuntimeAlive = false
  let warmSession = null
  let warmConsumed = false
  let targetPool = null
  let conflict = null
  let created = null
  let priorEntry = null
  let subscription = null
  let snapshotOptions = null
  let disconnected = false
  const disconnect = () => {
    if (disconnected) return
    disconnected = true
    const isCurrentConnection = wsConnections.get(sessionId) === ws
    if (isCurrentConnection) {
      wsConnections.delete(sessionId)
      if (snapshotOptions) stopSnapshotCapture(sessionId, snapshotOptions)
      unbindWidget(widgetId)
      leavePresence(widgetId)
      if (entry) disconnectSession(sessionId, entry.generation)
    }
    if (subscriptions.get(sessionId) === subscription) subscriptions.delete(sessionId)
    subscription?.close()
  }
  const ensureConnected = () => {
    if (disconnected || ws.readyState >= 2) throw new Error('Terminal connection closed during startup')
  }
  ws.on('close', disconnect)
  ws.on('error', disconnect)
  try {
    ensureConnected()
    let resolvedAgent = agentId ? await resolveVerifiedAgent(agentId) : null
    if (widgetId.startsWith('agent-') && !agentId) {
      throw new HostRuntimeError(HOST_RUNTIME_ERROR_CODES.AGENT_REQUIRED, 'Visible agent sessions require an agent ID.')
    }
    if (!resolvedAgent && requestedStartup && requestedStartup !== 'shell') {
      throw new HostRuntimeError(HOST_RUNTIME_ERROR_CODES.AGENT_REQUIRED, 'Visible agent sessions require an agent ID.')
    }
    const configuredStartup = terminalSettings().startupCommand ?? null
    if (!resolvedAgent && configuredStartup && configuredStartup !== 'shell') {
      const configuredAgentId = configuredAgentIdForCommand(configuredStartup)
      if (configuredAgentId) resolvedAgent = await resolveVerifiedAgent(configuredAgentId)
    }
    const startupCommand = agentId
      ? resolvedAgent.config.startupCommand
      : (requestedStartup || configuredStartup || resolvedAgent?.config.startupCommand)
    targetPool = resolvedAgent?.id || (!startupCommand ? 'terminal' : null)
    priorEntry = getSessionByWidget(branch, canvasId, widgetId)
    priorRuntimeAlive = priorEntry
      ? await terminalSessionExists(priorEntry.sessionId).catch(() => false)
      : false
    const priorAgentId = readTerminalConfigById(widgetId)?.widgetProps?.agentId || null
    if (priorRuntimeAlive && priorAgentId !== (resolvedAgent?.id || null)) {
      await killSession(sessionId)
      priorEntry = null
      priorRuntimeAlive = false
    }
    const saved = resolvedAgent?.config?.sessionIdEnv
      ? getLastAgentSession({ branch, canvasId, widgetId })
      : null
    warmSession = !priorRuntimeAlive && !saved && targetPool && hotPoolRef?.has(targetPool)
      ? hotPoolRef.acquire(targetPool)
      : null
    const runtimeSessionId = priorRuntimeAlive
      ? priorEntry.runtimeSessionId
      : (warmSession?.runtimeSessionId || sessionId)
    const workspaceId = await resolveActiveWorkspaceId()
    const server = serverUrl()
    prepareTerminalFiles({ widgetId, canvasId, prettyName, branch, server })
    const existingWidgetProps = readTerminalConfigById(widgetId)?.widgetProps || {}
    writeTerminalConfig({
      branch,
      canvasId,
      widgetId,
      serverUrl: server,
      workspaceId,
      sessionId,
      displayName: prettyName,
      widgetProps: {
        ...existingWidgetProps,
        agentId: resolvedAgent?.id || existingWidgetProps.agentId || null,
        ...(prettyName ? { prettyName } : {}),
      },
    })
    const hostRuntime = resolvedAgent?.runtime || resolveTerminalHostRuntime(projectRoot)
    const shell = hostRuntime.shell
    const prompt = terminalSettings().prompt || '$ '
    const zdotdir = join(tmpdir(), 'storyboard-terminal')
    mkdirSync(zdotdir, { recursive: true })
    writeFileSync(join(zdotdir, '.zshenv'), '')
    writeFileSync(join(zdotdir, '.zshrc'), `export PS1=${JSON.stringify(prompt)}\nunset RPS1\n`)
    created = await createTerminalSession(sessionId, {
      runtimeSessionId,
      workspaceId,
      rollbackOnError: !priorRuntimeAlive,
      program: shell,
      cwd: projectRoot,
      env: buildHostWorkloadEnv(hostRuntime, {
        TERM_PROGRAM: 'storyboard',
        FORCE_COLOR: '3',
        ZDOTDIR: zdotdir,
        STARSHIP_CONFIG: '/dev/null',
        POWERLEVEL9K_DISABLE_CONFIGURATION_WIZARD: 'true',
        STORYBOARD_WIDGET_ID: widgetId,
        STORYBOARD_CANVAS_ID: canvasId,
        STORYBOARD_BRANCH: branch,
        STORYBOARD_SERVER_URL: server,
        STORYBOARD_PROJECT_ROOT: projectRoot,
      }),
      cols,
      rows,
    })
    ensureConnected()
    const registered = registerSession({ branch, canvasId, widgetId, prettyName, runtimeSessionId })
    entry = registered.entry
    conflict = registered.conflict
    if (runtimeSessionId !== sessionId) adoptRuntimeSession(sessionId, runtimeSessionId)
    if (warmSession) {
      hotPoolRef.consume(targetPool, warmSession.id)
      warmConsumed = true
    }

  // Negotiate dimensions before the native restore. Resuming cursor output
  // after plain capture text loses the TUI's cursor, modes and cell positions.
  await resizeTerminalSession(sessionId, cols, rows)
  const decoder = new StringDecoder('utf8')
  subscription = await subscribeTerminalSession(sessionId, {
    restore: true,
    onOutput: (event) => {
      const output = decoder.write(Buffer.from(event.bytes))
      if (ws.readyState === 1) ws.send(output)
      appendToRollingBuffer(sessionId, output)
    },
    onGap: (event) => {
      sendTerminalRestore(ws, event.snapshot)
    },
    onConflict: (event) => sendJson(ws, { type: 'conflict', message: event.reason }),
    onExit: (event) => {
      import('./live-terminal-coding-target.js').then(module => module.stopTerminalContext(projectRoot, widgetId)).catch(() => {})
      if (event.processStatus?.message) sendJson(ws, { type: 'error', message: event.processStatus.message })
      if (ws.readyState <= 1) ws.close()
    },
    onError: (error) => failConnection(ws, error),
  })
  ensureConnected()
  subscriptions.set(sessionId, subscription)
  sendJson(ws, {
    type: 'session-info',
    sessionId,
    name: entry.name,
    contextState: readTerminalConfigById(widgetId)?.contextState || null,
    reconnected: created.reused === true,
    // Paseo placement is verifiable client-side: the terminal ID and the
    // workspace it lives in (the active Notebook's confirmed binding).
    ...(created?.workspaceId
      ? { workspaceId: created.workspaceId, terminalId: created.terminalId || null }
      : {}),
  })
  if (conflict) sendJson(ws, { type: 'conflict', ...conflict })
  if (resolvedAgent) joinPresence({ widgetId, senderName: prettyName || widgetId, branch, canvasId }).catch(() => {})

  snapshotOptions = { sessionId, widgetId, canvasId, prettyName, createdAt: entry.createdAt }
  startSnapshotCapture(snapshotOptions)
  if (!created.reused || warmSession) {
    setTimeout(() => {
      startSessionCommand(sessionId, { widgetId, canvasId, prettyName, branch, server }, startupCommand, resolvedAgent)
        .catch((error) => devLog().logEvent('warn', 'Terminal startup command failed', { widgetId, error: error.message }))
      const sequence = terminalSettings().defaultStartupSequence
      if (sequence?.steps?.length) executeStartupSequence(sessionId, ws, sequence).catch(() => {})
    }, 300)
  }

  ws.on('message', (message) => {
    const bytes = Buffer.isBuffer(message) ? message : Buffer.from(message)
    const text = bytes.toString('utf8')
    try {
      const parsed = JSON.parse(text)
      if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
        resizeTerminalSession(sessionId, parsed.cols, parsed.rows).catch((error) => failConnection(ws, error))
        return
      }
    } catch { /* raw terminal input */ }
    writeTerminalBytes(sessionId, bytes).catch((error) => failConnection(ws, error))
  })

  } catch (error) {
    ws.off('close', disconnect)
    ws.off('error', disconnect)
    if (wsConnections.get(sessionId) === ws) wsConnections.delete(sessionId)
    subscriptions.get(sessionId)?.close()
    subscriptions.delete(sessionId)
    if (warmSession && !warmConsumed) hotPoolRef?.release(targetPool, warmSession.id)
    if (entry) {
      if (priorRuntimeAlive) disconnectSession(sessionId, entry.generation)
      else await killSession(sessionId).catch(() => {})
    } else if (created && !priorRuntimeAlive) {
      await killSession(sessionId).catch(() => {})
    } else if (priorRuntimeAlive && priorEntry) {
      disconnectSession(sessionId, priorEntry.generation)
    }
    throw error
  }
}

export async function killTerminalSession(sessionId) {
  const { getSession } = await import('./terminal-registry.js')
  const entry = getSession(sessionId)
  if (entry?.widgetId) {
    const { stopTerminalContext } = await import('./live-terminal-coding-target.js')
    stopTerminalContext(projectRoot, entry.widgetId)
  }
  sessionCaptureStops.get(sessionId)?.()
  sessionCaptureStops.delete(sessionId)
  return killSession(sessionId)
}

export { legacySnapshotDir as terminalSnapshotDir }

export function readTerminalBuffer(widgetId, { maxLength } = {}) {
  try {
    const data = JSON.parse(readFileSync(join(bufferDir(), `${widgetId}.buffer.json`), 'utf8'))
    if (maxLength && data.scrollback?.length > maxLength) data.scrollback = data.scrollback.slice(-maxLength)
    if (maxLength && data.paneContent?.length > maxLength) data.paneContent = data.paneContent.slice(-maxLength)
    return data
  } catch { return null }
}

export function readTerminalSnapshot(widgetId, canvasId) {
  try {
    const entry = JSON.parse(readFileSync(join(publicSnapshotDir(), SNAPSHOT_INDEX_JSON), 'utf8'))?.agents?.[widgetId]
    if (entry) return entry
  } catch { /* legacy fallback */ }
  if (canvasId) {
    try { return JSON.parse(readFileSync(join(legacySnapshotDir(canvasId), `${widgetId}.json`), 'utf8')) } catch { /* absent */ }
  }
  return null
}
