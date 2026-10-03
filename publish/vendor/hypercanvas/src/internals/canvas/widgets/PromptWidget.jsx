import { useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { readProp, promptSchema } from './widgetProps.js'
import { CopilotIcon, SquareFillIcon, CheckCircleIcon, XIcon } from '@primer/octicons-react'
import ResizeHandle from './ResizeHandle.jsx'
import styles from './PromptWidget.module.css'
import { storyboardWs } from '../../storyboard-ws.js'

function getBase() {
  return (import.meta.env?.BASE_URL || '/').replace(/\/$/, '')
}

/**
 * Resolve the **full** canvas-page id for the currently-mounted canvas.
 * Prefer the live bridge state (set by CanvasPage), which always carries the
 * complete nested id (e.g. `dfosco-explorations/adaptive-threat-view`). Fall
 * back to URL parsing when the bridge isn't ready yet — and crucially, take
 * **every** path segment after `/canvas/`, not just the first one, so nested
 * canvas ids round-trip correctly.
 */
function resolveCanvasId() {
  if (typeof window !== 'undefined') {
    const fromBridge = window.__storyboardCanvasBridgeState?.canvasId
    if (fromBridge) return fromBridge
    const pathParts = window.location.pathname.split('/').filter(Boolean)
    const canvasIdx = pathParts.indexOf('canvas')
    if (canvasIdx >= 0 && canvasIdx < pathParts.length - 1) {
      return pathParts.slice(canvasIdx + 1).join('/')
    }
  }
  return 'default'
}

async function spawnPromptAgent({ canvasId, widgetId, prompt, agentId }) {
  const res = await fetch(`${getBase()}/_storyboard/canvas/prompt/spawn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ canvasId, widgetId, prompt, agentId }),
  })
  return res.json()
}

async function killSession(widgetId) {
  const res = await fetch(`${getBase()}/_storyboard/canvas/terminal/kill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ widgetId }),
  })
  return res.json()
}

function getWsUrl(sessionId, canvasId, readOnly = false) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'
  const baseClean = base.endsWith('/') ? base : base + '/'
  let url = `${protocol}//${location.host}${baseClean}_storyboard/terminal/${sessionId}?canvas=${encodeURIComponent(canvasId)}`
  if (readOnly) url += '&readOnly=1'
  return url
}

let ghosttyPromise = null
function loadGhostty() {
  if (!ghosttyPromise) {
    ghosttyPromise = import(/* @vite-ignore */ 'ghostty-web')
      .then(async (mod) => {
        if (mod.init) await mod.init()
        return mod
      })
      .catch((err) => {
        ghosttyPromise = null
        console.warn('[PromptWidget] ghostty-web not available:', err.message)
        return null
      })
  }
  return ghosttyPromise
}

const MINI_FONT_SIZE = 11
const MINI_TERMINAL_HEIGHT = 180

const DEFAULT_THEME = {
  background: '#0d1117',
  foreground: '#e6edf3',
  cursor: '#e6edf3',
  selectionBackground: '#264f78',
}

function normalizeStatus(s) {
  if (s === 'completed') return 'done'
  if (s === 'running' || s === 'working' || s === 'pending') return 'pending'
  if (s === 'error') return 'error'
  if (s === 'done') return 'done'
  return 'idle'
}

function calcMiniDimensions(widthPx, heightPx) {
  const scale = MINI_FONT_SIZE / 13
  const cellWidth = 7.8 * scale
  const cellHeight = 17 * scale
  const hPad = 18
  const vPad = 18
  const cols = Math.max(10, Math.floor((widthPx - hPad) / cellWidth))
  const rows = Math.max(4, Math.floor((heightPx - vPad) / cellHeight))
  return { cols, rows }
}

