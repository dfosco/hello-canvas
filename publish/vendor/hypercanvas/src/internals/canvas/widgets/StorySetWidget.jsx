/**
 * StorySetWidget — renders all exports from a story in a single iframe grid.
 *
 * Instead of N iframes (one per export), this widget loads one iframe pointing
 * to the isolate-set endpoint. Each export renders in a grid cell inside
 * that single page. The user can select a cell (via label click) which updates
 * `props.selected` — visible to connected agents.
 *
 * User-facing label: "Component Set"
 *
 * Props: { storyId, layout, selected, width, height }
 */
import { forwardRef, useImperativeHandle, useRef, useCallback, useState, useEffect, useMemo } from 'react'
import { getStoryData } from '../../../core/index.js'
import { useThemeState, useThemeSyncTargets } from '../../hooks/useThemeState.js'
import Icon from '../../Icon.jsx'
import WidgetWrapper from './WidgetWrapper.jsx'
import ResizeHandle from './ResizeHandle.jsx'
import ExpandedPane from './ExpandedPane.jsx'
import { buildSecondaryIframeUrl, getSplitPaneLabel } from './expandUtils.js'
import { useExpandOverride } from './useExpandOverride.js'
import { useIframeDevLogs } from './iframeDevLogs.js'
import { getStoryPathByName } from './storyPath.js'
import overlayStyles from './embedOverlay.module.css'

function GridIcon({ size = 16 }) {
  return <Icon name="iconoir/view-grid" size={size} />
}

function resolveStorySetUrl(storyId, layout, selected, density, theme) {
  const story = getStoryData(storyId)
  if (!story?._storyModule) return ''
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')

  // Route through the shared iframe-isolation entry in dev so a broken
  // .story.jsx can't poison the canvas SPA's module graph. The real story
  // route handles it in prod (no isolation middleware in deployed builds).
  const params = new URLSearchParams()
  params.set('_sb_embed', '')
  params.set('_sb_component_set', '')
  // Force the prototype surface inside the iframe to follow the global
  // theme. themeBootstrap only writes a theme's companion attrs
  // (data-color-mode, data-light-theme, data-dark-theme) to <html> for
  // the prototype surface — so any other target would leave Primer
  // components rendering in light mode regardless of the canvas theme.
  params.set('_sb_theme_target', 'prototype')
  if (layout) params.set('layout', layout)
  if (density) params.set('density', density)
  if (theme) params.set('theme', theme)

  // `selected` lives in the URL hash, not the query string, so that
  // selecting a different variant is a same-document fragment navigation
  // when React reassigns iframe.src — no iframe reload. See
  // ComponentSetPage.handleSelect for the matching producer.
  const hash = selected ? `#selected=${encodeURIComponent(selected)}` : ''

  const route = story._route || `/components/${storyId}`
  if (import.meta.env.DEV) {
    return `${base}/stories.html${route}?${params}${hash}`
  }
  return `${base}${route}?${params}${hash}`
}

