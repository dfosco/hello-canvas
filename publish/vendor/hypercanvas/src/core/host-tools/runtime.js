import { existsSync, statSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { env as processEnv } from 'node:process'
import { getAgentDefinition } from './catalog.js'
import { discoverHostEnvironment } from './environment.js'
import { preflightHostTools } from './preflight.js'
import { withoutRuntimeCredentials } from '../runtimeEnvironment.js'

const BUNDLE_ENV_KEYS = new Set([
  'HYPERCANVAS_BUNDLED_NODE',
  'HYPERCANVAS_BUNDLE_ROOT',
  'HYPERCANVAS_HOST_PATH',
  'NODE_OPTIONS',
  'NODE_PATH',
  'PATH',
  'npm_execpath',
  'npm_node_execpath',
])
const SESSION_ENV_KEYS = new Set([
  'STORYBOARD_BRANCH',
  'STORYBOARD_CANVAS_ID',
  'STORYBOARD_PROJECT_ROOT',
  'STORYBOARD_SERVER_URL',
  'STORYBOARD_WIDGET_ID',
  'FORCE_COLOR',
  'TERM_PROGRAM',
  'ZDOTDIR',
  'STARSHIP_CONFIG',
  'POWERLEVEL9K_DISABLE_CONFIGURATION_WIZARD',
])
const ALLOWED_SHELLS = Object.freeze(['/bin/zsh', '/bin/bash', '/bin/sh'])

export const HOST_RUNTIME_ERROR_CODES = Object.freeze({
  AGENT_REQUIRED: 'HOST_RUNTIME_AGENT_REQUIRED',
  AGENT_UNKNOWN: 'HOST_RUNTIME_AGENT_UNKNOWN',
  AGENT_UNAVAILABLE: 'HOST_RUNTIME_AGENT_UNAVAILABLE',
  BASELINE_UNAVAILABLE: 'HOST_RUNTIME_BASELINE_UNAVAILABLE',
  COMMAND_INVALID: 'HOST_RUNTIME_COMMAND_INVALID',
  ROOT_INVALID: 'HOST_RUNTIME_ROOT_INVALID',
  UNSUPPORTED: 'HOST_RUNTIME_UNSUPPORTED',
})

export class HostRuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'HostRuntimeError'
    this.code = code
    this.details = Object.freeze({ ...details })
  }
}

