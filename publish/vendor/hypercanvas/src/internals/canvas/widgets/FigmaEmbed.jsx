import { forwardRef, useImperativeHandle, useMemo, useCallback, useState, useEffect, useRef } from 'react'
import WidgetWrapper from './WidgetWrapper.jsx'
import { readProp } from './widgetProps.js'
import { schemas } from './widgetConfig.js'
import { toFigmaEmbedUrl, getFigmaTitle, getFigmaType, isFigmaUrl } from './figmaUrl.js'
import { useIframeDevLogs } from './iframeDevLogs.js'
import { findAllConnectedSplitTargets, getSplitPaneLabel, buildPaneForWidget, buildSplitLayout } from './expandUtils.js'
import { useExpandOverride } from './useExpandOverride.js'
import ExpandedPane from './ExpandedPane.jsx'
import styles from './FigmaEmbed.module.css'
import overlayStyles from './embedOverlay.module.css'

const figmaEmbedSchema = schemas['figma-embed']

/** Feather-icons figma icon (monochrome, stroke-based) */
function FigmaIcon({ size = 32, className }) {
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
      <path d="M5 5.5A3.5 3.5 0 0 1 8.5 2H12v7H8.5A3.5 3.5 0 0 1 5 5.5z" />
      <path d="M12 2h3.5a3.5 3.5 0 1 1 0 7H12V2z" />
      <path d="M12 12.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 1 1-7 0z" />
      <path d="M5 19.5A3.5 3.5 0 0 1 8.5 16H12v3.5a3.5 3.5 0 1 1-7 0z" />
      <path d="M5 12.5A3.5 3.5 0 0 1 8.5 9H12v7H8.5A3.5 3.5 0 0 1 5 12.5z" />
    </svg>
  )
}

/** Inline Figma logo SVG */
function FigmaLogo() {
  return (
    <svg className={styles.figmaLogo} viewBox="0 0 38 57" fill="none" aria-hidden="true">
      <path d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z" fill="#1ABCFE" />
      <path d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0z" fill="#0ACF83" />
      <path d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19z" fill="#FF7262" />
      <path d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5z" fill="#F24E1E" />
      <path d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5z" fill="#A259FF" />
    </svg>
  )
}

const TYPE_LABELS = { board: 'Board', design: 'Design', proto: 'Prototype' }

export default forwardRef(function FigmaEmbed({ id: widgetId, props, onUpdate, resizable }, ref) {
  const url = readProp(props, 'url', figmaEmbedSchema)
  const width = readProp(props, 'width', figmaEmbedSchema)
  const height = readProp(props, 'height', figmaEmbedSchema)

  const [interactive, setInteractive] = useState(false)
  const [expandMode, setExpandMode] = useExpandOverride('figma', widgetId)
  const expanded = expandMode !== null

  const iframeRef = useRef(null)
  const embedRef = useRef(null)
  const inlineContainerRef = useRef(null)
  const modalContainerRef = useRef(null)

  // Validate URL at render time — only embed known Figma URLs
  const isValid = useMemo(() => isFigmaUrl(url), [url])
  const embedUrl = useMemo(() => (isValid ? toFigmaEmbedUrl(url) : ''), [url, isValid])
  const title = useMemo(() => (url ? getFigmaTitle(url) : 'Figma'), [url])
  const figmaType = useMemo(() => getFigmaType(url), [url])
  const typeLabel = figmaType ? TYPE_LABELS[figmaType] : 'Figma'

  useIframeDevLogs({
    widget: 'FigmaEmbed',
    loaded: Boolean(embedUrl),
    src: embedUrl,
  })

  const enterInteractive = useCallback(() => {
    setInteractive(true)
  }, [])

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

  // Reparent iframe DOM node between inline container and modal.
  // Uses moveBefore() (Chrome 133+) which preserves the iframe's
  // browsing context — no reload. Falls back to appendChild.
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
      } else if (actionId === 'expand' || actionId === 'expand-single') {
        setExpandMode('single')
      } else if (actionId === 'split-screen') {
        setExpandMode('split')
      }
    },
  }), [url, setExpandMode])

  return (
    <>
    <WidgetWrapper>
      <div ref={embedRef} className={styles.embed} style={{ width, height }}>
        <div className={styles.header}>
          <FigmaLogo />
          <span className={styles.headerTitle}>{title}</span>
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
                title={`Figma ${typeLabel}: ${title}`}
                allowFullScreen
                onLoad={(e) => e.target.blur()}
              />
            </div>
            {!interactive && !expanded && (
              <div
                className={overlayStyles.interactOverlay}
                onClick={(e) => {
                  // Don't enter interactive mode for modifier clicks (shift/meta/ctrl for multi-select)
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
                aria-label="Click to interact with Figma embed"
              >
                <span className={overlayStyles.interactHint}>Click to interact</span>
              </div>
            )}
          </>
        ) : (
        <div className={styles.emptyState}>
          <FigmaIcon size={32} className={styles.emptyIcon} />
          <span className={styles.emptyLabel}>No Figma URL</span>
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
    {expanded && !!embedUrl && (
      <FigmaExpandPane
        widgetId={widgetId}
        modalContainerRef={modalContainerRef}
        splitMode={expandMode === 'split'}
        onClose={() => setExpandMode(null)}
      />
    )}
    </>
  )
})

/**
 * Builds pane configs and renders ExpandedPane for an expanded Figma widget.
 * The primary pane is an external pane that receives the iframe via reparenting.
 */
function FigmaExpandPane({ widgetId, modalContainerRef, splitMode, onClose }) {
  const connectedWidgets = useMemo(
    () => splitMode ? findAllConnectedSplitTargets(widgetId) : [],
    [widgetId, splitMode],
  )
  const primaryWidget = useMemo(() => {
    const bridge = window.__storyboardCanvasBridgeState
    return bridge?.widgets?.find((w) => w.id === widgetId) || { id: widgetId, type: 'figma-embed', position: { x: 0, y: 0 }, props: {} }
  }, [widgetId])

  const buildPaneFn = useCallback((widget) => {
    if (widget.id === widgetId) {
      return {
        id: widgetId,
        label: getSplitPaneLabel(primaryWidget),
        widgetType: 'figma-embed',
        kind: 'external',
        attach: (container) => {
          modalContainerRef.current = container
          return () => { modalContainerRef.current = null }
        },
      }
    }
    return buildPaneForWidget(widget)
  }, [widgetId, primaryWidget, modalContainerRef])

  const layout = useMemo(
    () => buildSplitLayout(primaryWidget, connectedWidgets, buildPaneFn),
    [primaryWidget, connectedWidgets, buildPaneFn],
  )

  return (
    <ExpandedPane
      initialLayout={layout}
      variant={layout.flat().length <= 1 ? 'modal' : 'full'}
      onClose={onClose}
    />
  )
}