export default forwardRef(function StorySetWidget({ id: widgetId, props, onUpdate, resizable }, ref) {
  const storyId = props?.storyId || ''
  const rawLayout = props?.layout || 'auto'
  // Migrate legacy values (horizontal/vertical) to the new vocabulary.
  const layout = rawLayout === 'horizontal' ? 'wide' : rawLayout === 'vertical' ? 'tall' : rawLayout
  const density = props?.density || ''
  const selected = props?.selected || ''
  const width = props?.width
  const height = props?.height

  const containerRef = useRef(null)
  const iframeRef = useRef(null)
  const contentSizeRef = useRef({ width: 0, height: 0 })
  const [snapping, setSnapping] = useState(false)
  const [interactive, setInteractive] = useState(false)
  // Track which src URL has fired its onLoad callback so we can overlay a
  // spinner while a new iframe is fetching. Stored as the URL itself so
  // changing src naturally invalidates the loaded state without an effect.
  const [loadedSrc, setLoadedSrc] = useState(null)
  const [storyIndexKey, setStoryIndexKey] = useState(0)
  const [expandedMode, setExpandedMode] = useExpandOverride('storyset', widgetId)
  const expanded = expandedMode === '1' || expandedMode === 'immersive'
  const immersive = expandedMode === 'immersive'
  const setExpanded = useCallback((mode) => {
    if (!mode) setExpandedMode(null)
    else if (mode === 'immersive') setExpandedMode('immersive')
    else setExpandedMode('1')
  }, [setExpandedMode])

  // Re-resolve when story index is live-patched
  useEffect(() => {
    const handler = () => setStoryIndexKey((k) => k + 1)
    document.addEventListener('storyboard:story-index-changed', handler)
    return () => document.removeEventListener('storyboard:story-index-changed', handler)
  }, [])

  const enterInteractive = useCallback(() => setInteractive(true), [])

  // Exit interactive mode when clicking outside
  useEffect(() => {
    if (!interactive) return
    function handlePointerDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        const chromeEl = e.target.closest(`[data-widget-id="${widgetId}"]`)
        if (chromeEl) return
        setInteractive(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [interactive, widgetId])

  // Listen for selection messages from the embedded grid
  useEffect(() => {
    function handleMessage(e) {
      if (e.source !== iframeRef.current?.contentWindow) return
      if (e.data?.type === 'storyboard:component-set:select') {
        const newSelected = e.data.exportName || ''
        if (newSelected !== selected) {
          onUpdate?.({ selected: newSelected })
        }
      } else if (e.data?.type === 'storyboard:component-set:initial-size') {
        // Only honor the initial size hint when the widget has no dimensions
        // yet — never override a user-resized widget.
        if (typeof width === 'number' && typeof height === 'number') return
        const headerH = 37
        const newW = typeof width === 'number' ? width : Math.max(200, Math.ceil(e.data.width))
        const newH = typeof height === 'number' ? height : Math.max(120, Math.ceil(e.data.height) + headerH + 8)
        onUpdate?.({ width: newW, height: newH })
      } else if (e.data?.type === 'storyboard:component-set:content-size') {
        contentSizeRef.current = {
          width: Math.ceil(e.data.width) || 0,
          height: Math.ceil(e.data.height) || 0,
        }
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [selected, width, height, onUpdate])

  const handleResize = useCallback((w, h) => {
    onUpdate?.({ width: w, height: h })
  }, [onUpdate])

  // On resize end: if the widget is larger than the content grid needs in
  // either axis, snap that axis down to fit (with a CSS transition for a
  // smooth settle).
  const handleResizeEnd = useCallback((w, h) => {
    const headerH = 37
    const contentH = contentSizeRef.current.height
    const contentW = contentSizeRef.current.width
    if (!contentH && !contentW) return
    const fitH = contentH ? contentH + headerH + 8 : h
    const fitW = contentW || w
    const shouldSnapH = contentH && h > fitH + 2
    const shouldSnapW = contentW && w > fitW + 2
    if (!shouldSnapH && !shouldSnapW) return
    setSnapping(true)
    onUpdate?.({
      width: shouldSnapW ? fitW : w,
      height: shouldSnapH ? fitH : h,
    })
    setTimeout(() => setSnapping(false), 260)
  }, [onUpdate])

  useImperativeHandle(ref, () => ({
    getIframeWindow() {
      try {
        return iframeRef.current?.contentWindow ?? null
      } catch {
        return null
      }
    },
    handleAction(actionId, opts) {
      if (actionId === 'expand' || actionId === 'expand-single') {
        setExpanded(opts?.altKey ? 'immersive' : 'open')
        return true
      } else if (actionId === 'refresh-frame') {
        const iframe = iframeRef.current
        if (iframe) {
          // Clear loadedSrc BEFORE reassigning so the dark-themed
          // placeholder overlays the iframe during reload. Without this,
          // loadedSrc === iframeSrc stays true (same URL), the placeholder
          // never appears, and the iframe's intrinsic white background
          // flashes through during navigation.
          setLoadedSrc(null)
          // eslint-disable-next-line no-self-assign
          iframe.src = iframe.src
        }
        return true
      } else if (actionId === 'open-external') {
        const story = getStoryData(storyId)
        if (story?._route) {
          const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
          window.open(`${base}${story._route}`, '_blank', 'noopener')
        }
        return true
      } else if (actionId === 'edit-source') {
        ;(async () => {
          const src = await getStoryPathByName(storyId)
          if (!src) return
          document.dispatchEvent(new CustomEvent('storyboard:canvas:add-widget', {
            detail: { type: 'file', props: { path: src }, near: widgetId, direction: 'right' },
          }))
        })()
        return true
      }
    },
  }), [storyId, setExpanded])

  const { resolved: resolvedTheme } = useThemeState() || {}
  const { prototype: prototypeSync } = useThemeSyncTargets() || {}
  const effectiveTheme = prototypeSync ? (resolvedTheme || 'light') : 'light'

  const iframeSrc = useMemo(
    () => resolveStorySetUrl(storyId, layout, selected, density, effectiveTheme),
    // storyIndexKey forces re-evaluation when HMR mutates the story index
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storyId, layout, selected, density, storyIndexKey, effectiveTheme],
  )

  useIframeDevLogs({
    widget: 'StorySetWidget',
    loaded: interactive && Boolean(iframeSrc),
    src: iframeSrc,
  })

  const displayName = storyId || 'Component Set'

  if (!storyId) {
    return (
      <WidgetWrapper>
        <div
          ref={containerRef}
          className="relative overflow-hidden min-w-[200px] min-h-[120px] w-full h-full rounded-lg bg-background shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
        >
          <div className="flex items-center gap-2 p-4 text-sm leading-snug font-[system-ui,-apple-system,sans-serif] text-foreground-danger">
            <span className="text-xl flex-shrink-0"><GridIcon size={20} /></span>
            <span className="break-words">Missing story ID</span>
          </div>
        </div>
      </WidgetWrapper>
    )
  }

  if (!iframeSrc) {
    return (
      <WidgetWrapper>
        <div
          ref={containerRef}
          className="relative overflow-hidden min-w-[200px] min-h-[120px] w-full h-full rounded-lg bg-background shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
        >
          <div className="flex items-center gap-2 p-4 text-sm leading-snug font-[system-ui,-apple-system,sans-serif] text-foreground-danger">
            <span className="text-xl flex-shrink-0"><GridIcon size={20} /></span>
            <span className="break-words">Story &ldquo;{storyId}&rdquo; not found or has no route</span>
          </div>
        </div>
      </WidgetWrapper>
    )
  }

  const sizeStyle = {}
  if (typeof width === 'number') sizeStyle.width = `${width}px`
  if (typeof height === 'number') sizeStyle.height = `${height}px`
  if (snapping) sizeStyle.transition = 'width 220ms cubic-bezier(0.2, 0.8, 0.2, 1), height 220ms cubic-bezier(0.2, 0.8, 0.2, 1)'

  return (
    <>
    <WidgetWrapper>
      <div
        ref={containerRef}
        className="relative overflow-hidden min-w-[200px] min-h-[120px] w-full h-full rounded-lg bg-background shadow-[0_4px_16px_rgba(0,0,0,0.08)] flex flex-col"
        style={sizeStyle}
      >
        <div className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap overflow-hidden text-ellipsis select-none border-b border-border-muted bg-background-muted text-foreground-muted">
          <span className="inline-flex flex-shrink-0"><GridIcon size={16} /></span>
          <span className="overflow-hidden text-ellipsis">{displayName}</span>
          {selected && (
            <span className="font-semibold flex-shrink-0 text-foreground-accent">· {selected}</span>
          )}
        </div>
        <div className="relative w-full flex-1 min-h-0">
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            className="absolute inset-0 block w-full h-full border-0 z-[1] bg-background-muted"
            title={`${displayName} component set`}
            onLoad={(e) => { e.target.blur(); setLoadedSrc(iframeSrc) }}
          />
          {loadedSrc !== iframeSrc && (
            <div
              className="absolute inset-0 z-[2] flex flex-col items-center justify-center gap-2 text-center bg-background-muted text-foreground-muted"
              aria-hidden="true"
            >
              <div className="w-10 h-10 rounded-full animate-spin border-t-foreground-accent" />
            </div>
          )}
        </div>
        {!interactive && (
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
            aria-label="Click to interact"
          >
            <span className={overlayStyles.interactHint}>Click to interact</span>
          </div>
        )}
      </div>
      {resizable && <ResizeHandle targetRef={containerRef} width={width} height={height} onResize={handleResize} onResizeEnd={handleResizeEnd} />}
    </WidgetWrapper>
    {expanded && (
      <ComponentSetExpandPane
        widgetId={widgetId}
        storyId={storyId}
        layout={layout}
        selected={selected}
        immersive={immersive}
        onClose={() => setExpanded(null)}
      />
    )}
    </>
  )
})

function ComponentSetExpandPane({ widgetId, storyId, layout, selected, immersive, onClose }) {
  const url = useMemo(
    () => buildSecondaryIframeUrl({ type: 'component-set', props: { storyId, layout, selected } }),
    [storyId, layout, selected],
  )
  const label = useMemo(
    () => getSplitPaneLabel({ type: 'component-set', props: { storyId } }),
    [storyId],
  )

  const pane = useMemo(() => ({
    id: widgetId,
    label,
    widgetType: 'component-set',
    kind: 'react',
    render: () => url
      ? <iframe src={url} style={{ border: 'none', width: '100%', height: '100%', display: 'block' }} title={storyId} onLoad={(e) => e.target.blur()} />
      : <div style={{ padding: 32, color: 'var(--color-foreground-muted)' }}>Story &quot;{storyId}&quot; not found</div>,
  }), [widgetId, label, url, storyId])

  return (
    <ExpandedPane
      initialPanes={[pane]}
      variant={immersive ? 'immersive' : 'modal'}
      onClose={onClose}
    />
  )
}
