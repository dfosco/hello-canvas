import { useRef, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { AgentChatStore } from '../../core/agent-chat/agent-chat-store.js'
import { agentChatTransport } from '../../core/agent-chat/agent-chat-client.js'
import { storyboardWs } from '../storyboard-ws.js'

/**
 * React hook for a Paseo-backed agent conversation.
 *
 * Creates and manages an AgentChatStore instance bound to an optional agentId.
 * Subscribes to the Hypercanvas server WebSocket for real-time updates.
 * Returns { state, actions } where state is the store snapshot and actions
 * dispatch into the store (send, cancel, respondToPermission, loadOlder, etc.).
 *
 * Usage:
 *   const chat = useAgentChat({ agentId, onAgentIdChange })
 *   // chat.state.items, chat.state.head, chat.state.permissions
 *   // chat.actions.send('hello'), chat.actions.cancel()
 */
export function useAgentChat({ agentId, widgetId, onAgentIdChange, transport } = {}) {
  const activeTransport = transport || agentChatTransport
  const storeRef = useRef(null)
  if (!storeRef.current) {
    storeRef.current = new AgentChatStore({ transport: activeTransport })
  }
  const store = storeRef.current

  const prevAgentIdRef = useRef(agentId)
  const [providers, setProviders] = useState([])
  const [providersError, setProvidersError] = useState('')
  const [models, setModels] = useState([])
  const [modelsError, setModelsError] = useState('')
  const [loadingModels, setLoadingModels] = useState(false)
  const [creationError, setCreationError] = useState('')

  useEffect(() => {
    let cancelled = false
    activeTransport.listAvailableProviders()
      .then((result) => {
        if (cancelled) return
        setProviders((result?.providers || []).filter((provider) => provider?.available))
        setProvidersError(result?.error || '')
      })
      .catch((error) => {
        if (!cancelled) setProvidersError(error.message || 'Could not load Paseo providers')
      })
    return () => { cancelled = true }
  }, [activeTransport])
  useEffect(() => {
    if (agentId !== prevAgentIdRef.current) {
      prevAgentIdRef.current = agentId
      if (agentId) {
        store.setAgentId(agentId)
        store.initialize({ agentId })
      }
    }
  }, [agentId, store])

  useEffect(() => {
    if (agentId && !store.state.initialized) {
      store.initialize({ agentId })
    }
  }, [agentId, store])

  useEffect(() => {
    const handler = (event) => {
      if (!event || typeof event !== 'object') return
      const { agentId: eventAgentId, kind, payload } = event
      if (agentId && eventAgentId !== agentId) return
      if (kind === 'stream' && payload) {
        if (store.enqueueStreamEvent(payload)) store.catchUpIfNeeded()
      } else if (kind === 'update' && payload) {
        if (store.enqueueStreamEvent({ type: 'agent_snapshot', ...payload })) store.catchUpIfNeeded()
      }
    }
    storyboardWs.on('storyboard:paseo-agent-event', handler)
    return () => storyboardWs.off('storyboard:paseo-agent-event', handler)
  }, [agentId, store])

  const state = useSyncExternalStore(store.subscribe.bind(store), store.getSnapshot.bind(store))

  useEffect(() => {
    if (!agentId || !state.turnActive) return
    const timer = setInterval(() => { store.initialize() }, 1000)
    return () => clearInterval(timer)
  }, [agentId, state.turnActive, store])

  const actions = useMemo(() => ({
    send: (text) => store.send(text),
    cancel: () => store.cancel(),
    respondToPermission: (requestId, behavior) => store.respondToPermission(requestId, behavior),
    loadOlder: () => store.loadOlder(),
    catchUp: () => store.catchUpIfNeeded(),
    initialize: (opts) => store.initialize(opts),
    setAgentId: (id) => {
      store.setAgentId(id)
      onAgentIdChange?.(id)
    },
    createAgent: async (config, title) => {
      setCreationError('')
      try {
        const result = await activeTransport.createAgent(
          config,
          title,
          widgetId ? { widgetId } : undefined,
        )
        if (result?.agent?.id) {
          store.setAgentId(result.agent.id)
          onAgentIdChange?.(result.agent.id)
          await store.initialize({ agentId: result.agent.id })
        }
        return result
      } catch (error) {
        setCreationError(error.message || 'Could not create agent')
        throw error
      }
    },
    loadModels: async (provider) => {
      if (!provider) {
        setModels([])
        setModelsError('')
        return []
      }
      setLoadingModels(true)
      setModelsError('')
      try {
        const result = await activeTransport.listModels(provider)
        const availableModels = result?.models || []
        setModels(availableModels)
        if (result?.error) setModelsError(result.error)
        return availableModels
      } catch (error) {
        setModels([])
        setModelsError(error.message || 'Could not load models')
        return []
      } finally {
        setLoadingModels(false)
      }
    },
  }), [store, widgetId, onAgentIdChange, activeTransport])

  return { state, actions, providers, providersError, models, modelsError, loadingModels, creationError }
}
