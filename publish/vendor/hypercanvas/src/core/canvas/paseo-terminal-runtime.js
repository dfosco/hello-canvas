import {
  classifyPaseoRecoveryState,
  ensurePaseoWorkspaceForRoot,
  getPaseoConnection,
  resetPaseoConnectionForTests,
} from './paseo-runtime-client.js'

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const DEFAULT_SCROLLBACK_LINES = 10_000

export class PaseoTerminalRuntimeError extends Error {
  constructor(message, { operation = null, code = 'PTY_RUNTIME_ERROR', cause } = {}) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'PaseoTerminalRuntimeError'
    this.operation = operation
    this.code = code
  }
}

function runtimeError(operation, code, message, cause) {
  if (cause instanceof PaseoTerminalRuntimeError && cause.operation === operation) return cause
  return new PaseoTerminalRuntimeError(message, { operation, code, cause })
}

function connectionError(connection, operation, message, cause) {
  const state = connection?.getConnectionState?.() || { status: 'unknown' }
  if (typeof cause?.code === 'string' && cause.code.startsWith('WORKSPACE_')) {
    return runtimeError(operation, cause.code, `${message}: ${cause.message}`, cause)
  }
  const unavailable = state.status !== 'connected'
  return runtimeError(
    operation,
    unavailable ? 'PASEO_UNAVAILABLE' : 'DAEMON_REQUEST_FAILED',
    `${message} (connection ${state.status})`,
    cause,
  )
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sessionPayload(value) {
  return isRecord(value) ? value : { sessionId: value }
}

function terminalName(sessionId) {
  return `hypercanvas:${sessionId}`
}

function terminalCommand(payload) {
  const env = Object.entries(payload.env || {})
    .filter(([key, value]) => key && value != null)
    .map(([key, value]) => `${key}=${String(value)}`)
  const program = typeof payload.program === 'string' && payload.program ? payload.program : null
  const args = Array.isArray(payload.args) ? payload.args.map(String) : []
  if (env.length === 0) {
    return {
      ...(program ? { command: program } : {}),
      ...(args.length ? { args } : {}),
    }
  }
  return {
    command: '/usr/bin/env',
    args: [...env, ...(program ? [program] : []), ...args],
  }
}

function commandInDirectory(command, cwd, shell) {
  const quotedDirectory = `'${cwd.replaceAll("'", "'\\''")}'`
  return {
    command: '/bin/sh',
    // The program and its arguments remain argv entries, not shell source.
    args: ['-c', `cd ${quotedDirectory} && exec "$@"`, 'hypercanvas-terminal', command.command || shell || '/bin/sh', ...(command.args || [])],
  }
}

function renderTerminalRows(rows) {
  if (!Array.isArray(rows)) return ''
  return rows.map((row) => Array.isArray(row)
    ? row.map((cell) => typeof cell?.char === 'string' ? cell.char : '').join('').replace(/\s+$/, '')
    : '').join('\n')
}

function renderTerminalState(state, renderAnsi) {
  const scrollback = renderTerminalRows(state?.scrollback)
  const screen = renderTerminalRows(state?.grid)
  return {
    screen,
    text: [scrollback, screen].filter(Boolean).join('\n'),
    ansi: renderAnsi?.({
      ...state,
      scrollback: state?.scrollback || [],
      grid: state?.grid || [],
      cursor: { row: 0, col: 0, hidden: false, ...state?.cursor },
    }) || screen.replaceAll('\n', '\r\n'),
    cols: Number.isFinite(state?.cols) ? state.cols : DEFAULT_COLS,
    rows: Number.isFinite(state?.rows) ? state.rows : DEFAULT_ROWS,
  }
}

function normalizeBinding(binding, reused = false) {
  return {
    sessionId: binding.sessionId,
    workspaceId: binding.workspaceId,
    terminalId: binding.terminalId,
    running: binding.running,
    status: binding.status,
    cols: binding.cols,
    rows: binding.rows,
    expiresAtMs: binding.expiresAtMs,
    verified: binding.verified || false,
    reused,
  }
}

export class PaseoTerminalRuntime {
  constructor(projectRoot, options = {}) {
    if (isRecord(projectRoot)) {
      options = projectRoot
      projectRoot = options.projectRoot
    }
    if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
      throw runtimeError('startup', 'INVALID_PROJECT_ROOT', 'A Hypercanvas project root is required')
    }
    this.projectRoot = projectRoot
    this.env = options.env || process.env
    this.connectionOptions = {
      env: this.env,
      ...(options.url ? { url: options.url } : {}),
      ...(options.password ? { password: options.password } : {}),
      ...(options.authHeader ? { authHeader: options.authHeader } : {}),
    }
    this.connectionFactory = options.connectionFactory || getPaseoConnection
    this.connection = options.connection || null
    this.bindings = new Map()
    this.channels = new Map()
    this.streamUnsubscribe = null
    this.rawUnsubscribe = null
    this.connectionStateUnsubscribe = null
  }

  async start() {
    if (!this.connection) {
      try {
        this.connection = await this.connectionFactory(this.connectionOptions)
      } catch (cause) {
        throw runtimeError(
          'startup',
          'PASEO_UNAVAILABLE',
          'Unable to connect to the configured Paseo daemon',
          cause,
        )
      }
    }
    // The protocol ships with the optional Paseo client. Keep its legacy
    // structured snapshots styled and cursor-correct as well as native restores.
    this.renderSnapshotToAnsi = await import(/* @vite-ignore */ '@getpaseo/protocol/terminal-snapshot')
      .then(module => module.renderTerminalSnapshotToAnsi)
      .catch(() => null)
    this.#installEventRouting()
    return this
  }

  health() {
    const diagnostics = this.connection?.getDiagnostics?.()
    const state = diagnostics?.state || this.connection?.getConnectionState?.() || { status: 'idle' }
    return Promise.resolve({
      engine: 'paseo',
      connected: state.status === 'connected',
      state,
      recoveryState: classifyPaseoRecoveryState(state),
      lastError: diagnostics?.lastError || state.reason || null,
      server: diagnostics?.server || null,
      reconnect: diagnostics?.reconnect || null,
    })
  }

  async create(payload) {
    const input = isRecord(payload) ? payload : {}
    const sessionId = input.sessionId
    if (typeof sessionId !== 'string' || !sessionId) {
      throw runtimeError('create', 'INVALID_SESSION_ID', 'create requires a sessionId')
    }
    const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : this.projectRoot
    try {
      const workspaceId = input.workspaceId
        ? String(input.workspaceId)
        : await ensurePaseoWorkspaceForRoot(this.connection.client, cwd)
      let terminalCwd = cwd
      if (input.workspaceId) {
        const workspace = this.connection.client.workspaces.ref(workspaceId)
        if (!workspace.current()) await workspace.refresh()
        if (!workspace.current()) throw new Error(`Paseo workspace not found: ${workspaceId}`)
        // Paseo's live workspace subscription filters by the registered cwd,
        // even when listTerminals(workspaceId) includes external directories.
        // Register at the Notebook root; execute the command in its real cwd.
        terminalCwd = workspace.current()?.workspaceDirectory || workspace.current()?.directory || cwd
      }
      const existing = this.bindings.get(sessionId)
      if (existing?.workspaceId === workspaceId && existing.cwd === cwd && (existing.terminalCwd || existing.cwd) === terminalCwd && await this.#terminalExists(existing, 'create')) {
        existing.running = true
        existing.status = 'live'
        existing.expiresAtMs = null
        return normalizeBinding(existing, true)
      }
      if (existing) {
        this.#closeChannel(sessionId)
        if (existing.workspaceId !== workspaceId || existing.cwd !== cwd || (existing.terminalCwd || existing.cwd) !== terminalCwd) {
          await this.connection.daemon.killTerminal(existing.terminalId)
        }
        this.bindings.delete(sessionId)
      }
      const name = terminalName(sessionId)
      const listed = await this.connection.daemon.listTerminals(terminalCwd, undefined, { workspaceId })
      let terminal = listed.terminals.find((entry) => entry.name === name && entry.workspaceId === workspaceId && entry.cwd === terminalCwd) || null
      const legacy = terminalCwd !== cwd && listed.terminals.find((entry) => entry.name === name && entry.workspaceId === workspaceId && entry.cwd === cwd)
      if (legacy) await this.connection.daemon.killTerminal(legacy.id)
      let reused = Boolean(terminal)
      if (!terminal) {
        const command = terminalCommand(input)
        const created = await this.connection.daemon.createTerminal(terminalCwd, name, undefined, {
          workspaceId,
          ...(terminalCwd === cwd ? command : commandInDirectory(command, cwd, this.env.SHELL)),
          size: {
            cols: Number.isFinite(input.cols) ? input.cols : DEFAULT_COLS,
            rows: Number.isFinite(input.rows) ? input.rows : DEFAULT_ROWS,
          },
        })
        if (created.error) throw new Error(created.error)
        terminal = created.terminal
        reused = false
      }
      if (!terminal) throw new Error('Paseo created no terminal')
      // Confirm the terminal is visible in the expected workspace — listing
      // scoped by workspaceId must contain the created terminal, otherwise
      // the session would exist outside the Notebook's verified binding.
      const confirmedListing = await this.connection.daemon.listTerminals(terminalCwd, undefined, { workspaceId })
      if (!confirmedListing.terminals.some((entry) => entry.id === terminal.id)) {
        throw new Error(`Paseo terminal ${terminal.id} is not visible in workspace ${workspaceId}`)
      }
      const binding = {
        sessionId,
        workspaceId,
        terminalId: terminal.id,
        cwd,
        terminalCwd,
        cols: Number.isFinite(input.cols) ? input.cols : DEFAULT_COLS,
        rows: Number.isFinite(input.rows) ? input.rows : DEFAULT_ROWS,
        running: true,
        status: 'live',
        expiresAtMs: null,
        sequence: 0,
        verified: true,
      }
      this.bindings.set(sessionId, binding)
      return normalizeBinding(binding, reused)
    } catch (cause) {
      if (cause instanceof PaseoTerminalRuntimeError && cause.operation === 'create') throw cause
      throw connectionError(this.connection, 'create', `Paseo could not create terminal session ${sessionId}`, cause)
    }
  }

  async list() {
    const sessions = await Promise.all([...this.bindings.values()].map(async (binding) => {
      binding.running = await this.#terminalExists(binding, 'list')
      if (!binding.running) binding.status = 'exited'
      return normalizeBinding(binding)
    }))
    return { sessions }
  }

  async exists(sessionId) {
    const { sessionId: id } = sessionPayload(sessionId)
    const binding = this.bindings.get(id)
    const exists = binding ? await this.#terminalExists(binding, 'exists') : false
    if (binding) {
      binding.running = exists
      if (!exists) binding.status = 'exited'
    }
    return { exists }
  }

  async get(sessionId) {
    const { sessionId: id } = sessionPayload(sessionId)
    const binding = this.#binding('get', id)
    binding.running = await this.#terminalExists(binding, 'get')
    return normalizeBinding(binding)
  }

  async writeBytes(sessionId, bytes, clientId) {
    const payload = isRecord(sessionId)
      ? { ...sessionId, bytes: Array.from(sessionId.bytes || []) }
      : { sessionId, bytes: Array.from(bytes || []), clientId }
    const binding = this.#binding('write_bytes', payload.sessionId)
    try {
      const data = Buffer.from(payload.bytes).toString('utf8')
      this.connection.daemon.sendTerminalInput(binding.terminalId, { type: 'input', data })
      return { written: payload.bytes.length }
    } catch (cause) {
      throw connectionError(this.connection, 'write_bytes', `Paseo terminal input failed for ${payload.sessionId}`, cause)
    }
  }

  async resize(sessionId, cols, rows, clientId) {
    const payload = isRecord(sessionId) ? sessionId : { sessionId, cols, rows, clientId }
    const binding = this.#binding('resize', payload.sessionId)
    try {
      this.connection.daemon.sendTerminalInput(binding.terminalId, {
        type: 'resize',
        cols: payload.cols,
        rows: payload.rows,
        intent: 'claim',
      })
      binding.cols = payload.cols
      binding.rows = payload.rows
      return { cols: binding.cols, rows: binding.rows }
    } catch (cause) {
      throw connectionError(this.connection, 'resize', `Paseo terminal resize failed for ${payload.sessionId}`, cause)
    }
  }

  async snapshot(sessionId) {
    const { sessionId: id } = sessionPayload(sessionId)
    const binding = this.#binding('snapshot', id)
    try {
      const captured = await this.connection.daemon.captureTerminal(binding.terminalId, {
        stripAnsi: false,
      })
      const text = Array.isArray(captured.lines) ? captured.lines.join('\n') : ''
      const screen = text.split('\n').slice(-binding.rows).join('\n')
      return {
        sessionId: id,
        cols: binding.cols,
        rows: binding.rows,
        screen,
        text,
        sequence: binding.sequence,
      }
    } catch (cause) {
      throw connectionError(this.connection, 'snapshot', `Paseo terminal capture failed for ${id}`, cause)
    }
  }

  unsubscribe(sessionId, clientId) {
    const payload = isRecord(sessionId) ? sessionId : { sessionId, clientId }
    const channel = this.channels.get(payload.sessionId)
    channel?.subscribers.get(payload.clientId)?.close()
    return Promise.resolve({ unsubscribed: true })
  }

  detach(sessionId, expiresAtMs = null) {
    const payload = isRecord(sessionId) ? sessionId : { sessionId, expiresAtMs }
    const binding = this.#binding('detach', payload.sessionId)
    binding.status = 'background'
    binding.expiresAtMs = payload.expiresAtMs ?? null
    return Promise.resolve(normalizeBinding(binding))
  }

  setExpiry(sessionId, expiresAtMs) {
    const payload = isRecord(sessionId) ? sessionId : { sessionId, expiresAtMs }
    const binding = this.#binding('set_expiry', payload.sessionId)
    binding.expiresAtMs = payload.expiresAtMs ?? null
    return Promise.resolve(normalizeBinding(binding))
  }

  async terminate(sessionId) {
    const input = isRecord(sessionId) ? sessionId : { sessionId }
    const { sessionId: id } = sessionPayload(input)
    const binding = this.bindings.get(id)
    let terminalId = binding?.terminalId || null
    if (!terminalId && input.workspaceId && input.cwd) {
      try {
        const workspace = this.connection.client.workspaces.ref(input.workspaceId)
        if (!workspace.current()) await workspace.refresh()
        const terminalCwd = workspace.current()?.workspaceDirectory || workspace.current()?.directory || input.cwd
        const listed = await this.connection.daemon.listTerminals(terminalCwd, undefined, {
          workspaceId: input.workspaceId,
        })
        terminalId = listed.terminals.find((terminal) => (
          terminal.name === terminalName(id)
          && terminal.workspaceId === input.workspaceId
          && (terminal.cwd === input.cwd || terminal.cwd === terminalCwd)
        ))?.id || null
      } catch (cause) {
        throw connectionError(this.connection, 'terminate', `Paseo could not find terminal session ${id}`, cause)
      }
    }
    if (!terminalId) return { terminated: false }
    try {
      await this.connection.daemon.killTerminal(terminalId)
      this.#closeChannel(id)
      this.bindings.delete(id)
      return { terminated: true }
    } catch (cause) {
      throw connectionError(this.connection, 'terminate', `Paseo could not terminate terminal session ${id}`, cause)
    }
  }

  async cleanup(statuses = []) {
    const payload = isRecord(statuses) ? statuses : { statuses }
    const wanted = new Set(payload.statuses || [])
    const ids = [...this.bindings.values()]
      .filter((binding) => wanted.has(binding.status))
      .map((binding) => binding.sessionId)
    await Promise.all(ids.map((id) => this.terminate(id)))
    return { removed: ids.length, remaining: this.bindings.size }
  }

  async shutdown() {
    for (const sessionId of [...this.channels.keys()]) this.#closeChannel(sessionId)
    this.streamUnsubscribe?.()
    this.rawUnsubscribe?.()
    this.connectionStateUnsubscribe?.()
    this.streamUnsubscribe = null
    this.rawUnsubscribe = null
    this.connectionStateUnsubscribe = null
    await this.connection?.close?.()
    this.connection = null
    if (runtimeInstance === this) runtimeInstance = null
    return { shutdown: true }
  }

  async subscribe(sessionId, options = {}) {
    const payload = isRecord(sessionId) ? sessionId : { sessionId, ...options }
    const callbacks = isRecord(sessionId) ? { ...sessionId, ...options } : options
    const binding = this.#binding('subscribe', payload.sessionId)
    const clientId = payload.clientId || `subscriber-${Math.random().toString(36).slice(2, 10)}`
    let channel = this.channels.get(binding.sessionId)
    if (!channel) {
      channel = { binding, subscribers: new Map(), subscribed: false, subscribing: null, generation: 0 }
      this.channels.set(binding.sessionId, channel)
    }
    let closed = false
    const handle = {
      initial: { generation: 1, sequence: binding.sequence },
      close: () => {
        if (closed) return
        closed = true
        channel.subscribers.delete(clientId)
        callbacks.onClose?.({ closedByClient: true })
        if (channel.subscribers.size === 0) this.#closeChannel(binding.sessionId)
      },
    }
    channel.subscribers.set(clientId, { clientId, callbacks, close: handle.close })
    try {
      const alreadySubscribed = channel.subscribed || channel.subscribing !== null
      await this.#ensureChannelSubscribed(channel, payload.restore === true ? 0 : payload.afterSequence || 0)
      // The service writer keeps the native stream alive across browser reloads.
      // A new viewer still needs a cursor/style-preserving restore, even when
      // the channel was already subscribed. Native restore orders snapshot and
      // subsequent output atomically; captureTerminal text cannot do that.
      if (payload.restore === true && alreadySubscribed) {
        await this.#subscribeChannel(channel, 0, channel.generation)
      }
      return handle
    } catch (cause) {
      channel.subscribers.delete(clientId)
      if (channel.subscribers.size === 0) this.channels.delete(binding.sessionId)
      throw connectionError(this.connection, 'subscribe', `Paseo terminal subscription failed for ${binding.sessionId}`, cause)
    }
  }

  async #subscribeChannel(channel, afterSequence, generation) {
    const response = await this.connection.daemon.subscribeTerminal(channel.binding.terminalId, {
      restore: {
        mode: afterSequence > 0 ? 'live' : 'full-snapshot',
        scrollbackLines: DEFAULT_SCROLLBACK_LINES,
        size: { cols: channel.binding.cols, rows: channel.binding.rows },
      },
    })
    if (response.error) throw new Error(response.error)
    if (channel.generation !== generation) {
      if (this.channels.get(channel.binding.sessionId) !== channel || channel.subscribers.size === 0) return
      throw connectionError(this.connection, 'subscribe', 'Paseo terminal subscription was superseded by connection recovery', new Error('subscription generation changed'))
    }
    if (this.connection.getConnectionState?.()?.status !== 'connected') {
      throw connectionError(this.connection, 'subscribe', 'Paseo connection changed while restoring a terminal stream', new Error('connection state changed'))
    }
    if (this.channels.get(channel.binding.sessionId) !== channel || channel.subscribers.size === 0) {
      try { await this.connection.daemon.unsubscribeTerminal(channel.binding.terminalId) } catch { /* best effort */ }
      return
    }
    channel.subscribed = true
  }

  #ensureChannelSubscribed(channel, afterSequence) {
    if (channel.subscribed) return Promise.resolve()
    if (channel.subscribing) return channel.subscribing
    const pending = this.#subscribeChannel(channel, afterSequence, channel.generation)
    channel.subscribing = pending
    pending.finally(() => {
      if (channel.subscribing === pending) channel.subscribing = null
    }).catch(() => {})
    return pending
  }

  #handleConnectionState(state) {
    if (state?.status === 'connected') {
      for (const channel of this.channels.values()) {
        if (channel.subscribers.size === 0 || channel.subscribed) continue
        this.#ensureChannelSubscribed(channel, 0).catch((cause) => {
          const error = connectionError(this.connection, 'subscribe', 'Paseo could not restore the terminal stream', cause)
          for (const { callbacks } of channel.subscribers.values()) {
            try { callbacks.onError?.(error) } catch { /* listener failure must not stop other recovery */ }
          }
        })
      }
      return
    }

    for (const channel of this.channels.values()) {
      channel.subscribed = false
      if (channel.subscribing) {
        channel.generation += 1
        channel.subscribing = null
      }
    }
    if (state?.status !== 'disconnected') return
    const cause = new Error(state.reason || 'Paseo daemon connection was lost')
    const error = connectionError(this.connection, 'subscribe', 'Paseo terminal connection was interrupted', cause)
    for (const channel of this.channels.values()) {
      for (const { callbacks } of channel.subscribers.values()) {
        try { callbacks.onError?.(error) } catch { /* listener failure must not stop other recovery */ }
      }
    }
  }

  async #terminalExists(binding, operation = 'exists') {
    try {
      const result = await this.connection.daemon.listTerminals(binding.terminalCwd || binding.cwd, undefined, {
        workspaceId: binding.workspaceId,
      })
      return result.terminals.some((terminal) => terminal.id === binding.terminalId)
    } catch (cause) {
      throw connectionError(this.connection, operation, 'Paseo could not verify the terminal binding', cause)
    }
  }

  #binding(operation, sessionId) {
    const binding = this.bindings.get(sessionId)
    if (!binding) throw runtimeError(operation, 'SESSION_NOT_FOUND', `Unknown terminal session ${String(sessionId)}`)
    return binding
  }

  #installEventRouting() {
    if (!this.streamUnsubscribe) {
      this.streamUnsubscribe = this.connection.daemon.onTerminalStreamEvent((event) => {
        const binding = [...this.bindings.values()].find((entry) => entry.terminalId === event.terminalId)
        if (!binding) return
        if (event.type === 'output') {
          binding.sequence += 1
          this.#emit(binding.sessionId, {
            event: 'output',
            sessionId: binding.sessionId,
            sequence: binding.sequence,
            bytes: Array.from(event.data),
          })
          return
        }
        if (event.type === 'restore') {
          binding.sequence += 1
          const text = Buffer.from(event.data).toString('utf8')
          this.#emit(binding.sessionId, {
            event: 'gap',
            sessionId: binding.sessionId,
            sequence: binding.sequence,
            snapshot: { text, screen: text, ansi: text, cols: binding.cols, rows: binding.rows },
          })
          return
        }
        if (event.type === 'snapshot') {
          binding.sequence += 1
          const snapshot = renderTerminalState(event.state, this.renderSnapshotToAnsi)
          binding.cols = snapshot.cols
          binding.rows = snapshot.rows
          this.#emit(binding.sessionId, {
            event: 'gap',
            sessionId: binding.sessionId,
            sequence: binding.sequence,
            snapshot,
          })
        }
      })
    }
    if (!this.rawUnsubscribe) {
      this.rawUnsubscribe = this.connection.daemon.subscribeRawMessages((message) => {
        if (message?.type !== 'terminal_stream_exit') return
        const binding = [...this.bindings.values()].find((entry) => entry.terminalId === message.payload?.terminalId)
        if (!binding) return
        binding.running = false
        binding.status = 'exited'
        this.#emit(binding.sessionId, {
          event: 'exit',
          sessionId: binding.sessionId,
          sequence: binding.sequence,
        })
      })
    }
    if (!this.connectionStateUnsubscribe && typeof this.connection.daemon.subscribeConnectionStatus === 'function') {
      this.connectionStateUnsubscribe = this.connection.daemon.subscribeConnectionStatus((state) => {
        this.#handleConnectionState(state)
      })
    }
  }

  #emit(sessionId, event) {
    const channel = this.channels.get(sessionId)
    if (!channel) return
    for (const { callbacks } of channel.subscribers.values()) {
      try {
        callbacks.onEvent?.(event)
        const callback = callbacks[`on${event.event[0].toUpperCase()}${event.event.slice(1)}`]
        callback?.(event)
      } catch (error) {
        callbacks.onError?.(error)
      }
    }
  }

  #closeChannel(sessionId) {
    const channel = this.channels.get(sessionId)
    if (!channel) return
    channel.generation += 1
    this.channels.delete(sessionId)
    if (channel.subscribed) Promise.resolve(this.connection.daemon.unsubscribeTerminal(channel.binding.terminalId)).catch(() => {})
    for (const { callbacks } of channel.subscribers.values()) callbacks.onClose?.({ closedByClient: false })
    channel.subscribers.clear()
  }
}

