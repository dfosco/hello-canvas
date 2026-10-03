/**
 * Paseo Agent Runtime — server-side lifecycle for Paseo-backed agent chats.
 *
 * Uses ONLY the public `@getpaseo/client` SDK (loaded dynamically so the
 * feature degrades gracefully when the package is absent). Daemon credentials
 * stay server-side; the browser talks to same-origin /_storyboard/paseo-agents
 * routes and receives events through Vite HMR custom events.
 *
 * Exposes agent lifecycle (create/ref/list/archive), provider discovery,
 * message sends, permission responses, timeline pagination, and turn
 * cancellation — plus event forwarding of `agent_update` and `agent_stream`
 * payloads to the browser.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { classifyPaseoRecoveryState, getPaseoConnection } from './paseo-runtime-client.js'
import { getNotebookPaseoBinding, paseoDaemonOwnership } from './paseo-notebook-binding.js'
import { buildHubBootstrapPrompt, initTerminalConfig, readTerminalConfigById, recordWidgetAgentBinding } from './terminal-config.js'

const AGENT_STREAM_EVENT = 'storyboard:paseo-agent-event'

export const MAX_TEXT_LENGTH = 32_000

/** Env marker distinguishing Paseo agent-chat sessions from terminal PTY sessions. */
export const AGENT_SURFACE_CHAT = 'agent-chat'

let runtime = null
let runtimePromise = null
let runtimeRoot = null
let runtimePromiseRoot = null
let runtimeWsSend = null
let runtimePromiseWsSend = null
let runtimeConnection = null
let runtimeDaemon = null
const runtimeStateByApi = new WeakMap()

/**
 * Resolve canvas identity for an agent created by an agent-chat widget.
 * The browser only knows its widgetId — the terminal config written at widget
 * creation carries canvasId, branch, and serverUrl. Returns null when the
 * widget has no config (e.g. chat created outside a canvas widget).
 */
