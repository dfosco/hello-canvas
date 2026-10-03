import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import * as nodeFs from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { env as hostEnv } from 'node:process'
import { spawn as nodeSpawn } from 'node:child_process'
import { AGENT_IDS, getAgentDefinition } from './catalog.js'
import { createOperationStore } from './operation-store.js'
import { preflightHostTools } from './preflight.js'
import { withoutRuntimeCredentials } from '../runtimeEnvironment.js'

export const HOMEBREW_INSTALLER_URL = 'https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh'
export const HOMEBREW_PATH = '/opt/homebrew/bin/brew'
export const HOMEBREW_BIN = '/opt/homebrew/bin'
export const HOMEBREW_SBIN = '/opt/homebrew/sbin'
export const NODE24_BIN = '/opt/homebrew/opt/node@24/bin'
export const NODE24_FORMULA = 'node@24'
export const MAX_INSTALLER_BYTES = 1024 * 1024
export const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024
export const INSTALL_TIMEOUT_MS = 20 * 60 * 1000

export const BASELINE_PHASE_IDS = Object.freeze([
  'preflight',
  'homebrew',
  'node24',
  'path-refresh',
  'baseline-verification',
  'agents',
  'final-verification',
])

const PLAN_DISCLOSURES = Object.freeze({
  homebrew: Object.freeze({
    id: 'homebrew-terminal-handoff',
    title: 'Homebrew may require macOS authorization',
    detail: 'The official Homebrew installer opens in a visible Terminal window. Hypercanvas never requests, receives, or records your password.',
    origin: HOMEBREW_INSTALLER_URL,
    authentication: 'macos-terminal-user-managed',
  }),
  node24: Object.freeze({
    id: 'homebrew-node24',
    title: 'Install the supported Node LTS baseline',
    detail: `${HOMEBREW_PATH} installs the code-owned ${NODE24_FORMULA} formula without changing shell profiles.`,
    executable: HOMEBREW_PATH,
    formula: NODE24_FORMULA,
  }),
  path: Object.freeze({
    id: 'host-path-priority',
    title: 'Prioritize the installed Node LTS runtime',
    detail: `${NODE24_BIN} is placed before older host Node installations for Hypercanvas terminals and agents.`,
    firstEntry: NODE24_BIN,
    modifiesShellProfile: false,
  }),
})

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) freeze(child)
  return Object.freeze(value)
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function toolIdentity(tool) {
  if (!tool) return null
  return {
    status: tool.status || null,
    path: tool.path || null,
    version: tool.version || null,
    reason: tool.reason || null,
  }
}

export function createPreflightFingerprint(snapshot, selectedAgentIds = []) {
  const input = {
    support: snapshot?.support || null,
    environment: {
      entries: snapshot?.environment?.entries || [],
      bundleRoots: snapshot?.environment?.bundleRoots || [],
    },
    homebrew: toolIdentity(snapshot?.homebrew),
    baseline: {
      status: snapshot?.baseline?.status || null,
      minimumNodeMajor: snapshot?.baseline?.minimumNodeMajor || null,
      node: toolIdentity(snapshot?.baseline?.node),
      npm: toolIdentity(snapshot?.baseline?.npm),
    },
    agents: Object.fromEntries(selectedAgentIds.map((id) => [id, toolIdentity(snapshot?.agents?.[id])])),
  }
  return createHash('sha256').update(stable(input)).digest('hex')
}

function installerError(code, message, details) {
  const error = new Error(message)
  error.name = 'HostToolsInstallerError'
  error.code = code
  if (details !== undefined) error.details = details
  return error
}

function assertExactInput(input, allowedKeys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw installerError('INVALID_INPUT', 'Expected an input object')
  const extra = Object.keys(input).filter((key) => !allowedKeys.includes(key))
  if (extra.length) throw installerError('INVALID_INPUT', `Unsupported installer input: ${extra.join(', ')}`)
}

