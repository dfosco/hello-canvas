import { useRef, useEffect, useState } from 'react'
import { readProp, schemas } from './widgetProps.js'
import styles from './TerminalReadWidget.module.css'

const terminalSchema = schemas['terminal']

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

function getCanvasId() {
  return window.__storyboardCanvasBridgeState?.canvasId || null
}

function isProduction() {
  return typeof import.meta !== 'undefined' && import.meta.env?.PROD
}

export default function TerminalReadWidget({ id, props }) {
  const width = readProp(props, 'width', terminalSchema)
  const height = readProp(props, 'height', terminalSchema)
  const prettyName = props?.prettyName || '...'

  const [content, setContent] = useState(null)
  const [html, setHtml] = useState(null)
  const [failed, setFailed] = useState(false)
  const contentRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    async function fetchSnapshot() {
      const baseUrl = getBaseUrl()
      const canvasId = getCanvasId()
      if (!canvasId) { setFailed(true); return }

      const indexUrl = `${baseUrl}_storyboard/terminal-snapshots/agents.snapshot.json`
      const legacyUrl = `${baseUrl}_storyboard/terminal-snapshots/${canvasId.replace(/\//g, '--')}/${id}.json`
      const restUrl = `${baseUrl}_storyboard/canvas/terminal-snapshot/${id}`

      const tryUrls = isProduction()
        ? [{ url: indexUrl, fromIndex: true }, { url: legacyUrl, fromIndex: false }]
        : [{ url: restUrl, fromIndex: false }, { url: indexUrl, fromIndex: true }, { url: legacyUrl, fromIndex: false }]

      for (const { url, fromIndex } of tryUrls) {
        try {
          const res = await fetch(url)
          if (!res.ok) continue
          const data = await res.json()
          if (cancelled) return
          const entry = fromIndex ? data?.agents?.[id] : data
          if (!entry) continue
          const text = entry.paneContent || entry.content || entry.output || ''
          if (!text) continue
          setContent(text)

          const converter = await getConverter()
          if (cancelled) return
          if (converter) {
            setHtml(converter.toHtml(text))
          } else {
            setContent(stripAnsi(text))
          }
          return
        } catch {
          continue
        }
      }
      if (!cancelled) setFailed(true)
    }
    fetchSnapshot()
    return () => { cancelled = true }
  }, [id])

  // Auto-scroll to bottom
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [html, content])

  const titleLabel = `terminal · ${prettyName}`

  return (
    <div className={styles.container}>
      <div className={`tc-drag-handle ${styles.titleBar}`}>
        <span>{titleLabel}</span>
        <span className={styles.readOnlyBadge}>read only</span>
      </div>
      <div
        ref={contentRef}
        className={styles.content}
        style={{
          ...(typeof width === 'number' ? { width: `${width}px` } : undefined),
          ...(typeof height === 'number' ? { height: `${height}px` } : undefined),
        }}
      >
        {failed && (
          <div className={styles.placeholder}>
            <span className={styles.placeholderTitle}>Terminal session · {prettyName}</span>
            <span className={styles.placeholderSub}>No captured output available</span>
          </div>
        )}
        {!failed && content === null && (
          <div className={styles.placeholder}>
            <span className={styles.placeholderSub}>Loading…</span>
          </div>
        )}
        {!failed && html && (
          <pre
            style={{ margin: 0, whiteSpace: 'pre', fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit' }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
        {!failed && content !== null && !html && (
          <pre style={{ margin: 0, whiteSpace: 'pre', fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit' }}>
            {content}
          </pre>
        )}
      </div>
    </div>
  )
}