function resolveWidgetAgentContext(context, root, workspaceId) {
  const widgetId = typeof context?.widgetId === 'string' ? context.widgetId : ''
  if (!widgetId) return null
  const terminalConfig = readTerminalConfigById(widgetId)
  const env = {
    STORYBOARD_WIDGET_ID: widgetId,
    STORYBOARD_CANVAS_ID: terminalConfig?.canvasId || '',
    STORYBOARD_BRANCH: terminalConfig?.branch || '',
    STORYBOARD_SERVER_URL: terminalConfig?.serverUrl || '',
    PASEO_WORKSPACE_ID: workspaceId || '',
    STORYBOARD_PROJECT_ROOT: root,
    STORYBOARD_AGENT_SURFACE: AGENT_SURFACE_CHAT,
  }
  const promptParts = []
  if (existsSync(join(root, '.agents', 'agent-widget.agent.md'))) {
    promptParts.push('Before starting, read `.agents/agent-widget.agent.md` when it exists and follow its behavioral guidance.')
  }
  const explicitPrompt = terminalConfig?.widgetProps?.initialPrompt || terminalConfig?.widgetProps?.prompt
  if (typeof explicitPrompt === 'string' && explicitPrompt.trim()) {
    promptParts.push(explicitPrompt)
  }
  const hubPrompt = buildHubBootstrapPrompt(terminalConfig, widgetId, 'agent-widget')
  if (hubPrompt) promptParts.push(hubPrompt)
  const seen = new Set()
  const prompt = promptParts
    .filter((part) => {
      const key = part.trim()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join('\n\n')
  return {
    widgetId,
    workspaceId: workspaceId || null,
    terminalConfig,
    env,
    prompt: prompt || null,
  }
}

/**
 * Forward an agent event to every connected browser via Vite custom HMR event.
 * Events carry their kind so the client store can reconcile updates
 * (agent snapshot) and streams (timeline deltas) independently.
 */
function forwardEvent(wsSend, agentId, kind, payload) {
  wsSend?.({
    type: 'custom',
    event: AGENT_STREAM_EVENT,
    data: { agentId, kind, payload },
  })
}

export async function initPaseoAgentRuntime(options = {}) {
  const rootKey = String(options.root || '')
  const connectionState = runtimeConnection?.getConnectionState?.() || runtimeDaemon?.getConnectionState?.()
  if (runtime && runtimeRoot === rootKey && runtimeWsSend === options.wsSend && connectionState?.status !== 'disposed') return runtime
  if (runtimePromise && runtimePromiseRoot === rootKey && runtimePromiseWsSend === options.wsSend) return runtimePromise
  if (runtime) runtime.close()
  if (runtimePromise && (runtimePromiseRoot !== rootKey || runtimePromiseWsSend !== options.wsSend)) {
    runtimePromise = null
    runtimePromiseRoot = null
    runtimePromiseWsSend = null
  }

  const pending = (async () => {
    const wsSend = options.wsSend || null
    // Reuse the shared Paseo connection (already isolated from the Vite client
    // graph) unless a test injects a fake client/daemon pair.
    const injectedDaemon = Boolean(options.daemon)
    const injectedClient = Boolean(options.client)
    let connection = null
    let daemon = options.daemon || null
    let client = options.client || null
    if (!injectedClient) {
      connection = await getPaseoConnection(options.connectionOptions || {})
      client = connection.client
      daemon = connection.daemon
    }
    if (injectedDaemon && !injectedClient) {
      // A bare injected daemon still needs the public API wrapper.
      const sdkModule = await import(/* @vite-ignore */ '@getpaseo/client').catch(() => null)
      const createApi = sdkModule?.createPaseoApi
      if (!createApi) throw new Error('The Paseo SDK is unavailable. Install @getpaseo/client@0.8.0-beta.1.')
      client = createApi(daemon)
    }
    if (injectedDaemon && !options.daemonReady) await daemon.connect()

    const handles = new Map()

    function getHandle(agentId) {
      const agentIdSafe = String(agentId || '')
      if (!agentIdSafe) throw new Error('agentId is required')
      let entry = handles.get(agentIdSafe)
      if (!entry) {
        const handle = client.agents.ref(agentIdSafe)
        const unsubs = [
          handle.subscribe((update) => forwardEvent(wsSend, agentIdSafe, 'update', update)),
          handle.timeline.subscribe((event) => forwardEvent(wsSend, agentIdSafe, 'stream', event)),
        ]
        entry = { handle, unsubs }
        handles.set(agentIdSafe, entry)
      }
      return entry.handle
    }

    let runtimeApi
    runtimeApi = {
      eventKind: AGENT_STREAM_EVENT,
      async health() {
        const diagnostics = connection?.getDiagnostics?.()
        const state = diagnostics?.state || daemon?.getConnectionState?.() || { status: 'idle' }
        return {
          available: Boolean(client),
          connected: state.status === 'connected',
          connection: state,
          recoveryState: classifyPaseoRecoveryState(state),
          lastError: diagnostics?.lastError || state.reason || null,
          server: diagnostics?.server || null,
          reconnect: diagnostics?.reconnect || null,
          agents: handles.size,
          daemonOwnership: paseoDaemonOwnership(),
          workspace: getNotebookPaseoBinding(),
        }
      },
      async resolveWorkspaceId() {
        if (typeof options.workspaceIdResolver === 'function') {
          return await options.workspaceIdResolver(client, options.root)
        }
        return options.workspaceId || null
      },
      // Provider discovery — feeds the pre-launch picker
      async listAvailableProviders() {
        return client.providers.listAvailable({})
      },
      async listModels(provider) {
        if (!provider) throw new Error('provider is required')
        return client.providers.listModels(provider, {})
      },
      async createAgent({ config, title, context } = {}) {
        if (!config?.provider) throw new Error('config.provider is required')
        // Canvas-bound chats get identity env + a startup prompt so the agent
        // knows who it is, which canvas it lives on, and what it's connected
        // to — mirroring what terminal PTY sessions get via prepareTerminalFiles.
        initTerminalConfig(options.root)
        const workspaceId = await runtimeApi.resolveWorkspaceId()
        if (!workspaceId) {
          const error = new Error('Agent creation requires an explicit Paseo workspaceId')
          error.code = 'WORKSPACE_REQUIRED'
          throw error
        }
        if (context?.workspaceId && context.workspaceId !== workspaceId) {
          const error = new Error('Agent workspaceId does not match the active Notebook workspace')
          error.code = 'WORKSPACE_MISMATCH'
          throw error
        }
        const widgetContext = resolveWidgetAgentContext(context, options.root, workspaceId)
        const workspace = client.workspaces.ref(workspaceId)
        const createAgent = (input) => workspace.agents.create(input)
        const handle = await createAgent({
          config,
          ...(title ? { title } : {}),
          ...(widgetContext ? { env: widgetContext.env } : {}),
          ...(widgetContext?.prompt ? { prompt: widgetContext.prompt } : {}),
        })
        // Confirm the agent is visible in the expected workspace. The daemon
        // mirrors workspaceId on the snapshot; a reported mismatch means the
        // agent did not land where the Notebook's binding says it must. When
        // the daemon has not reported one yet, verification stays open rather
        // than failing an otherwise healthy session.
        const observed = handle.current()
        let observedWorkspaceId = observed?.workspaceId ?? handle.workspaceId ?? null
        if (!observedWorkspaceId) {
          // No snapshot yet — one bounded, best-effort refresh to confirm.
          try {
            await Promise.race([
              handle.refresh(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Agent workspace confirmation timed out')), 5_000)),
            ])
            observedWorkspaceId = handle.current()?.workspaceId ?? handle.workspaceId ?? null
          } catch { /* daemon will report it on the next update stream */ }
        }
        const verifiedInWorkspace = observedWorkspaceId == null ? null : observedWorkspaceId === workspaceId
        if (verifiedInWorkspace === false) {
          const error = new Error(`Agent ${handle.id} was created in workspace ${observedWorkspaceId}, expected ${workspaceId}`)
          error.code = 'WORKSPACE_MISMATCH'
          throw error
        }
        getHandle(handle.id)
        if (widgetContext) {
          recordWidgetAgentBinding({ widgetId: widgetContext.widgetId, agentId: handle.id })
        }
        return { agent: handle.current() || { id: handle.id }, workspaceId, verifiedInWorkspace }
      },
      async getAgent(agentId) {
        const handle = getHandle(agentId)
        const result = await handle.refresh()
        return { agent: result?.agent || handle.current() || { id: handle.id } }
      },
      async listAgents({ subscribe } = {}) {
        return client.agents.list({ ...(subscribe ? { subscribe: {} } : {}) })
      },
      async sendMessage(agentId, text, { messageId } = {}) {
        if (!text || typeof text !== 'string') throw new Error('text is required')
        if (text.length > MAX_TEXT_LENGTH) throw new Error(`text exceeds ${MAX_TEXT_LENGTH} characters`)
        const handle = getHandle(agentId)
        await handle.send(text, { ...(messageId ? { messageId } : {}) })
        return { ok: true }
      },
      async cancelTurn(agentId) {
        // The public handle owns no cancel RPC; turn interruption goes through
        // the same daemon client the SDK connection wraps.
        if (!daemon?.cancelAgent) throw new Error('Turn cancellation is unavailable on this Paseo daemon')
        await daemon.cancelAgent(String(agentId))
        return { ok: true }
      },
      async respondToPermission(agentId, { requestId, response } = {}) {
        if (!requestId) throw new Error('requestId is required')
        if (!response || (response.behavior !== 'allow' && response.behavior !== 'deny')) {
          throw new Error('response.behavior must be "allow" or "deny"')
        }
        const handle = getHandle(agentId)
        await handle.respondToPermission({ requestId, response })
        return { ok: true }
      },
      async fetchTimeline(agentId, { direction, cursor, limit, projection } = {}) {
        const handle = getHandle(agentId)
        const optionsTimeline = {
          projection: projection || 'projected',
          ...(limit ? { limit: Math.min(Number(limit) || 0, 200) } : {}),
          ...(direction ? { direction } : {}),
          ...(cursor ? { cursor } : {}),
        }
        return handle.timeline.refetch(optionsTimeline)
      },
      async archiveAgent(agentId) {
        const handle = getHandle(agentId)
        return handle.archive()
      },
      close() {
        for (const [, entry] of handles) {
          for (const unsub of entry.unsubs) {
            try { unsub() } catch { /* best effort */ }
          }
        }
        handles.clear()
        // Never close the shared connection — terminal PTY sessions use it.
        // Only test-injected daemons are torn down here.
        if (injectedDaemon) {
          try { daemon?.close() } catch { /* best effort */ }
        }
        if (runtime === runtimeApi) {
          runtime = null
          runtimeRoot = null
          runtimeWsSend = null
          runtimeConnection = null
          runtimeDaemon = null
        }
        runtimeStateByApi.delete(runtimeApi)
      },
    }
    runtimeStateByApi.set(runtimeApi, { connection, daemon })
    return runtimeApi
  })()
  runtimePromise = pending
  runtimePromiseRoot = rootKey
  runtimePromiseWsSend = options.wsSend
  try {
    const nextRuntime = await pending
    if (runtimePromise === pending) {
      runtime = nextRuntime
      runtimeRoot = rootKey
      runtimeWsSend = options.wsSend
      const state = runtimeStateByApi.get(nextRuntime)
      runtimeConnection = state?.connection || null
      runtimeDaemon = state?.daemon || null
    } else {
      nextRuntime.close()
    }
    return nextRuntime
  } finally {
    if (runtimePromise === pending) {
      runtimePromise = null
      runtimePromiseRoot = null
      runtimePromiseWsSend = null
    }
  }
}

/**
 * Get (or lazily create) the runtime. Returns null when the Paseo SDK is
 * unavailable so callers can serve diagnostics instead of crashing.
 */
export async function getPaseoAgentRuntime(options = {}) {
  try {
    return await initPaseoAgentRuntime(options)
  } catch (err) {
    if (options.silent !== false) return null
    throw err
  }
}

export function disposePaseoAgentRuntime() {
  const active = runtime
  runtime = null
  runtimePromise = null
  runtimeRoot = null
  runtimePromiseRoot = null
  runtimeWsSend = null
  runtimePromiseWsSend = null
  runtimeConnection = null
  runtimeDaemon = null
  active?.close()
}

export const _resetPaseoAgentRuntime = disposePaseoAgentRuntime