export const PaseoTerminalRuntimeClient = PaseoTerminalRuntime

let runtimeInstance = null
let runtimeInitialization = null

export async function initPaseoTerminalRuntime(projectRoot, options = {}) {
  if (runtimeInstance) {
    const state = runtimeInstance.connection?.getConnectionState?.()
    if (runtimeInstance.connection && state?.status !== 'disposed') {
      runtimeInstance.projectRoot = projectRoot
      return runtimeInstance
    }
    const staleRuntime = runtimeInstance
    runtimeInstance = null
    await staleRuntime.shutdown().catch(() => {})
  }
  if (runtimeInitialization) {
    const runtime = await runtimeInitialization
    runtime.projectRoot = projectRoot
    return runtime
  }
  runtimeInitialization = (async () => {
    const runtime = new PaseoTerminalRuntime(projectRoot, options)
    await runtime.start()
    runtimeInstance = runtime
    return runtime
  })()
  try {
    return await runtimeInitialization
  } finally {
    runtimeInitialization = null
  }
}

export function getPaseoTerminalRuntime() {
  if (!runtimeInstance) {
    throw runtimeError('startup', 'NOT_INITIALIZED', 'PTY runtime has not been initialized')
  }
  return runtimeInstance
}

export async function resetPaseoTerminalRuntimeForTests() {
  const active = runtimeInstance
  runtimeInstance = null
  runtimeInitialization = null
  await active?.shutdown().catch(() => {})
  await resetPaseoConnectionForTests()
}