function selectedAgents(value) {
  if (!Array.isArray(value)) throw installerError('INVALID_AGENT_SELECTION', 'selectedAgentIds must be an array')
  const selected = [...new Set(value)]
  if (selected.length !== value.length || selected.some((id) => typeof id !== 'string' || !AGENT_IDS.includes(id))) {
    throw installerError('INVALID_AGENT_SELECTION', 'Agent selections must be unique code-owned agent IDs')
  }
  return selected
}

function homebrewReady(snapshot) {
  return snapshot?.homebrew?.status === 'valid' && snapshot.homebrew.path === HOMEBREW_PATH
}

function baselineReady(snapshot) {
  return snapshot?.baseline?.status === 'valid'
}

function plannedSteps(snapshot, agentIds) {
  const baselineValid = baselineReady(snapshot)
  const needsHomebrew = !baselineValid && !homebrewReady(snapshot)
  const needsNode = !baselineValid
  return [
    { id: 'preflight', action: 'rerun', label: 'Re-run host tools preflight' },
    { id: 'homebrew', action: needsHomebrew ? 'install' : 'skip', label: needsHomebrew ? 'Install Homebrew in visible Terminal' : 'Preserve Homebrew state' },
    { id: 'node24', action: needsNode ? 'install' : 'skip', label: needsNode ? `Install ${NODE24_FORMULA} with Homebrew` : 'Preserve compatible Node and npm' },
    { id: 'path-refresh', action: needsNode ? 'prioritize' : 'preserve', label: needsNode ? `Prioritize ${NODE24_BIN}` : 'Preserve the valid host runtime path' },
    { id: 'baseline-verification', action: 'verify', label: 'Verify host Node and npm by absolute path' },
    { id: 'agents', action: agentIds.length ? 'install-selected' : 'skip', label: agentIds.length ? `Install or preserve ${agentIds.length} selected agent CLI${agentIds.length === 1 ? '' : 's'}` : 'No agent CLIs selected' },
    { id: 'final-verification', action: 'verify', label: 'Re-run final host and selected-agent verification' },
  ]
}

function planDisclosures(snapshot, agentIds) {
  const disclosures = []
  if (!baselineReady(snapshot) && !homebrewReady(snapshot)) disclosures.push(PLAN_DISCLOSURES.homebrew)
  if (!baselineReady(snapshot)) disclosures.push(PLAN_DISCLOSURES.node24, PLAN_DISCLOSURES.path)
  for (const id of agentIds) {
    const definition = getAgentDefinition(id)
    const install = definition.install
    disclosures.push({
      id: `agent-${id}`,
      title: `${definition.displayName} official installer`,
      detail: install.integrity,
      origin: install.origin,
      destination: install.destination,
      modifiesShellProfile: install.modifiesShellProfile,
      profileControl: install.profileControl,
      authentication: install.authentication,
    })
  }
  return disclosures
}

function supported(snapshot) {
  return snapshot?.status === 'supported' && snapshot?.support?.platform === 'darwin' && snapshot?.support?.arch === 'arm64'
}

function prioritizedHostPath(snapshot) {
  const entries = [NODE24_BIN, HOMEBREW_BIN, HOMEBREW_SBIN, ...(snapshot?.environment?.entries || [])]
  return [...new Set(entries.filter((entry) => isAbsolute(entry)))].join(delimiter)
}

function pathInside(path, root) {
  const relation = relative(root, path)
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation))
}

function verifiedBaseline(snapshot) {
  if (!baselineReady(snapshot)) return false
  const paths = [snapshot.baseline.node?.path, snapshot.baseline.npm?.path]
  if (paths.some((path) => !path || !isAbsolute(path) || path.includes(`${sep}node_modules${sep}`))) return false
  return !paths.some((path) => (snapshot.environment?.bundleRoots || []).some((root) => pathInside(path, root)))
}

function verifiedAgent(snapshot, id) {
  const tool = snapshot?.agents?.[id]
  return tool?.status === 'installed' && isAbsolute(tool.path || '')
}

function expandHome(path, home) {
  return path === '~' ? home : path.startsWith('~/') ? join(home, path.slice(2)) : path
}