const PromptWidget = forwardRef(function PromptWidget({ id, props, onUpdate, resizable }, ref) {
  const persistedText = readProp(props, 'text', promptSchema)
  const persistedStatus = readProp(props, 'status', promptSchema)
  const agentId = readProp(props, 'agentId', promptSchema)
  const errorMessage = readProp(props, 'errorMessage', promptSchema)
  const width = readProp(props, 'width', promptSchema)
  const height = readProp(props, 'height', promptSchema)
  const [draftText, setDraftText] = useState('')
  const [execStatus, setExecStatus] = useState(normalizeStatus(persistedStatus))
  const [execError, setExecError] = useState(errorMessage || '')
  const [showOutput, setShowOutput] = useState(false)
  const canEdit = typeof onUpdate === 'function'

  const containerRef = useRef(null)
  const termContainerRef = useRef(null)
  const termRef = useRef(null)
  const wsRef = useRef(null)
  const termDisposedRef = useRef(false)
  const textareaRef = useRef(null)

  const onUpdateRef = useRef(onUpdate)
  useEffect(() => { onUpdateRef.current = onUpdate }, [onUpdate])

  // Apply a status payload (from WS event or polled config) to local + persisted state.
  const applyStatus = useCallback((data) => {
    if (!data || !data.status) return
    if (data.status === 'done' || data.status === 'completed') {
      setExecStatus('done')
      onUpdateRef.current?.({ status: 'done' })
    } else if (data.status === 'error') {
      setExecStatus('error')
      setExecError(data.message || 'Unknown error')
      onUpdateRef.current?.({ status: 'error', errorMessage: data.message || 'Unknown error' })
    } else if (data.status === 'cancelled') {
      setExecStatus('idle')
      onUpdateRef.current?.({ status: 'idle', sessionId: '', errorMessage: '' })
    } else if (data.status === 'working' || data.status === 'running' || data.status === 'pending') {
      setExecStatus('pending')
      onUpdateRef.current?.({ status: 'pending' })
    }
  }, [])

  useEffect(() => {
    const handler = (data) => {
      if (data.widgetId !== id) return
      applyStatus(data)
    }
    storyboardWs.on('storyboard:agent-status', handler)
    return () => storyboardWs.off('storyboard:agent-status', handler)
  }, [id, applyStatus])

  // Reconcile with the server-side persisted agentStatus.
  // The agent always writes its final status to .storyboard/terminals/{id}.json
  // via POST /agent/signal, but the live `storyboard:agent-status` WS event
  // can be missed (tab in background, HMR reconnect, page navigation). On
  // mount and while we believe the agent is still pending, poll the persisted
  // status as a safety net so the widget can never get stuck.
  useEffect(() => {
    if (execStatus !== 'pending' && execStatus !== 'idle') return

    let cancelled = false
    let timer = null

    async function pollOnce() {
      try {
        const params = new URLSearchParams({ widgetId: id })
        const cid = resolveCanvasId()
        if (cid && cid !== 'default') params.set('canvasId', cid)
        const url = `${getBase()}/_storyboard/canvas/agent/status?${params}`
        const res = await fetch(url)
        if (!res.ok) return
        const json = await res.json().catch(() => null)
        const persisted = json?.agentStatus
        if (cancelled || !persisted?.status) return
        // Only apply terminal states or transitions we don't already reflect.
        if (persisted.status === 'done' || persisted.status === 'error' || persisted.status === 'cancelled') {
          applyStatus(persisted)
        } else if (execStatus === 'idle' && (persisted.status === 'running' || persisted.status === 'working' || persisted.status === 'pending')) {
          applyStatus(persisted)
        }
      } catch { /* offline — try again next tick */ }
    }

    // Reconcile immediately on mount / when we enter pending.
    pollOnce()
    // And keep polling at a low cadence while pending, in case the WS event
    // is missed entirely.
    if (execStatus === 'pending') {
      timer = setInterval(pollOnce, 5000)
    }

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [id, execStatus, applyStatus])

  useImperativeHandle(ref, () => ({
    handleAction(action) {
      if (action === 'expand-output') {
        setShowOutput(prev => !prev)
        return true
      }
      return false
    },
    getState(key) {
      if (key === 'showOutput') return showOutput
      if (key === 'hasSession') return execStatus !== 'idle'
      return undefined
    },
  }), [id, showOutput, execStatus])

  const handleSubmit = useCallback(async () => {
    if (!draftText.trim() || !canEdit) return

    setExecStatus('pending')
    setExecError('')

    const canvasId = resolveCanvasId()

    onUpdate?.({ text: draftText, status: 'pending' })

    try {
      const result = await spawnPromptAgent({
        canvasId,
        widgetId: id,
        prompt: draftText,
        agentId,
      })

      if (result.error) {
        setExecStatus('error')
        setExecError(result.error)
        onUpdate?.({ status: 'error', errorMessage: result.error })
        return
      }

      onUpdate?.({ sessionId: result.sessionId || '' })
    } catch (err) {
      setExecStatus('error')
      setExecError(err.message)
      onUpdate?.({ status: 'error', errorMessage: err.message })
    }
  }, [draftText, canEdit, id, agentId, onUpdate])

  const handleCancel = useCallback(async () => {
    try {
      await killSession(id)
      setExecStatus('idle')
      setExecError('')
      onUpdate?.({ status: 'idle', sessionId: '', errorMessage: '' })
    } catch (err) {
      setExecError(`Cancel failed: ${err.message}`)
    }
  }, [id, onUpdate])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
    e.stopPropagation()
  }, [handleSubmit])

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const handleReset = useCallback(() => {
    setExecStatus('idle')
    setExecError('')
    setDraftText('')
    setShowOutput(false)
    onUpdate?.({ status: 'idle', sessionId: '', errorMessage: '', text: '' })
  }, [onUpdate])

  const handleResize = useCallback((newWidth, newHeight) => {
    const el = containerRef.current
    const termEl = termContainerRef.current
    if (el && termEl) {
      // height prop controls only the terminal area, not the full wrapper
      const nonTermH = el.offsetHeight - termEl.offsetHeight
      const newTermH = Math.max(80, newHeight - nonTermH)
      onUpdate?.({ width: newWidth, height: newTermH })
    } else {
      onUpdate?.({ width: newWidth })
    }
  }, [onUpdate])

  // Embedded read-only terminal — created when the prompt has an active session
  useEffect(() => {
    if (!showOutput || execStatus === 'idle') return
    if (!termContainerRef.current) return

    termDisposedRef.current = false
    let term = null
    let ws = null

    async function setup() {
      try {
        const ghostty = await loadGhostty()
        if (termDisposedRef.current) return
        if (!ghostty) return

        const widthPx = typeof width === 'number' ? width : 320
        const heightPx = typeof height === 'number' ? height : MINI_TERMINAL_HEIGHT
        const dims = calcMiniDimensions(widthPx, heightPx)

        term = new ghostty.Terminal({
          fontSize: MINI_FONT_SIZE,
          fontFamily: "'Ghostty', 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
          scrollback: 10000,
          preserveScrollOnWrite: true,
          cursorBlink: false,
          cursorStyle: 'bar',
          cols: dims.cols,
          rows: dims.rows,
          theme: DEFAULT_THEME,
        })

        term.open(termContainerRef.current)
        termRef.current = term

        const canvasId = resolveCanvasId()

        const url = getWsUrl(id, canvasId, true)
        ws = new WebSocket(url)
        wsRef.current = ws

        ws.onopen = () => {
          if (termDisposedRef.current) return
          ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
        }

        ws.onmessage = (e) => {
          if (termDisposedRef.current) return
          const data = typeof e.data === 'string' ? e.data : null
          if (data && data.startsWith('{')) {
            try {
              const msg = JSON.parse(data)
              if (msg.type === 'session-info' || msg.type === 'error') return
            } catch { /* not JSON */ }
          }
          term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data))
        }

        ws.onclose = () => {}
        ws.onerror = () => {}
      } catch (err) {
        console.warn('[PromptWidget] terminal setup failed:', err.message)
      }
    }

    setup()

    return () => {
      termDisposedRef.current = true
      if (ws && ws.readyState <= 1) try { ws.close() } catch { /* best effort */ }
      if (term) try { term.dispose() } catch { /* best effort */ }
      termRef.current = null
      wsRef.current = null
    }
  }, [showOutput, execStatus, id, width, height])

  const isPending = execStatus === 'pending'
  const isDone = execStatus === 'done'
  const isError = execStatus === 'error'
  const hasSession = isPending || isDone || isError

  return (
    <div
      ref={containerRef}
      className={styles.wrapper}
      data-prompt-agent={agentId}
      data-prompt-state={execStatus}
      style={typeof width === 'number' ? { width: `${width}px` } : undefined}
    >
      {/* ── Idle / Error: input state ── */}
      {(execStatus === 'idle' || isError) && (
        <>
          <div className={styles.header}>
            <span className={styles.avatar}>
              <CopilotIcon size={20} />
            </span>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              data-canvas-allow-text-selection
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={handleKeyDown}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              placeholder="What should I do?"
              rows={1}
              disabled={!canEdit}
            />
          </div>

          {isError && (
            <p className={styles.errorText} title={execError}>
              {execError}
            </p>
          )}

          <div className={styles.toolbar}>
            <button
              className={styles.submitBtn}
              onClick={handleSubmit}
              disabled={!draftText.trim() || !canEdit}
              title="Run prompt (⌘+Enter)"
            >
              {isError ? 'Retry' : 'Run'}
            </button>
          </div>
        </>
      )}

      {/* ── Pending state ── */}
      {isPending && (
        <div className={styles.pendingArea}>
          <div className={styles.pendingHeader}>
            <span className={styles.avatar}>
              <CopilotIcon size={20} />
            </span>
            <p className={styles.pendingText}>{persistedText || draftText}</p>
          </div>
          <div className={styles.pendingFooter}>
            <span className={styles.pendingHint}>Processing…</span>
            <button
              className={styles.cancelBtn}
              onClick={handleCancel}
              title="Cancel (stop agent)"
            >
              <svg className={styles.spinnerSvg} viewBox="0 0 16 16" width="14" height="14">
                <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="28 10" />
              </svg>
              <span className={styles.stopIcon}>
                <SquareFillIcon size={8} />
              </span>
            </button>
          </div>
        </div>
      )}

      {/* ── Done state ── */}
      {isDone && (
        <div className={styles.doneArea}>
          <div className={styles.doneHeader}>
            <span className={`${styles.avatar} ${styles.avatarDone}`}>
              <CheckCircleIcon size={20} />
            </span>
            <p className={styles.doneText}>{persistedText}</p>
          </div>
          <button className={styles.resetBtn} onClick={handleReset}>
            New prompt
          </button>
        </div>
      )}

      {/* ── Inline read-only terminal output ── */}
      {hasSession && showOutput && (
        <div className={styles.terminalArea}>
          <div className={styles.terminalHeader}>
            <span className={styles.terminalLabel}>Output</span>
            <button
              className={styles.terminalClose}
              onClick={() => setShowOutput(false)}
              title="Hide output"
            >
              <XIcon size={12} />
            </button>
          </div>
          <div
            ref={termContainerRef}
            className={styles.terminalContainer}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              pointerEvents: 'none',
              height: typeof height === 'number' ? `${height}px` : undefined,
            }}
          />
        </div>
      )}
      {resizable && (
        <ResizeHandle
          targetRef={containerRef}
          minWidth={200}
          onResize={handleResize}
        />
      )}
    </div>
  )
})

export default PromptWidget
