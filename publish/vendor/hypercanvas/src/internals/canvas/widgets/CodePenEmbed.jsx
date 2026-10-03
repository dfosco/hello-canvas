/**
 * CodePen embed widget for canvas.
 *
 * Behaves like FigmaEmbed: click-to-interact overlay, iframe kept alive
 * after deselect, expand modal, open-external action. Created via paste
 * when a CodePen URL is pasted onto the canvas.
 */
import { forwardRef, useImperativeHandle, useMemo, useCallback, useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import WidgetWrapper from './WidgetWrapper.jsx'
import { readProp } from './widgetProps.js'
import { schemas } from './widgetConfig.js'
import { isCodePenUrl, toCodePenEmbedUrl, getCodePenTitle, fetchCodePenMeta } from './codepenUrl.js'
import { useIframeDevLogs } from './iframeDevLogs.js'
import styles from './CodePenEmbed.module.css'
import overlayStyles from './embedOverlay.module.css'
import { useExpandOverride } from './useExpandOverride.js'

const codepenEmbedSchema = schemas['codepen-embed']

/** Feather Icons codepen icon (stroke-based) */
function CodePenLogo({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
      <line x1="12" y1="22" x2="12" y2="15.5" />
      <polyline points="22 8.5 12 15.5 2 8.5" />
      <polyline points="2 15.5 12 8.5 22 15.5" />
      <line x1="12" y1="2" x2="12" y2="8.5" />
    </svg>
  )
}

/** Stroke-based code icon for empty state */
function CodeIcon({ size = 32, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  )
}

export default forwardRef(function CodePenEmbed({ id, props, onUpdate, resizable }, ref) {
  const url = readProp(props, 'url', codepenEmbedSchema)
  const width = readProp(props, 'width', codepenEmbedSchema)
  const height = readProp(props, 'height', codepenEmbedSchema)

  const [interactive, setInteractive] = useState(false)
  const [expandedMode, setExpandedMode] = useExpandOverride('codepen', id)
  const expanded = expandedMode === '1'
  const setExpanded = useCallback((open) => setExpandedMode(open ? '1' : null), [setExpandedMode])

  const iframeRef = useRef(null)
  const embedRef = useRef(null)
  const inlineContainerRef = useRef(null)
  const modalContainerRef = useRef(null)

  const isValid = useMemo(() => isCodePenUrl(url), [url])
  const embedUrl = useMemo(() => (isValid ? toCodePenEmbedUrl(url) : ''), [url, isValid])
  const fallbackTitle = useMemo(() => (url ? getCodePenTitle(url) : 'CodePen'), [url])

  // Fetch pen metadata (title + author) from CodePen oEmbed API
  const [penMeta, setPenMeta] = useState(null)
  useEffect(() => {
    if (!url || !isValid) return
    let cancelled = false
    fetchCodePenMeta(url).then((meta) => {
      if (!cancelled && meta) setPenMeta(meta)
    })
    return () => { cancelled = true }
  }, [url, isValid])

  const headerTitle = penMeta?.title
    ? `${penMeta.title} · ${penMeta.author || fallbackTitle}`
    : fallbackTitle

  useIframeDevLogs({
    widget: 'CodePenEmbed',
    loaded: Boolean(embedUrl),
    src: embedUrl,
  })

  const enterInteractive = useCallback(() => {
    setInteractive(true)
  }, [])

  // Exit interactive mode on click outside
  useEffect(() => {
    if (!interactive || expanded) return
    function handlePointerDown(e) {
      if (embedRef.current && !embedRef.current.contains(e.target)) {
        setInteractive(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [interactive, expanded])

  // Close expanded modal on Escape
  useEffect(() => {
    if (!expanded) return
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setExpanded(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [expanded, setExpanded])

  // Reparent iframe between inline and modal containers
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    if (expanded && modalContainerRef.current) {
      iframe._savedClassName = iframe.className
      iframe._savedStyle = iframe.getAttribute('style') || ''
      iframe.className = styles.expandIframe
      iframe.removeAttribute('style')
      const target = modalContainerRef.current
      if (target.moveBefore) {
        target.moveBefore(iframe, target.firstChild)
      } else {
        target.prepend(iframe)
      }
    } else if (!expanded && inlineContainerRef.current) {
      if (iframe._savedClassName !== undefined) {
        iframe.className = iframe._savedClassName
        iframe.setAttribute('style', iframe._savedStyle)
        delete iframe._savedClassName
        delete iframe._savedStyle
      }
      const target = inlineContainerRef.current
      if (target.moveBefore) {
        target.moveBefore(iframe, null)
      } else {
        target.appendChild(iframe)
      }
    }
  }, [expanded])

  useImperativeHandle(ref, () => ({
    getIframeWindow() {
      try {
        return iframeRef.current?.contentWindow ?? null
      } catch {
        return null
      }
    },
    handleAction(actionId) {
      if (actionId === 'open-external') {
        if (url) window.open(url, '_blank', 'noopener')
      } else if (actionId === 'expand') {
        setExpanded(true)
      }
    },
  }), [url, setExpanded])

  return (
    <>
    <WidgetWrapper>
      <div ref={embedRef} className={styles.embed} style={{ width, height }}>
        <div className={styles.header}>
          <CodePenLogo className={styles.codepenLogo} />
          <span className={styles.headerTitle}>{headerTitle}</span>
        </div>
        {embedUrl ? (
          <>
            <div
              ref={inlineContainerRef}
              className={styles.iframeContainer}
              style={expanded ? { visibility: 'hidden' } : undefined}
            >
              <iframe
                ref={iframeRef}
                src={embedUrl}
                className={styles.iframe}
                title={`CodePen: ${headerTitle}`}
                allowFullScreen
                onLoad={(e) => e.target.blur()}
              />
            </div>
            {!interactive && !expanded && (
              <div
                className={overlayStyles.interactOverlay}
                onClick={(e) => {
                  if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
                  enterInteractive()
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.stopPropagation()
                    enterInteractive()
                  }
                }}
                aria-label="Click to interact with CodePen embed"
              >
                <span className={overlayStyles.interactHint}>Click to interact</span>
              </div>
            )}
          </>
        ) : (
          <div className={styles.emptyState}>
            <CodeIcon size={32} className={styles.emptyIcon} />
            <span className={styles.emptyLabel}>No CodePen URL</span>
          </div>
        )}
      </div>
      {resizable && (
        <div
          className={styles.resizeHandle}
          onMouseDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
            const startX = e.clientX
            const startY = e.clientY
            const startW = width
            const startH = height
            function onMove(ev) {
              const newW = Math.max(200, startW + ev.clientX - startX)
              const newH = Math.max(150, startH + ev.clientY - startY)
              onUpdate?.({ width: newW, height: newH })
            }
            function onUp() {
              document.removeEventListener('mousemove', onMove)
              document.removeEventListener('mouseup', onUp)
            }
            document.addEventListener('mousemove', onMove)
            document.addEventListener('mouseup', onUp)
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      )}
    </WidgetWrapper>
    {createPortal(
      <div
        className={styles.expandBackdrop}
        style={expanded && embedUrl ? undefined : { display: 'none' }}
        onClick={() => setExpanded(false)}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') setExpanded(false)
        }}
        onWheel={(e) => e.stopPropagation()}
        tabIndex={-1}
        ref={(el) => { if (el && expanded) el.focus() }}
      >
        <div
          ref={modalContainerRef}
          className={styles.expandContainer}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className={styles.expandClose}
            onClick={() => setExpanded(false)}
            aria-label="Close expanded view"
            autoFocus
          >✕</button>
        </div>
      </div>,
      document.body
    )}
    </>
  )
})