function waitForChild(child) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    child.once('error', (error) => finish({ ok: false, exitCode: null, error }))
    child.once('close', (exitCode) => finish({ ok: exitCode === 0, exitCode }))
  })
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function epoch(now) {
  const value = now()
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

async function defaultTerminalHandoff({ installerPath, directory, fs, spawn, sleep, now }) {
  const statusPath = join(directory, 'terminal-status')
  const launcherPath = join(directory, 'run-homebrew-installer.command')
  const launcher = [
    '#!/bin/bash',
    `${shellQuote('/bin/bash')} ${shellQuote(installerPath)}`,
    'status=$?',
    `${shellQuote('/usr/bin/printf')} '%s\\n' "$status" > ${shellQuote(statusPath)}`,
    'exit "$status"',
    '',
  ].join('\n')
  await fs.writeFile(launcherPath, launcher, { mode: 0o700, flag: 'wx' })
  const launch = spawn('/usr/bin/open', ['-a', 'Terminal', launcherPath], {
    shell: false,
    env: withoutRuntimeCredentials(hostEnv),
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: false,
  })
  const launched = await waitForChild(launch)
  if (!launched.ok) return launched
  const deadline = epoch(now) + INSTALL_TIMEOUT_MS
  while (epoch(now) < deadline) {
    try {
      const exitCode = Number((await fs.readFile(statusPath, 'utf8')).trim())
      return { ok: exitCode === 0, exitCode }
    } catch {
      await sleep(500)
    }
  }
  return { ok: false, exitCode: null, error: 'terminal_handoff_timeout' }
}

async function downloadInstaller({ id, origin, allowedFinalUrls, fetch, fs, temporaryRoot }) {
  const errorPrefix = id.toUpperCase().replaceAll('-', '_')
  const rejected = () => installerError(`${errorPrefix}_DOWNLOAD_REJECTED`, `The ${id} installer response was not from an allowlisted official URL`)
  const allowed = (value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && allowedFinalUrls.some((entry) => url.href === new URL(entry).href)
    } catch {
      return false
    }
  }
  let currentUrl = origin
  let response
  for (let redirects = 0; redirects <= allowedFinalUrls.length; redirects += 1) {
    if (!allowed(currentUrl)) throw rejected()
    response = await fetch(currentUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'text/x-shellscript, text/plain;q=0.9' },
    })
    if (!allowed(response?.url || currentUrl)) throw rejected()
    const status = response.status ?? (response.ok ? 200 : 500)
    if (status < 300 || status >= 400) break
    const location = response.headers?.get?.('location')
    if (!location) throw rejected()
    currentUrl = new URL(location, response.url || currentUrl).href
  }
  if (!response?.ok) {
    throw installerError(`${errorPrefix}_DOWNLOAD_REJECTED`, `The ${id} installer response was not from an allowlisted official URL`)
  }
  const declaredLength = Number(response.headers?.get?.('content-length') || 0)
  if (declaredLength > MAX_INSTALLER_BYTES) throw installerError(`${errorPrefix}_DOWNLOAD_TOO_LARGE`, `The ${id} installer exceeded the download limit`)
  let bytes
  if (response.body?.getReader) {
    const chunks = []
    let total = 0
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_INSTALLER_BYTES) {
        await reader.cancel().catch(() => {})
        throw installerError(`${errorPrefix}_DOWNLOAD_TOO_LARGE`, `The ${id} installer exceeded the download limit`)
      }
      chunks.push(value)
    }
    bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer())
  }
  if (!bytes.length || bytes.length > MAX_INSTALLER_BYTES) throw installerError(`${errorPrefix}_DOWNLOAD_TOO_LARGE`, `The ${id} installer was empty or exceeded the download limit`)
  const directory = await fs.mkdtemp(join(temporaryRoot(), `hypercanvas-${id}-`))
  try {
    await fs.chmod(directory, 0o700)
    const installerPath = join(directory, 'install.sh')
    await fs.writeFile(installerPath, bytes, { mode: 0o700, flag: 'wx' })
    return { directory, installerPath }
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

function agentProcessEnvironment(definition, hostPath, home) {
  const install = definition.install
  const pathDirectory = expandHome(install.pathDirectory, home)
  const path = [...new Set([
    pathDirectory,
    ...String(hostPath || '').split(delimiter),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ].filter((entry) => isAbsolute(entry)))].join(delimiter)
  const env = {
    HOME: home,
    PATH: path,
    SHELL: '/bin/zsh',
    TMPDIR: hostEnv.TMPDIR || tmpdir(),
  }
  for (const [key, value] of Object.entries(install.env)) env[key] = expandHome(value, home)
  return env
}

function runInstallProcess(file, args, { env, spawn, onOutput, onCancellable }) {
  return new Promise((resolve) => {
    let child
    let settled = false
    let outputBytes = 0
    let timer
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      onCancellable(null)
      resolve(result)
    }
    const collect = (stream) => (chunk) => {
      const text = String(chunk)
      outputBytes += Buffer.byteLength(text)
      if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
        child.kill('SIGTERM')
        finish({ ok: false, exitCode: null, error: 'output_limit' })
        return
      }
      onOutput(stream, text)
    }
    try {
      child = spawn(file, args, { env, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (error) {
      finish({ ok: false, exitCode: null, error })
      return
    }
    onCancellable(() => child.kill('SIGTERM'))
    child.stdout?.on('data', collect('stdout'))
    child.stderr?.on('data', collect('stderr'))
    child.once('error', (error) => finish({ ok: false, exitCode: null, error }))
    child.once('close', (exitCode, signal) => finish({ ok: exitCode === 0, exitCode, signal }))
    timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish({ ok: false, exitCode: null, error: 'timeout' })
    }, INSTALL_TIMEOUT_MS)
  })
}

