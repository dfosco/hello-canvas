import { marked } from "marked"

const STICKY_COLORS = {
  yellow: { bg: '#fff8c5', border: '#d4a72c' },
  blue: { bg: '#ddf4ff', border: '#54aeff' },
  green: { bg: '#dafbe1', border: '#4ac26b' },
  pink: { bg: '#ffebe9', border: '#ff8182' },
  purple: { bg: '#fbefff', border: '#c297ff' },
  orange: { bg: '#fff1e5', border: '#d18616' },
}

const WIDGET_SIZES = {
  'sticky-note': [270, 170],
  markdown: [530, 240],
  image: [640, 420],
  'link-preview': [320, 200],
}

function assetUrl(src) {
  if (!src) return ""
  if (/^(https?:|data:|blob:)/i.test(src)) return src
  const base = new URL(import.meta.env.BASE_URL || './', window.location.href)
  return new URL(String(src).replace(/^\/+/, ''), base).href
}

function widgetBox(widget) {
  const fallback = WIDGET_SIZES[widget.type] || [480, 320]
  const width = Number(widget.props?.width) || fallback[0]
  const height = Number(widget.props?.height) || fallback[1]
  const x = Math.max(0, Number(widget.position?.x) || 0)
  const y = Math.max(0, Number(widget.position?.y) || 0)
  return { x, y, width, height }
}

function StickyNote({ widget }) {
  const color = STICKY_COLORS[widget.props?.color] || STICKY_COLORS.yellow
  return (
    <div className="widget-sticky" style={{ background: color.bg, borderColor: color.border }}>
      <span className="widget-sticky-dot" style={{ background: color.border }} />
      <p>{widget.props?.text ?? ""}</p>
    </div>
  )
}

function MarkdownBlock({ widget }) {
  const html = marked.parse(String(widget.props?.content ?? ""), { async: false })
  return <div className="widget-markdown" dangerouslySetInnerHTML={{ __html: html }} />
}

function ImageWidget({ widget }) {
  const src = assetUrl(widget.props?.src)
  if (!src) return <UnavailableWidget widget={widget} />
  return <img className="widget-image" src={src} alt={widget.props?.alt ?? ""} loading="lazy" />
}

function LinkPreview({ widget }) {
  const url = String(widget.props?.url ?? "")
  if (!url) return <UnavailableWidget widget={widget} />
  return (
    <a className="widget-link-preview" href={url} target="_blank" rel="noopener noreferrer">
      <strong>{widget.props?.title || url}</strong>
      <span>{url}</span>
    </a>
  )
}

function SiteFrame({ widget, frame }) {
  const title = frame?.title || widget.props?.title || frame?.siteId || widget.props?.siteId || "Site"
  const preview = frame?.snapshot ? (
    <picture>
      {frame.snapshotDark && <source srcSet={assetUrl(frame.snapshotDark)} media="(prefers-color-scheme: dark)" />}
      <img src={assetUrl(frame.snapshot)} alt={title} loading="lazy" />
    </picture>
  ) : <div className="widget-site-frame-empty">{frame?.warning || "Preview unavailable"}</div>
  return (
    <figure className="widget-site-frame">
      {frame?.openUrl ? <a href={frame.openUrl} target="_blank" rel="noopener noreferrer">{preview}</a> : preview}
      <figcaption>{title} <small>{frame?.route || widget.props?.route || "/"}</small>{!frame?.openUrl && <small>Production URL unavailable</small>}</figcaption>
    </figure>
  )
}

function UnavailableWidget({ widget }) {
  return (
    <div className="widget-unavailable">
      <strong>{widget.type || "widget"}</strong>
      <span>Not available in this published presentation.</span>
    </div>
  )
}

const WIDGET_RENDERERS = {
  'sticky-note': StickyNote,
  markdown: MarkdownBlock,
  image: ImageWidget,
  'link-preview': LinkPreview,
  'site-frame': SiteFrame,
}

function Widget({ widget, siteFrames }) {
  const Renderer = WIDGET_RENDERERS[widget.type] || UnavailableWidget
  const box = widgetBox(widget)
  return (
    <div className="canvas-widget" style={{ left: box.x, top: box.y, width: box.width, height: box.height }}>
      <Renderer widget={widget} frame={siteFrames?.[widget.id]} />
    </div>
  )
}

function Connectors({ connectors, widgets }) {
  if (!connectors.length) return null
  const byId = new Map(widgets.map((widget) => [widget.id, widget]))
  const center = (id) => {
    const box = widgetBox(byId.get(id) || {})
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  return (
    <svg className="canvas-connectors" aria-hidden="true">
      {connectors.map((connector, index) => {
        if (!byId.has(connector?.start?.widgetId) || !byId.has(connector?.end?.widgetId)) return null
        const a = center(connector.start.widgetId)
        const b = center(connector.end.widgetId)
        return <line key={connector.id || index} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      })}
    </svg>
  )
}

function SourcesPanel({ sources }) {
  if (!sources.length) return null
  return (
    <section className="sources">
      <h2>View Source</h2>
      <ul>
        {sources.map((source, index) => (
          <li key={source.export || index}>
            <span className="sources-name">{String(source.export || "source")}</span>
            {source.url
              ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.url}</a>
              : <span className="sources-hint">No link recorded</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function CanvasPage({ page, state }) {
  if (!state) {
    return (
      <main className="page">
        <h1>{page.title}</h1>
        <p className="page-unavailable">Canvas content is unavailable.</p>
      </main>
    )
  }
  const widgets = state.widgets || []
  const connectors = state.connectors || []
  const boxes = widgets.map((widget) => widgetBox(widget))
  const width = Math.max(720, ...boxes.map((box) => box.x + box.width)) + 96
  const height = Math.max(480, ...boxes.map((box) => box.y + box.height)) + 96
  return (
    <main className="page">
      <div className="page-heading">
        <h1>{state.title || page.title}</h1>
        <span className="page-type">Canvas</span>
      </div>
      <div
        className="canvas-surface"
        data-grid={state.grid ? "true" : undefined}
        data-color-mode={state.colorMode && state.colorMode !== "auto" ? state.colorMode : undefined}
        style={{ "--grid-size": (state.gridSize || 24) + "px", width, height }}
      >
        {widgets.map((widget) => <Widget key={widget.id} widget={widget} siteFrames={state.siteFrames} />)}
        <Connectors connectors={connectors} widgets={widgets} />
      </div>
      <SourcesPanel sources={state.sources || []} />
    </main>
  )
}
