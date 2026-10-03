import { useState, useEffect, useRef } from 'react'
import styles from './FrozenTerminalOverlay.module.css'

/**
 * Renders a frozen terminal preview from the latest server snapshot.
 * Shown when a terminal widget loses its live WebGL slot but the
 * server-side PTY session is still running.
 *
 * The snapshot text is rendered at a base font size then CSS-scaled to
 * fill the widget width — matching the live ghostty terminal's sizing.
 */

let Convert = null
let ansiLoadAttempted = false

async function getConverter() {
  if (Convert) return new Convert({ fg: '#e6edf3', bg: '#0d1117', newline: true })
  if (ansiLoadAttempted) return null
  ansiLoadAttempted = true
  try {
    const mod = await import(/* @vite-ignore */ 'ansi-to-html')
    Convert = mod.default || mod
    return new Convert({ fg: '#e6edf3', bg: '#0d1117', newline: true })
  } catch {
    return null
  }
}

function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
}

function getBaseUrl() {
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'
  return base.endsWith('/') ? base : base + '/'
}

export default function FrozenTerminalOverlay({ widgetId, onActivate }) {
  const [html, setHtml] = useState(null)
  const [plainText, setPlainText] = useState(null)
  const [scale, setScale] = useState(1)
  const containerRef = useRef(null)
  const preRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function fetchSnapshot() {
      const baseUrl = getBaseUrl()
      // Try the dev-server REST endpoint first, then fall back to the static
      // consolidated index (production builds / no server).
      const restUrl = `${baseUrl}_storyboard/canvas/terminal-snapshot/${widgetId}`
      const indexUrl = `${baseUrl}_storyboard/terminal-snapshots/agents.snapshot.json`

      try {
        const res = await fetch(restUrl)
        if (res.ok) {
          const data = await res.json()
          if (cancelled) return
          const text = data.paneContent || data.content || data.output || ''
          if (text) {
            const converter = await getConverter()
            if (cancelled) return
            if (converter) setHtml(converter.toHtml(text))
            else setPlainText(stripAnsi(text))
            return
          }
        }
      } catch { /* fall through to static index */ }

      try {
        const res = await fetch(indexUrl)
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        const entry = data?.agents?.[widgetId]
        if (!entry) return
        const text = entry.paneContent || entry.content || entry.output || ''
        if (!text) return
        const converter = await getConverter()
        if (cancelled) return
        if (converter) setHtml(converter.toHtml(text))
        else setPlainText(stripAnsi(text))
      } catch { /* empty */ }
    }

    fetchSnapshot()
    return () => { cancelled = true }
  }, [widgetId])

  // Scale the pre to fill the padded content area width
  useEffect(() => {
    const container = containerRef.current
    const pre = preRef.current
    if (!container || !pre) return

    function updateScale() {
      const style = getComputedStyle(container)
      const padL = parseFloat(style.paddingLeft) || 0
      const padR = parseFloat(style.paddingRight) || 0
      const availableWidth = container.clientWidth - padL - padR
      const naturalWidth = pre.scrollWidth
      if (naturalWidth > 0 && availableWidth > 0) {
        setScale(availableWidth / naturalWidth)
      }
    }

    const observer = new ResizeObserver(updateScale)
    observer.observe(container)
    updateScale()

    return () => observer.disconnect()
  }, [html, plainText])

  const hasSnapshot = !!(html || plainText)

  return (
    <div
      className={styles.overlay}
      onClick={onActivate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onActivate?.() }}
      aria-label="Click to resume terminal"
    >
      {/* Faded snapshot background — scaled to fill widget width */}
      {hasSnapshot && (
        <div ref={containerRef} className={styles.snapshotContent}>
          {html && (
            <pre
              ref={preRef}
              className={styles.snapshotPre}
              style={{ transform: `scale(${scale})` }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
          {!html && plainText && (
            <pre
              ref={preRef}
              className={styles.snapshotPre}
              style={{ transform: `scale(${scale})` }}
            >
              {plainText}
            </pre>
          )}
        </div>
      )}

      {/* Status + action */}
      <div className={styles.statusLayer}>
        <span className={styles.actionButton}>Click to resume</span>
        <span className={styles.statusBadge}>
          Running in background
          <span className={styles.orbitSpinner} />
        </span>
      </div>
    </div>
  )
}