function failureDetails(error, phase) {
  return {
    code: error?.code || 'INSTALL_FAILED',
    message: error?.message || 'Host tools installation failed',
    phase,
  }
}

export function createHostToolsInstaller({
  fetch = globalThis.fetch,
  fs = nodeFs,
  temporaryRoot = tmpdir,
  spawn = nodeSpawn,
  preflight = preflightHostTools,
  now = Date.now,
  generateId = randomUUID,
  terminalHandoff,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  operationStore = createOperationStore({ now }),
} = {}) {
  const plans = new Map()
  const consumedPlans = new Set()
  const running = new Map()
  const controls = new Map()
  const home = hostEnv.HOME || homedir()
  let starting = false

  const rerunPreflight = (path) => preflight({
    env: path
      ? { ...withoutRuntimeCredentials(hostEnv), PATH: path, HYPERCANVAS_HOST_PATH: path }
      : withoutRuntimeCredentials(hostEnv),
  })
  const handoff = terminalHandoff || ((input) => defaultTerminalHandoff({ ...input, fs, spawn, sleep, now }))

  function partialResult(operationId, extra = {}) {
    const snapshot = operationStore.get(operationId)
    const completed = snapshot.phases.filter(({ status }) => status === 'succeeded').map(({ id }) => id)
    const successfulAgent = Object.values(extra.agents || {}).some(({ status }) => status === 'succeeded')
    return {
      partialSuccess: completed.includes('homebrew') || completed.includes('node24') || successfulAgent,
      completedPhases: completed,
      selectedAgentIds: [...snapshot.selectedAgentIds],
      ...extra,
    }
  }

  function cancellationRequested(operationId) {
    return operationStore.get(operationId)?.cancellation.requested === true
  }

  function stopIfCancelled(operationId, extra) {
    if (!cancellationRequested(operationId)) return false
    operationStore.cancel(operationId, partialResult(operationId, extra))
    return true
  }

  async function execute(operationId, plan, initialSnapshot) {
    let phase = 'preflight'
    let snapshot = initialSnapshot
    let hostPath = snapshot.environment?.path || ''
    let installedHomebrew = false
    let installedNode = false
    const agents = {}
    operationStore.start(operationId)
    try {
      operationStore.startPhase(operationId, phase, { cancellationState: 'live_preflight_complete' })
      operationStore.appendOutput(operationId, { phase, text: 'Live host preflight matched the consented install plan.' })
      operationStore.completePhase(operationId, phase, { fingerprint: plan.preflightFingerprint })
      if (stopIfCancelled(operationId)) return

      phase = 'homebrew'
      if (baselineReady(snapshot)) {
        operationStore.skipPhase(operationId, phase, { reason: 'baseline_already_valid' })
      } else if (homebrewReady(snapshot)) {
        operationStore.skipPhase(operationId, phase, { reason: 'homebrew_already_valid', path: HOMEBREW_PATH })
      } else {
        operationStore.startPhase(operationId, phase, { cancellationState: 'preparing_terminal_handoff' })
        operationStore.appendOutput(operationId, { phase, text: `Downloading the official Homebrew installer from ${HOMEBREW_INSTALLER_URL}` })
        const temporary = await downloadInstaller({
          id: 'homebrew',
          origin: HOMEBREW_INSTALLER_URL,
          allowedFinalUrls: [HOMEBREW_INSTALLER_URL],
          fetch,
          fs,
          temporaryRoot,
        })
        try {
          if (stopIfCancelled(operationId)) return
          operationStore.setCancellation(operationId, { available: false, state: 'terminal_handoff_non_cancellable' })
          operationStore.appendOutput(operationId, { phase, text: 'Homebrew installation is running in visible Terminal. Authorization stays in Terminal and cannot be cancelled by Hypercanvas.' })
          const result = await handoff({
            installerPath: temporary.installerPath,
            directory: temporary.directory,
            command: freeze({ file: '/bin/bash', args: [temporary.installerPath] }),
          })
          if (!result?.ok) throw installerError('HOMEBREW_INSTALL_FAILED', 'The visible Homebrew installer did not complete successfully')
        } finally {
          await fs.rm(temporary.directory, { recursive: true, force: true }).catch(() => {})
        }
        snapshot = await rerunPreflight()
        if (!homebrewReady(snapshot)) throw installerError('HOMEBREW_VERIFICATION_FAILED', `Homebrew was not verified at ${HOMEBREW_PATH}`)
        installedHomebrew = true
        operationStore.completePhase(operationId, phase, { path: HOMEBREW_PATH, terminalHandoff: true })
      }
      if (stopIfCancelled(operationId, { installedHomebrew })) return

      phase = 'node24'
      snapshot = await rerunPreflight()
      if (baselineReady(snapshot)) {
        operationStore.skipPhase(operationId, phase, { reason: 'baseline_already_valid' })
      } else {
        if (!homebrewReady(snapshot)) throw installerError('HOMEBREW_REQUIRED', `Verified Homebrew is required at ${HOMEBREW_PATH}`)
        hostPath = prioritizedHostPath(snapshot)
        operationStore.startPhase(operationId, phase, { cancellable: true })
        operationStore.appendOutput(operationId, { phase, text: `${HOMEBREW_PATH} install ${NODE24_FORMULA}` })
        const control = controls.get(operationId)
        const result = await runInstallProcess(HOMEBREW_PATH, ['install', NODE24_FORMULA], {
          env: { ...withoutRuntimeCredentials(hostEnv), PATH: hostPath, HYPERCANVAS_HOST_PATH: hostPath },
          spawn,
          onOutput: (stream, text) => operationStore.appendOutput(operationId, { phase, stream, text }),
          onCancellable: (cancel) => {
            control.cancel = cancel
            operationStore.setCancellation(operationId, {
              available: Boolean(cancel),
              state: cancel ? 'available' : cancellationRequested(operationId) ? 'requested' : 'between_phases',
            })
          },
        })
        if (cancellationRequested(operationId)) {
          operationStore.cancel(operationId, partialResult(operationId, { installedHomebrew, installedNode: false }))
          return
        }
        if (!result.ok) throw installerError('NODE_INSTALL_FAILED', `${NODE24_FORMULA} installation failed`, { exitCode: result.exitCode, reason: result.error || result.signal })
        installedNode = true
        operationStore.completePhase(operationId, phase, { executable: HOMEBREW_PATH, formula: NODE24_FORMULA, exitCode: result.exitCode })
      }

      phase = 'path-refresh'
      operationStore.startPhase(operationId, phase, { cancellationState: 'refreshing_host_path' })
      hostPath = installedNode ? prioritizedHostPath(snapshot) : snapshot.environment?.path || prioritizedHostPath(snapshot)
      operationStore.completePhase(operationId, phase, { path: hostPath, firstEntry: hostPath.split(delimiter)[0] || null })
      if (stopIfCancelled(operationId, { installedHomebrew, installedNode, hostPath })) return

      phase = 'baseline-verification'
      operationStore.startPhase(operationId, phase, { cancellationState: 'verification_non_cancellable' })
      snapshot = await rerunPreflight(hostPath)
      if (!verifiedBaseline(snapshot)) throw installerError('BASELINE_VERIFICATION_FAILED', 'Host Node and npm were not verified outside the Hypercanvas bundle')
      if (installedNode && (
        snapshot.environment.entries[0] !== dirname(snapshot.baseline.node.path)
        || snapshot.baseline.npm.runtimeNodePath !== snapshot.baseline.node.path
      )) {
        throw installerError('NODE_PATH_PRIORITY_FAILED', `${NODE24_BIN} did not take priority for Node and npm`)
      }
      operationStore.completePhase(operationId, phase, { node: snapshot.baseline.node, npm: snapshot.baseline.npm })

      phase = 'agents'
      if (!plan.selectedAgentIds.length) {
        operationStore.skipPhase(operationId, phase, { reason: 'no_agents_selected', agents })
      } else {
        operationStore.startPhase(operationId, phase, { cancellationState: 'between_agent_installers' })
        for (const [index, id] of plan.selectedAgentIds.entries()) {
          const definition = getAgentDefinition(id)
          const install = definition.install
          if (cancellationRequested(operationId)) {
            for (const remainingId of plan.selectedAgentIds.slice(index)) {
              agents[remainingId] = { status: 'skipped', reason: 'operation_cancelled' }
            }
            operationStore.failPhase(operationId, phase, { code: 'CANCELLED', agents })
            operationStore.cancel(operationId, partialResult(operationId, { installedHomebrew, installedNode, hostPath, agents }))
            return
          }
          if (verifiedAgent(snapshot, id)) {
            agents[id] = {
              status: 'skipped',
              reason: 'already_valid',
              path: snapshot.agents[id].path,
              version: snapshot.agents[id].version,
            }
            operationStore.appendOutput(operationId, { phase, text: `${definition.displayName} is already valid at ${snapshot.agents[id].path}; preserving it.` })
            continue
          }

          let temporary = null
          let verification = null
          const processEnv = agentProcessEnvironment(definition, hostPath, home)
          hostPath = processEnv.PATH
          try {
            operationStore.appendOutput(operationId, { phase, text: `Downloading the official ${definition.displayName} installer from ${install.origin}` })
            temporary = await downloadInstaller({
              id,
              origin: install.origin,
              allowedFinalUrls: install.allowedFinalUrls,
              fetch,
              fs,
              temporaryRoot,
            })
            if (cancellationRequested(operationId)) {
              agents[id] = { status: 'failed', code: 'CANCELLED', message: `${definition.displayName} installation was cancelled before execution` }
              for (const remainingId of plan.selectedAgentIds.slice(index + 1)) {
                agents[remainingId] = { status: 'skipped', reason: 'operation_cancelled' }
              }
              operationStore.failPhase(operationId, phase, { code: 'CANCELLED', agents })
              operationStore.cancel(operationId, partialResult(operationId, { installedHomebrew, installedNode, hostPath, agents }))
              return
            }
            const args = [temporary.installerPath, ...install.args]
            operationStore.appendOutput(operationId, { phase, text: `${install.shell} ${install.args.join(' ')}`.trim() })
            const control = controls.get(operationId)
            const result = await runInstallProcess(install.shell, args, {
              env: processEnv,
              spawn,
              onOutput: (stream, text) => operationStore.appendOutput(operationId, { phase, stream, text }),
              onCancellable: (cancel) => {
                control.cancel = cancel
                operationStore.setCancellation(operationId, {
                  available: Boolean(cancel),
                  state: cancel ? `installing_${id}` : cancellationRequested(operationId) ? 'requested' : 'between_agent_installers',
                })
              },
            })
            if (cancellationRequested(operationId)) {
              agents[id] = { status: 'failed', code: 'CANCELLED', message: `${definition.displayName} installation was cancelled` }
              for (const remainingId of plan.selectedAgentIds.slice(index + 1)) {
                agents[remainingId] = { status: 'skipped', reason: 'operation_cancelled' }
              }
              operationStore.failPhase(operationId, phase, { code: 'CANCELLED', agents })
              operationStore.cancel(operationId, partialResult(operationId, { installedHomebrew, installedNode, hostPath, agents }))
              return
            }
            if (!result.ok) {
              throw installerError('AGENT_INSTALL_PROCESS_FAILED', `${definition.displayName} installer failed`, { agentId: id, exitCode: result.exitCode, reason: result.error || result.signal })
            }
            verification = await rerunPreflight(hostPath)
            if (!verifiedAgent(verification, id)) {
              throw installerError('AGENT_VERIFICATION_FAILED', `${definition.displayName} was not verified by absolute path after installation`, { agentId: id })
            }
            snapshot = verification
            agents[id] = {
              status: 'succeeded',
              path: snapshot.agents[id].path,
              version: snapshot.agents[id].version,
              destination: expandHome(install.destination, home),
            }
          } catch (error) {
            if (!verification) verification = await rerunPreflight(hostPath).catch(() => null)
            const details = failureDetails(error, phase)
            agents[id] = {
              status: 'failed',
              code: details.code,
              message: details.message,
              path: verification?.agents?.[id]?.path || null,
              verificationStatus: verification?.agents?.[id]?.status || 'unavailable',
            }
            if (verification) snapshot = verification
            operationStore.appendOutput(operationId, { phase, stream: 'system', text: `${definition.displayName}: ${details.message}` })
          } finally {
            if (temporary) await fs.rm(temporary.directory, { recursive: true, force: true }).catch(() => {})
          }
        }
        const failedAgents = Object.entries(agents).filter(([, result]) => result.status === 'failed').map(([id]) => id)
        if (failedAgents.length) operationStore.failPhase(operationId, phase, { code: 'AGENT_INSTALL_FAILED', failedAgentIds: failedAgents, agents })
        else operationStore.completePhase(operationId, phase, { agents })
      }

      phase = 'final-verification'
      operationStore.startPhase(operationId, phase, { cancellationState: 'verification_non_cancellable' })
      const finalSnapshot = await rerunPreflight(hostPath)
      if (!verifiedBaseline(finalSnapshot)) throw installerError('FINAL_VERIFICATION_FAILED', 'Final host Node and npm verification failed')
      for (const id of plan.selectedAgentIds) {
        if (agents[id]?.status === 'failed' || verifiedAgent(finalSnapshot, id)) continue
        agents[id] = {
          status: 'failed',
          code: 'AGENT_FINAL_VERIFICATION_FAILED',
          message: `${getAgentDefinition(id).displayName} failed final absolute-path verification`,
          path: finalSnapshot.agents?.[id]?.path || null,
          verificationStatus: finalSnapshot.agents?.[id]?.status || 'unavailable',
        }
      }
      const failedAgentIds = Object.entries(agents).filter(([, result]) => result.status === 'failed').map(([id]) => id)
      if (failedAgentIds.length) operationStore.failPhase(operationId, 'agents', { code: 'AGENT_INSTALL_FAILED', failedAgentIds, agents })
      operationStore.completePhase(operationId, phase, { node: finalSnapshot.baseline.node, npm: finalSnapshot.baseline.npm, agents: finalSnapshot.agents })
      if (failedAgentIds.length) {
        const error = { code: 'AGENT_INSTALL_FAILED', message: `Selected agent installation failed: ${failedAgentIds.join(', ')}`, phase: 'agents', failedAgentIds }
        operationStore.fail(operationId, error, partialResult(operationId, {
          installedHomebrew,
          installedNode,
          hostPath,
          agents,
          baseline: finalSnapshot.baseline,
        }))
        return
      }
      operationStore.succeed(operationId, partialResult(operationId, {
        partialSuccess: false,
        installedHomebrew,
        installedNode,
        agents,
        hostEnvironment: { path: hostPath, firstEntry: hostPath.split(delimiter)[0] || null },
        baseline: finalSnapshot.baseline,
      }))
    } catch (error) {
      if (operationStore.get(operationId)?.status === 'cancelled') return
      const details = failureDetails(error, phase)
      operationStore.failPhase(operationId, phase, details)
      operationStore.appendOutput(operationId, { phase, stream: 'system', text: details.message })
      operationStore.fail(operationId, details, partialResult(operationId, { installedHomebrew, installedNode, hostPath, agents }))
    } finally {
      controls.delete(operationId)
    }
  }

  return Object.freeze({
    async createPlan(input) {
      assertExactInput(input, ['selectedAgentIds'])
      const agentIds = selectedAgents(input.selectedAgentIds)
      const snapshot = await rerunPreflight()
      if (!supported(snapshot)) throw installerError('UNSUPPORTED_PLATFORM', 'Host installation supports macOS arm64 only', snapshot?.support)
      const id = generateId()
      const plan = freeze({
        id,
        selectedAgentIds: agentIds,
        preflightFingerprint: createPreflightFingerprint(snapshot, agentIds),
        preflight: snapshot,
        steps: plannedSteps(snapshot, agentIds),
        disclosures: planDisclosures(snapshot, agentIds),
        createdAt: new Date(now()).toISOString(),
      })
      plans.set(id, plan)
      return plan
    },

    getPlan(id) {
      return plans.get(id) || null
    },

    async startInstall(input) {
      assertExactInput(input, ['planId', 'consent'])
      if (input.consent !== true) throw installerError('CONSENT_REQUIRED', 'Explicit consent is required to install host tools')
      if (typeof input.planId !== 'string' || !plans.has(input.planId)) throw installerError('PLAN_NOT_FOUND', 'The install plan was not found')
      if (consumedPlans.has(input.planId)) throw installerError('PLAN_ALREADY_USED', 'Retry requires a fresh install plan')
      if (starting || operationStore.getActive()) throw installerError('OPERATION_ACTIVE', 'Another host installation operation is active')
      starting = true
      try {
        const plan = plans.get(input.planId)
        const snapshot = await rerunPreflight()
        if (!supported(snapshot)) throw installerError('UNSUPPORTED_PLATFORM', 'Host installation supports macOS arm64 only', snapshot?.support)
        const fingerprint = createPreflightFingerprint(snapshot, plan.selectedAgentIds)
        if (fingerprint !== plan.preflightFingerprint) {
          consumedPlans.add(plan.id)
          throw installerError('STALE_PLAN', 'Host preflight changed; create and consent to a fresh install plan')
        }
        const operationId = generateId()
        controls.set(operationId, { cancel: null })
        const operation = operationStore.create({
          id: operationId,
          planId: plan.id,
          selectedAgentIds: plan.selectedAgentIds,
          steps: plan.steps,
        })
        consumedPlans.add(plan.id)
        const promise = execute(operationId, plan, snapshot)
        running.set(operationId, promise)
        promise.finally(() => running.delete(operationId))
        return operation
      } finally {
        starting = false
      }
    },

    getOperation(id) {
      return operationStore.get(id)
    },

    async waitForOperation(id) {
      const promise = running.get(id)
      if (promise) await promise
      return operationStore.get(id)
    },

    cancelOperation(id) {
      const existing = operationStore.get(id)
      if (!existing) throw installerError('OPERATION_NOT_FOUND', 'Installation operation was not found')
      const requested = operationStore.requestCancellation(id)
      if (requested.accepted) controls.get(id)?.cancel?.()
      return requested.snapshot
    },
  })
}