export function quoteShellWord(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function validateRoot(root) {
  const absolute = typeof root === 'string' ? resolve(root) : ''
  let valid = false
  try {
    valid = Boolean(absolute && isAbsolute(root) && existsSync(absolute) && statSync(absolute).isDirectory())
  } catch { /* invalid or inaccessible root */ }
  if (!valid) {
    throw new HostRuntimeError(HOST_RUNTIME_ERROR_CODES.ROOT_INVALID, 'The Storyboard project root is invalid.')
  }
  return absolute
}

function baseWorkloadEnvironment(hostPath) {
  const env = {}
  for (const [key, value] of Object.entries(withoutRuntimeCredentials(processEnv))) {
    if (typeof value === 'string' && !BUNDLE_ENV_KEYS.has(key)) env[key] = value
  }
  env.PATH = hostPath
  env.HYPERCANVAS_HOST_PATH = hostPath
  return env
}

function runtimeFromEnvironment(root, environment) {
  const cwd = validateRoot(root)
  const hostPath = environment?.path || ''
  const wrapperDirectory = join(cwd, '.storyboard', 'terminals', 'bin')
  const shell = ALLOWED_SHELLS.includes(processEnv.SHELL) && existsSync(processEnv.SHELL)
    ? processEnv.SHELL
    : ALLOWED_SHELLS.find(existsSync) || '/bin/sh'
  return Object.freeze({
    cwd,
    hostPath,
    path: [wrapperDirectory, hostPath].filter(Boolean).join(':'),
    wrapperDirectory,
    shell,
    environment,
  })
}

export function resolveTerminalHostRuntime(root) {
  const environment = discoverHostEnvironment({ env: processEnv })
  return runtimeFromEnvironment(root, environment)
}

export function buildHostWorkloadEnv(runtime, session = {}) {
  const env = baseWorkloadEnvironment(runtime?.hostPath || '')
  env.PATH = runtime?.path || runtime?.hostPath || ''
  env.SHELL = runtime?.shell || '/bin/sh'
  for (const [key, value] of Object.entries(session || {})) {
    if (!SESSION_ENV_KEYS.has(key) || (typeof value !== 'string' && typeof value !== 'number')) continue
    env[key] = String(value)
  }
  return env
}

export function rewriteAgentCommand(runtime, command) {
  const executableName = runtime?.definition?.executable
  const executablePath = runtime?.executablePath
  const source = typeof command === 'string' ? command.trim() : ''
  const quotedExecutable = isAbsolute(executablePath || '') ? quoteShellWord(executablePath) : ''
  const hasToken = (token) => source === token || (source.startsWith(token) && /\s/.test(source[token.length] || ''))
  if (!executableName || !quotedExecutable || (!hasToken(executableName) && !hasToken(quotedExecutable))) {
    throw new HostRuntimeError(
      HOST_RUNTIME_ERROR_CODES.COMMAND_INVALID,
      `The ${runtime?.definition?.displayName || 'agent'} command configuration is invalid.`,
      { agentId: runtime?.agentId || null },
    )
  }
  if (hasToken(quotedExecutable)) return source
  return `${quotedExecutable}${source.slice(executableName.length)}`
}

export function rewriteAgentConfig(runtime, config) {
  if (!config || typeof config !== 'object' || !config.startupCommand) {
    throw new HostRuntimeError(
      HOST_RUNTIME_ERROR_CODES.COMMAND_INVALID,
      `The ${runtime?.definition?.displayName || 'agent'} command configuration is invalid.`,
      { agentId: runtime?.agentId || null },
    )
  }
  const rewritten = { ...config }
  for (const key of ['startupCommand', 'resumeCommand', 'resumeLastCommand']) {
    if (rewritten[key]) rewritten[key] = rewriteAgentCommand(runtime, rewritten[key])
  }
  if (rewritten.contextAdapter?.command) {
    rewritten.contextAdapter = {
      ...rewritten.contextAdapter,
      command: rewriteAgentCommand(runtime, rewritten.contextAdapter.command),
    }
  }
  return rewritten
}

export function reassertHostPath(runtime, command) {
  // Keep the per-session wrapper directory first. It contains the bundled
  // `storyboard` shim; exporting only the host tool path makes agents fall
  // back to stale/global `npx storyboard` installations.
  return `export PATH=${quoteShellWord(runtime.path || runtime.hostPath)}; export HYPERCANVAS_HOST_PATH=${quoteShellWord(runtime.hostPath)}; ${command}`
}

export async function resolveAgentHostRuntime(root, agentId, { preflight = preflightHostTools } = {}) {
  if (!agentId || typeof agentId !== 'string') {
    throw new HostRuntimeError(HOST_RUNTIME_ERROR_CODES.AGENT_REQUIRED, 'A configured agent ID is required.')
  }
  const definition = getAgentDefinition(agentId)
  if (!definition) {
    throw new HostRuntimeError(HOST_RUNTIME_ERROR_CODES.AGENT_UNKNOWN, `Unknown agent ID: ${agentId}`, { agentId })
  }
  let snapshot
  try {
    snapshot = await preflight()
  } catch {
    throw new HostRuntimeError(
      HOST_RUNTIME_ERROR_CODES.BASELINE_UNAVAILABLE,
      'Host tool verification failed.',
      { agentId, status: 'verification_failed' },
    )
  }
  if (snapshot?.status !== 'supported') {
    throw new HostRuntimeError(HOST_RUNTIME_ERROR_CODES.UNSUPPORTED, 'Host agents are unsupported on this platform.', { agentId })
  }
  if (
    snapshot?.baseline?.status !== 'valid'
    || !isAbsolute(snapshot.baseline.node?.path || '')
    || !isAbsolute(snapshot.baseline.npm?.path || '')
    || !snapshot.environment?.path
  ) {
    throw new HostRuntimeError(
      HOST_RUNTIME_ERROR_CODES.BASELINE_UNAVAILABLE,
      'A verified host Node and npm baseline is required to run agents.',
      { agentId, status: snapshot?.baseline?.status || 'missing' },
    )
  }
  const agent = snapshot?.agents?.[agentId]
  if (agent?.status !== 'installed' || !isAbsolute(agent.path || '')) {
    throw new HostRuntimeError(
      HOST_RUNTIME_ERROR_CODES.AGENT_UNAVAILABLE,
      `${definition.displayName} is unavailable in the verified host environment.`,
      { agentId, status: agent?.status || 'missing' },
    )
  }
  const nodeDirectory = dirname(snapshot.baseline.node.path)
  const entries = [...new Set([nodeDirectory, ...(snapshot.environment.entries || [])])]
  const environment = { ...snapshot.environment, entries, path: entries.join(delimiter) }
  const terminal = runtimeFromEnvironment(root, environment)
  return Object.freeze({
    ...terminal,
    agentId,
    definition,
    executablePath: agent.path,
    baselineNodePath: snapshot.baseline.node.path,
  })
}
