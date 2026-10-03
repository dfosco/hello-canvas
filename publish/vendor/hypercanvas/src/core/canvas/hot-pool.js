/** Pre-warmed Hypercanvas PTY sessions for terminals, prompts, and agents. */

import { buildHostWorkloadEnv, resolveAgentHostRuntime, resolveTerminalHostRuntime } from '../host-tools/runtime.js'
import { devLog } from '../logger/devLogger.js'
import { captureFilePath, clearCaptureFile, readCapturedSessionId } from './agent-session.js'
import {
  createTerminalSession,
  terminalSessionExists,
  terminateTerminalSession,
} from './terminal-runtime.js'

const DEFAULT_POOL_SIZE = 1
const DEFAULT_MAX_POOL_SIZE = 3
const DEFAULT_COOLDOWN_MINS = 10
const HEALTH_CHECK_INTERVAL_MS = 30_000

export class HotPool {
  #queue = []
  #acquired = new Map()
  #root
  #poolId
  #poolSize
  #maxPoolSize
  #cooldownMs
  #enabled
  #verbose
  #loadBalancer
  #filling = false
  #healthTimer = null
  #prereqsAvailable = null
  #wsSend
  #agentId
  #hostRuntime = null
  #pressured = false
  #cooldownTimer = null
  #workspaceIdResolver

  constructor({ root, poolId = 'terminal', config = {}, agentId = null, wsSend = null, workspaceIdResolver = null }) {
    config = config && typeof config === 'object' ? config : {}
    this.#root = root
    this.#poolId = poolId
    this.#poolSize = Math.max(0, config.pool_size ?? DEFAULT_POOL_SIZE)
    this.#maxPoolSize = Math.max(this.#poolSize, config.max_pool_size ?? DEFAULT_MAX_POOL_SIZE)
    this.#cooldownMs = (config.load_balancer_cooldown_mins ?? DEFAULT_COOLDOWN_MINS) * 60_000
    this.#enabled = config.enabled !== false
    this.#verbose = Boolean(config.verbose)
    this.#loadBalancer = config.load_balancer !== false
    this.#wsSend = wsSend
    this.#agentId = agentId
    this.#workspaceIdResolver = workspaceIdResolver
  }

