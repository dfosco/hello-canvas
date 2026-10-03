import { useRef, useEffect, useCallback, useState } from 'react'
import styles from './AgentChat.module.css'

export function AgentChat({ chat, providers, providersError, className, onOpenInTab }) {
  const { state, actions } = chat
  const listRef = useRef(null)
  const composerRef = useRef(null)
  const [draft, setDraft] = useState('')
  const [forceProviderSelection, setForceProviderSelection] = useState(false)
  const [providerDraft, setProviderDraft] = useState('')
  const [modelDraft, setModelDraft] = useState('')
  const isNearBottomRef = useRef(true)

  const selectingProvider = forceProviderSelection || !state.agentId

  // Auto-scroll to bottom when new items arrive and user is near bottom.
  useEffect(() => {
    if (isNearBottomRef.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [state.items.length, state.head.length, state.permissions.length])

  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isNearBottomRef.current = distFromBottom < 80
    // Load older when near top.
    if (el.scrollTop < 60 && state.olderAvailable) {
      actions.loadOlder()
    }
  }, [state.olderAvailable, actions])

  const handleSend = useCallback(() => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    actions.send(text)
  }, [draft, actions])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    e.stopPropagation()
  }, [handleSend])

  const handlePermission = useCallback((requestId, behavior) => {
    actions.respondToPermission(requestId, behavior)
  }, [actions])

  const handleCreateAgent = useCallback(async () => {
    if (!providerDraft.trim() || !modelDraft) return
    const provider = providerDraft.trim()
    try {
      await actions.createAgent({ provider: `${provider}/${modelDraft}` }, `Chat: ${provider}`)
      setForceProviderSelection(false)
    } catch {
      // The store surfaces connection and provider errors in state.
    }
  }, [providerDraft, modelDraft, actions])

  const chooseProvider = useCallback(async (provider) => {
    setProviderDraft(provider)
    setModelDraft('')
    const models = await actions.loadModels(provider)
    setModelDraft(models[0]?.id || '')
  }, [actions])

  const handleNewChat = useCallback(() => {
    setForceProviderSelection(true)
    setProviderDraft('')
    setModelDraft('')
    actions.setAgentId('')
  }, [actions])

  // Provider/model selection screen.
  if (selectingProvider || !state.agentId) {
    return (
      <div className={`${styles.container} ${className || ''}`}>
        <div className={styles.launcher}>
          <h3 className={styles.launcherTitle}>New Agent Chat</h3>
          <p className={styles.launcherDescription}>Choose a CLI configured in your local Paseo daemon.</p>
          <div className={styles.providerPresets}>
            {(providers || []).map((provider) => {
              const id = provider.provider || provider.id || provider.name
              return (
                <button
                  key={id}
                  className={`${styles.presetBtn} ${providerDraft === id ? styles.presetBtnSelected : ''}`}
                  onClick={() => chooseProvider(id)}
                >
                  {provider.label || id}
                </button>
              )
            })}
          </div>
          {!providers?.length && !providersError && <p className={styles.loading}>Looking for configured Paseo CLIs…</p>}
          {providerDraft && (
            <label className={styles.label}>
              Model routed by {providerDraft}
              <select
                className={styles.input}
                value={modelDraft}
                onChange={(event) => setModelDraft(event.target.value)}
                disabled={chat.loadingModels || !chat.models.length}
              >
                <option value="">{chat.loadingModels ? 'Loading models…' : 'Choose a model'}</option>
                {chat.models.map((model) => (
                  <option key={model.id} value={model.id}>{model.label || model.id}</option>
                ))}
              </select>
            </label>
          )}
          <button
            className={styles.primaryBtn}
            onClick={handleCreateAgent}
            disabled={!providerDraft.trim() || !modelDraft}
          >
            {providerDraft && modelDraft ? `Start ${providerDraft} chat` : 'Choose a CLI and model'}
          </button>
          {(providersError || chat.modelsError || chat.creationError || state.error) && <p className={styles.error}>{providersError || chat.modelsError || chat.creationError || state.error}</p>}
        </div>
      </div>
    )
  }

  const allMessages = [...state.items, ...state.head]
  const isRunning = state.turnActive || state.cancelling

  return (
    <div className={`${styles.container} ${className || ''}`}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.headerTitle}>{state.agentId.slice(0, 12)}…</span>
        {isRunning && <span className={styles.runningBadge}>Running</span>}
        {state.attention && <span className={styles.attentionBadge}>{state.attention}</span>}
        {state.agentId && onOpenInTab && <button className={styles.headerBtn} type="button" onClick={onOpenInTab} aria-label="Open agent in new tab" title="Open agent in new tab">↗</button>}
        <button className={styles.headerBtn} onClick={handleNewChat} title="New chat">+</button>
      </div>

      {/* Message list */}
      <div ref={listRef} className={styles.messageList} onScroll={handleScroll}>
        {state.olderAvailable && (
          <div className={styles.loadOlder}>
            <button className={styles.loadOlderBtn} onClick={() => actions.loadOlder()}>
              Load older
            </button>
          </div>
        )}
        {allMessages.map((item, i) => (
          <MessageBubble key={item.id || item.callId || item.clientMessageId || i} item={item} />
        ))}
        {state.head.length > 0 && state.head.some((h) => h.type === 'assistant_message') && (
          <div className={styles.streamingIndicator}>
            <span className={styles.dot} />
          </div>
        )}
        {state.error && <div className={styles.systemError}>{state.error}</div>}
        {state.sendError && <div className={styles.systemError}>{state.sendError}</div>}
      </div>

      {/* Permission cards */}
      {state.permissions.length > 0 && (
        <div className={styles.permissions}>
          {state.permissions.map((perm) => (
            <div key={perm.id} className={styles.permissionCard}>
              <div className={styles.permissionTitle}>
                {perm.title || perm.name || 'Permission required'}
              </div>
              {perm.description && <p className={styles.permissionDesc}>{perm.description}</p>}
              <div className={styles.permissionActions}>
                {(perm.actions && perm.actions.length > 0 ? perm.actions : [
                  { id: 'deny', label: 'Deny', behavior: 'deny', variant: 'danger' },
                  { id: 'allow', label: 'Allow', behavior: 'allow', variant: 'primary' },
                ]).map((action) => (
                  <button
                    key={action.id}
                    className={`${styles.permissionBtn} ${action.variant === 'danger' ? styles.dangerBtn : styles.allowBtn}`}
                    onClick={() => handlePermission(perm.id, action.behavior)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Composer */}
      <div className={styles.composer}>
        {isRunning && state.head.length === 0 && !draft.trim() ? (
          <button className={styles.cancelBtn} onClick={() => actions.cancel()} disabled={state.cancelling}>
            {state.cancelling ? 'Cancelling…' : 'Stop'}
          </button>
        ) : (
          <textarea
            ref={composerRef}
            className={styles.textarea}
            data-canvas-allow-text-selection
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            placeholder={isRunning ? 'Type to send while running…' : 'Send a message…'}
            rows={1}
          />
        )}
        {draft.trim() && (
          <button className={styles.sendBtn} onClick={handleSend} title="Send (Enter)">
            Send
          </button>
        )}
      </div>
    </div>
  )
}

function MessageBubble({ item }) {
  switch (item.type) {
    case 'user_message':
      return (
        <div className={styles.userMessage}>
          <div className={styles.userBubble}>
            {item.text}
            {item.clientMessageId && !item.messageId && !item.cursor && (
              <span className={styles.pendingDot} />
            )}
          </div>
        </div>
      )
    case 'assistant_message':
      return (
        <div className={styles.assistantMessage}>
          <div className={styles.assistantBubble}>{item.text || '…'}</div>
        </div>
      )
    case 'tool_call':
      return <ToolCallCard item={item} />
    case 'reasoning':
      return (
        <details className={styles.reasoningCard}>
          <summary className={styles.reasoningSummary}>Reasoning</summary>
          <pre className={styles.reasoningText}>{item.text}</pre>
        </details>
      )
    case 'todo':
      return <TodoCard item={item} />
    case 'notification':
      return (
        <div className={`${styles.notification} ${styles[`notif-${item.level || 'info'}`]}`}>
          {item.message}
        </div>
      )
    case 'error':
      return <div className={styles.systemError}>{item.message}</div>
    default:
      return null
  }
}

function ToolCallCard({ item }) {
  const [expanded, setExpanded] = useState(false)
  const statusIcon = item.status === 'running' ? '⟳' : item.status === 'failed' ? '✕' : '✓'
  const summary = item.name || item.callId || 'Tool'
  return (
    <div className={`${styles.toolCallCard} ${styles[`tool-${item.status || 'completed'}`]}`}>
      <button className={styles.toolCallHeader} onClick={() => setExpanded(!expanded)}>
        <span className={styles.toolCallIcon}>{statusIcon}</span>
        <span className={styles.toolCallName}>{summary}</span>
      </button>
      {expanded && (
        <div className={styles.toolCallDetail}>
          {item.detail?.command && <pre className={styles.toolDetailMono}>{item.detail.command}</pre>}
          {item.detail?.text && <pre className={styles.toolDetailMono}>{item.detail.text}</pre>}
          {item.error && <pre className={styles.toolDetailError}>{String(item.error)}</pre>}
        </div>
      )}
    </div>
  )
}

function TodoCard({ item }) {
  const items = item.items || []
  const done = items.filter((t) => t.completed || t.status === 'completed').length
  return (
    <div className={styles.todoCard}>
      <span className={styles.todoSummary}>
        {done}/{items.length} tasks
      </span>
      <ul className={styles.todoList}>
        {items.map((t, i) => (
          <li key={t.id || i} className={t.completed || t.status === 'completed' ? styles.todoDone : styles.todoPending}>
            {t.completed || t.status === 'completed' ? '✓' : '○'} {t.text}
          </li>
        ))}
      </ul>
    </div>
  )
}
