import { Buffer } from 'node:buffer'
import { spawn as nodeSpawn } from 'node:child_process'
import * as nodeFs from 'node:fs'
import { homedir } from 'node:os'
import { arch as hostArch, env as hostEnv, platform as hostPlatform } from 'node:process'
import { delimiter } from 'node:path'
import { AGENT_CATALOG, parseToolVersion } from './catalog.js'
import { discoverHostEnvironment, executableDirectory, resolveHostExecutable } from './environment.js'
import { withoutRuntimeCredentials } from '../runtimeEnvironment.js'

export const MINIMUM_NODE_MAJOR = 22
export const DEFAULT_PROBE_TIMEOUT_MS = 3000
export const DEFAULT_PROBE_OUTPUT_BYTES = 64 * 1024

const TOOL_DEFINITIONS = Object.freeze({
  homebrew: Object.freeze({
    executable: 'brew',
    knownPaths: Object.freeze(['/opt/homebrew/bin/brew']),
    versionArgs: Object.freeze(['--version']),
  }),
  node: Object.freeze({
    executable: 'node',
    knownPaths: Object.freeze(['/opt/homebrew/opt/node@24/bin/node', '/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']),
    versionArgs: Object.freeze(['--version']),
  }),
  npm: Object.freeze({
    executable: 'npm',
    knownPaths: Object.freeze(['/opt/homebrew/opt/node@24/bin/npm', '/opt/homebrew/bin/npm', '/usr/local/bin/npm', '/usr/bin/npm']),
    versionArgs: Object.freeze(['--version']),
  }),
})

function frozen(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) frozen(child)
  return Object.freeze(value)
}

function processError(result) {
  if (result?.timedOut) return 'timeout'
  if (result?.error === 'output_limit') return 'output_limit'
  if (result?.error) return 'spawn_failed'
  if (result?.exitCode !== 0) return 'nonzero_exit'
  return 'verification_failed'
}

export function runBoundedProcess(file, args, {
  env,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_PROBE_OUTPUT_BYTES,
  spawn = nodeSpawn,
} = {}) {
  return new Promise((resolveResult) => {
    let child
    let settled = false
    let timedOut = false
    let outputBytes = 0
    const stdout = []
    const stderr = []
    let timer

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveResult({
        stdout: Buffer.concat(stdout).toString('utf8').trim(),
        stderr: Buffer.concat(stderr).toString('utf8').trim(),
        timedOut,
        ...result,
      })
    }
    const collect = (target) => (chunk) => {
      const buffer = Buffer.from(chunk)
      if (outputBytes + buffer.length > maxOutputBytes) {
        child.kill('SIGKILL')
        finish({ ok: false, exitCode: null, error: 'output_limit' })
        return
      }
      outputBytes += buffer.length
      target.push(buffer)
    }

    try {
      child = spawn(file, args, {
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      finish({ ok: false, exitCode: null, error })
      return
    }
    child.stdout?.on('data', collect(stdout))
    child.stderr?.on('data', collect(stderr))
    child.once('error', (error) => finish({ ok: false, exitCode: null, error }))
    child.once('close', (exitCode) => finish({ ok: !timedOut && exitCode === 0, exitCode }))
    timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
      finish({ ok: false, exitCode: null, error: 'timeout' })
    }, timeoutMs)
  })
}

async function probe(path, definition, status, runProcess, env) {
  if (!path) return { status: 'missing', path: null, version: null }
  let result
  try {
    result = await runProcess(path, definition.versionArgs, {
      env,
      shell: false,
      timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
      maxOutputBytes: DEFAULT_PROBE_OUTPUT_BYTES,
    })
  } catch {
    return { status: 'failed_verification', path, version: null, reason: 'spawn_failed' }
  }
  if (!result?.ok) {
    return { status: 'failed_verification', path, version: null, reason: processError(result) }
  }
  const version = (definition.parseVersion || parseToolVersion)(`${result.stdout || ''}\n${result.stderr || ''}`)
  if (!version) return { status: 'failed_verification', path, version: null, reason: 'invalid_version' }
  return { status, path, version }
}

function baselineStatus(node, npm) {
  if (node.status === 'valid' && Number(node.version.split('.')[0]) < MINIMUM_NODE_MAJOR) return 'outdated'
  if (node.status === 'valid' && npm.status === 'valid') return 'valid'
  if (node.status === 'missing' && npm.status === 'missing') return 'missing'
  return 'partial'
}

export async function preflightHostTools({
  platform = hostPlatform,
  arch = hostArch,
  env = hostEnv,
  fs = nodeFs,
  runProcess = runBoundedProcess,
  home = env.HOME || homedir(),
} = {}) {
  const safeEnv = withoutRuntimeCredentials(env)
  const support = { status: platform === 'darwin' && arch === 'arm64' ? 'supported' : 'unsupported', platform, arch }
  if (support.status === 'unsupported') {
    return frozen({
      status: 'unsupported',
      support,
      environment: null,
      homebrew: { status: 'unsupported', path: null, version: null },
      baseline: { status: 'unsupported', minimumNodeMajor: MINIMUM_NODE_MAJOR, node: null, npm: null },
      agents: Object.fromEntries(AGENT_CATALOG.map(({ id }) => [id, { status: 'unsupported', path: null, version: null }])),
    })
  }

  const environment = discoverHostEnvironment({ env: safeEnv, fs, home })
  const resolveTool = (definition) => resolveHostExecutable(definition.executable, {
    environment,
    knownPaths: definition.knownPaths,
    fs,
    home,
  })
  const homebrewPath = resolveTool(TOOL_DEFINITIONS.homebrew)
  const nodePath = resolveTool(TOOL_DEFINITIONS.node)
  const npmPath = resolveTool(TOOL_DEFINITIONS.npm)
  const agentPaths = new Map(AGENT_CATALOG.map((definition) => [definition.id, resolveTool(definition)]))
  const probeEnv = { ...safeEnv, PATH: environment.path }
  const nodeProbePath = nodePath ? executableDirectory(nodePath) : null
  const javascriptEnv = nodeProbePath
    ? { ...probeEnv, PATH: [nodeProbePath, environment.path].filter(Boolean).join(delimiter) }
    : probeEnv

  const [homebrew, node, npm, ...agentResults] = await Promise.all([
    probe(homebrewPath, TOOL_DEFINITIONS.homebrew, 'valid', runProcess, probeEnv),
    probe(nodePath, TOOL_DEFINITIONS.node, 'valid', runProcess, probeEnv),
    probe(npmPath, TOOL_DEFINITIONS.npm, 'valid', runProcess, javascriptEnv),
    ...AGENT_CATALOG.map((definition) => probe(
      agentPaths.get(definition.id),
      definition,
      'installed',
      runProcess,
      javascriptEnv,
    )),
  ])
  if (npm.status === 'valid') npm.runtimeNodePath = nodePath

  return frozen({
    status: 'supported',
    support,
    environment,
    homebrew,
    baseline: {
      status: baselineStatus(node, npm),
      minimumNodeMajor: MINIMUM_NODE_MAJOR,
      node,
      npm,
    },
    agents: Object.fromEntries(AGENT_CATALOG.map(({ id }, index) => [id, agentResults[index]])),
  })
}