  get poolId() { return this.#poolId }
  get isAgentPool() { return Boolean(this.#agentId) }
  get #fillTarget() { return this.#loadBalancer && this.#pressured ? this.#maxPoolSize : this.#poolSize }

  #log(message) {
    if (this.#verbose) console.log(`[hot-pool:${this.#poolId}] ${message}`)
    this.#wsSend?.({
      type: 'custom',
      event: 'storyboard:hot-pool-log',
      data: { poolId: this.#poolId, message, timestamp: Date.now() },
    })
  }

  async start() {
    if (!this.#enabled || this.#poolSize === 0) return
    try {
      this.#hostRuntime = this.#agentId
        ? await resolveAgentHostRuntime(this.#root, this.#agentId)
        : resolveTerminalHostRuntime(this.#root)
      this.#prereqsAvailable = true
    } catch (error) {
      this.#prereqsAvailable = false
      this.#log(`${error.message}; pool disabled`)
      return
    }
    await this.#fill()
    this.#healthTimer = setInterval(() => this.#healthCheck().catch(() => {}), HEALTH_CHECK_INTERVAL_MS)
    this.#healthTimer.unref?.()
  }

  stop() {
    if (this.#healthTimer) clearInterval(this.#healthTimer)
    if (this.#cooldownTimer) clearTimeout(this.#cooldownTimer)
    this.#healthTimer = null
    this.#cooldownTimer = null
    for (const session of [...this.#queue, ...this.#acquired.values()]) this.#killSession(session)
    this.#queue = []
    this.#acquired.clear()
    this.#pressured = false
  }

  peek() {
    return { ready: this.#enabled && this.#queue.some((session) => session.state === 'ready') }
  }

  acquire() {
    const index = this.#queue.findIndex((session) => session.state === 'ready')
    if (!this.#enabled || index === -1) return null
    const session = this.#queue.splice(index, 1)[0]
    session.state = 'acquired'
    this.#acquired.set(session.id, session)
    if (!this.#queue.some((candidate) => candidate.state === 'ready')) this.#pressured = true
    this.#resetCooldown()
    this.#fill().catch(() => {})
    return session
  }

  getCapturedSessionId(sessionId) {
    return sessionId ? readCapturedSessionId(captureFilePath(this.#root, `pool-${sessionId}`)) : null
  }

  clearCapturedSessionId(sessionId) {
    if (sessionId) clearCaptureFile(captureFilePath(this.#root, `pool-${sessionId}`))
  }

  consume(sessionId) {
    const session = this.#acquired.get(sessionId)
    if (!session) return
    session.state = 'consumed'
    this.#acquired.delete(sessionId)
  }

  release(sessionId) {
    const session = this.#acquired.get(sessionId)
    if (!session) return
    terminalSessionExists(session.runtimeSessionId).then((exists) => {
      if (this.#acquired.get(sessionId) !== session) return
      this.#acquired.delete(sessionId)
      if (exists && this.#enabled) {
        session.state = 'ready'
        this.#queue.push(session)
      } else this.#killSession(session)
    }).catch(() => {
      if (this.#acquired.get(sessionId) !== session) return
      this.#acquired.delete(sessionId)
      this.#killSession(session)
    })
  }

  status() {
    return {
      poolId: this.#poolId,
      enabled: this.#enabled,
      prereqsAvailable: this.#prereqsAvailable,
      isAgentPool: this.isAgentPool,
      pressured: this.#pressured,
      config: {
        pool_size: this.#poolSize,
        max_pool_size: this.#maxPoolSize,
        load_balancer: this.#loadBalancer,
        load_balancer_cooldown_mins: this.#cooldownMs / 60_000,
        verbose: this.#verbose,
      },
      queue: this.#queue.map((session) => ({ id: session.id, state: session.state, age: Date.now() - session.createdAt })),
      acquired: this.#acquired.size,
      ready: this.#queue.filter((session) => session.state === 'ready').length,
      fillTarget: this.#fillTarget,
    }
  }

  async reconfigure(config) {
    config = config && typeof config === 'object' ? config : {}
    const wasEnabled = this.#enabled
    if (config.max_pool_size != null) this.#maxPoolSize = Math.max(0, config.max_pool_size)
    if (config.load_balancer_cooldown_mins != null) this.#cooldownMs = config.load_balancer_cooldown_mins * 60_000
    if (config.load_balancer != null) this.#loadBalancer = Boolean(config.load_balancer)
    if (config.verbose != null) this.#verbose = Boolean(config.verbose)
    this.#poolSize = Math.min(Math.max(0, config.pool_size ?? this.#poolSize), this.#maxPoolSize)
    const enabled = config.enabled !== false
    if (!enabled && this.#enabled) this.stop()
    this.#enabled = enabled
    while (this.#queue.length > this.#fillTarget) this.#killSession(this.#queue.pop())
    if (enabled && !wasEnabled) return this.start()
    if (enabled) return this.#fill()
  }

  #resetCooldown() {
    if (this.#cooldownTimer) clearTimeout(this.#cooldownTimer)
    this.#cooldownTimer = setTimeout(() => {
      this.#pressured = false
      while (this.#queue.length > this.#poolSize) this.#killSession(this.#queue.pop())
    }, this.#cooldownMs)
    this.#cooldownTimer.unref?.()
  }

  async #fill() {
    if (this.#filling || !this.#enabled || !this.#prereqsAvailable) return
    this.#filling = true
    try {
      while (this.#queue.length < this.#fillTarget && this.#queue.length + this.#acquired.size < this.#maxPoolSize) {
        const session = await this.#spawnWarmSession()
        if (!session) break
        this.#queue.push(session)
      }
    } finally {
      this.#filling = false
    }
  }

  async #spawnWarmSession() {
    const id = `${this.#poolId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const runtimeSessionId = `sb-pool-${id}`
    const session = { id, poolId: this.#poolId, runtimeSessionId, createdAt: Date.now(), state: 'warming' }
    try {
      const program = this.#hostRuntime.shell
      const args = []
      const env = buildHostWorkloadEnv(this.#hostRuntime, {
        TERM_PROGRAM: 'storyboard',
        STORYBOARD_WIDGET_ID: `pool-${id}`,
        STORYBOARD_PROJECT_ROOT: this.#root,
      })
      env.FORCE_COLOR = '3'
      env.COLORTERM = 'truecolor'
      const workspaceId = await this.#workspaceIdResolver?.(this.#root)
      await createTerminalSession(runtimeSessionId, {
        runtimeSessionId,
        program,
        args,
        cwd: this.#hostRuntime.cwd,
        env,
        ...(workspaceId ? { workspaceId } : {}),
        cols: 80,
        rows: 24,
      })
      session.state = 'ready'
      return session
    } catch (error) {
      this.#log(`warm session ${id} failed: ${error.message}`)
      await terminateTerminalSession(runtimeSessionId).catch(() => {})
      return null
    }
  }

  async #healthCheck() {
    const checks = await Promise.all(this.#queue.map(async (session) => ({
      session,
      healthy: await terminalSessionExists(session.runtimeSessionId).catch(() => false),
    })))
    this.#queue = checks.filter(({ healthy }) => healthy).map(({ session }) => session)
    for (const { session, healthy } of checks) if (!healthy) session.state = 'dead'
    await this.#fill()
  }

  #killSession(session) {
    if (!session) return
    session.state = 'dead'
    terminateTerminalSession(session.runtimeSessionId).catch(() => {})
  }
}

const STAGGER_DELAY_MS = 5000

export class HotPoolManager {
  #pools = new Map()
  #enabled

  constructor({ root, config = {}, agentsConfig = {}, promptAgentId = null, wsSend = null, workspaceIdResolver = null }) {
    config = config && typeof config === 'object' ? config : {}
    agentsConfig = agentsConfig && typeof agentsConfig === 'object' ? agentsConfig : {}
    this.#enabled = config.enabled !== false
    const pools = config.pools || {}
    const merged = (poolId) => ({
      pool_size: pools[poolId]?.pool_size ?? config.default_pool_size ?? DEFAULT_POOL_SIZE,
      max_pool_size: pools[poolId]?.max_pool_size ?? config.default_max_pool_size ?? DEFAULT_MAX_POOL_SIZE,
      load_balancer_cooldown_mins: config.load_balancer_cooldown_mins ?? DEFAULT_COOLDOWN_MINS,
      load_balancer: config.load_balancer !== false,
      enabled: this.#enabled,
      verbose: Boolean(config.verbose),
    })
    this.#pools.set('terminal', new HotPool({ root, poolId: 'terminal', config: merged('terminal'), wsSend, workspaceIdResolver }))
    const promptAgent = promptAgentId
      ? [promptAgentId, agentsConfig?.[promptAgentId]]
      : (Object.entries(agentsConfig || {}).find(([, candidate]) => candidate?.default) || Object.entries(agentsConfig || {})[0])
    this.#pools.set('prompt', new HotPool({
      root,
      poolId: 'prompt',
      config: merged('prompt'),
      agentId: promptAgent?.[1]?.startupCommand ? promptAgent[0] : '__missing_prompt_agent__',
      wsSend,
      workspaceIdResolver,
    }))
    for (const [id, agentConfig] of Object.entries(agentsConfig || {})) {
      if (agentConfig?.startupCommand) this.#pools.set(id, new HotPool({ root, poolId: id, config: merged(id), agentId: id, wsSend, workspaceIdResolver }))
    }
  }

  async start() {
    if (!this.#enabled) return
    const pools = [...this.#pools.values()]
    await Promise.all(pools.filter((pool) => !pool.isAgentPool).map((pool) => pool.start()))
    const agents = pools.filter((pool) => pool.isAgentPool)
    for (let index = 0; index < agents.length; index += 1) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, STAGGER_DELAY_MS))
      agents[index].start().catch((error) => devLog().logEvent('error', `Hot pool ${agents[index].poolId} failed`, { error: error.message }))
    }
  }

  stop() { for (const pool of this.#pools.values()) pool.stop() }
  acquire(poolId) { return this.#pools.get(poolId)?.acquire() || null }
  peek(poolId) { return this.#pools.get(poolId)?.peek() || { ready: false } }
  consume(poolId, sessionId) { this.#pools.get(poolId)?.consume(sessionId) }
  release(poolId, sessionId) { this.#pools.get(poolId)?.release(sessionId) }
  getCapturedSessionId(poolId, sessionId) { return this.#pools.get(poolId)?.getCapturedSessionId(sessionId) || null }
  clearCapturedSessionId(poolId, sessionId) { this.#pools.get(poolId)?.clearCapturedSessionId(sessionId) }
  has(poolId) { return this.#pools.has(poolId) }
  get poolIds() { return [...this.#pools.keys()] }
  status() { return { enabled: this.#enabled, pools: Object.fromEntries([...this.#pools].map(([id, pool]) => [id, pool.status()])) } }
  async reconfigure(config) {
    config = config && typeof config === 'object' ? config : {}
    this.#enabled = config.enabled !== false
    const pools = config.pools || {}
    const merged = (poolId) => ({
      pool_size: pools[poolId]?.pool_size ?? config.default_pool_size ?? this.#pools.get(poolId)?.status().config.pool_size,
      max_pool_size: pools[poolId]?.max_pool_size ?? config.default_max_pool_size,
      load_balancer_cooldown_mins: config.load_balancer_cooldown_mins,
      load_balancer: config.load_balancer,
      enabled: this.#enabled,
      verbose: config.verbose,
    })
    await Promise.all([...this.#pools].map(([id, pool]) => pool.reconfigure(merged(id))))
  }
}
