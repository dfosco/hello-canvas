import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { useAgentChat } from '../../agent-chat/useAgentChat.js'
import { AgentChat } from '../../agent-chat/AgentChat.jsx'
import { readProp, schemas } from './widgetProps.js'
import ResizeHandle from './ResizeHandle.jsx'
import ExpandedPane from './ExpandedPane.jsx'
import { buildPaneForWidget, buildSplitLayout, findAllConnectedSplitTargets, getSplitPaneLabel } from './expandUtils.js'
import { useExpandOverride } from './useExpandOverride.js'
import { browserAgentSessionUrl } from '../../../core/notebook/browserBridge.js'
import styles from '../../agent-chat/AgentChat.module.css'

const agentChatSchema = schemas['agent-chat'] || {}
const DEFAULT_WIDTH = 575
const DEFAULT_HEIGHT = 820

const AgentChatWidget = forwardRef(function AgentChatWidget({ id, props, onUpdate, resizable }, ref) {
  const agentId = readProp(props, 'agentId', agentChatSchema) || ''
  const width = Number(readProp(props, 'width', agentChatSchema)) || DEFAULT_WIDTH
  const height = Number(readProp(props, 'height', agentChatSchema)) || DEFAULT_HEIGHT
  const [expandMode, setExpandMode] = useExpandOverride('agent-chat', id)
  const chatNodeRef = useRef(null)
  const originalParentRef = useRef(null)

  const chat = useAgentChat({
    agentId,
    widgetId: id,
    onAgentIdChange: (newId) => onUpdate?.({ agentId: newId }),
  })

  const openInNewTab = useCallback(() => {
    const url = browserAgentSessionUrl({
      agentId,
      widgetId: id,
      canvasId: window.__storyboardCanvasBridgeState?.canvasId,
    })
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }, [agentId, id])

  useImperativeHandle(ref, () => ({
    handleAction(actionId) {
      if (actionId === 'expand' || actionId === 'expand-single') {
        setExpandMode('single')
        return true
      }
      if (actionId === 'split-screen') {
        setExpandMode('split')
        return true
      }
      return false
    },
  }), [setExpandMode])

  const handleResize = useCallback((nextWidth, nextHeight) => {
    onUpdate?.({ width: Math.round(nextWidth), height: Math.round(nextHeight) })
  }, [onUpdate])

  const expanded = Boolean(expandMode)
  const closeExpanded = useCallback(() => setExpandMode(null), [setExpandMode])

  useEffect(() => {
    const node = chatNodeRef.current
    if (!node || !originalParentRef.current || node.parentElement === originalParentRef.current) return
    originalParentRef.current.appendChild(node)
  }, [expanded])

  const expandedPane = expanded ? (
    <AgentChatExpandedPane
      widgetId={id}
      nodeRef={chatNodeRef}
      mode={expandMode}
      onClose={closeExpanded}
    />
  ) : null

  return (
    <>
      <div
        className={styles.widgetShell}
        style={{ width: `${width}px`, height: `${height}px` }}
        ref={(element) => { if (element) originalParentRef.current = element }}
      >
        <div ref={chatNodeRef} className={styles.chatNode}>
          <AgentChat chat={chat} providers={chat.providers} providersError={chat.providersError} onOpenInTab={openInNewTab} />
        </div>
        {resizable && (
          <ResizeHandle
            targetRef={originalParentRef}
            minWidth={300}
            minHeight={200}
            onResize={handleResize}
          />
        )}
      </div>
      {expandedPane}
    </>
  )
})

function AgentChatExpandedPane({ widgetId, nodeRef, mode, onClose }) {
  const connected = useMemo(() => mode === 'split' ? findAllConnectedSplitTargets(widgetId) : [], [mode, widgetId])
  const primary = useMemo(() => ({
    id: widgetId,
    type: 'agent-chat',
    props: window.__storyboardCanvasBridgeState?.widgets?.find((widget) => widget.id === widgetId)?.props || {},
  }), [widgetId])
  const panes = useMemo(() => {
    const primaryPane = {
      id: widgetId,
      label: getSplitPaneLabel(primary),
      widgetType: 'agent-chat',
      kind: 'external',
      attach: (container) => {
        const node = nodeRef.current
        const parent = node?.parentElement
        if (node && parent) parent.appendChild(document.createComment('agent-chat-placeholder'))
        if (node) container.appendChild(node)
        return () => {
          const placeholder = parent?.lastChild
          if (node && parent) parent.appendChild(node)
          if (placeholder?.nodeType === Node.COMMENT_NODE) placeholder.remove()
        }
      },
    }
    return buildSplitLayout(primary, connected, (widget) => (
      widget.id === widgetId ? primaryPane : buildPaneForWidget(widget)
    ))
  }, [connected, nodeRef, primary, widgetId])

  return <ExpandedPane initialLayout={panes} variant="full" onClose={onClose} />
}

export default AgentChatWidget
