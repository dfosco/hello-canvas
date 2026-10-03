/**
 * ComponentSetPage — renders all exports from a .story.jsx in a grid.
 *
 * Mounted when StoryPage detects `?_sb_component_set` in the URL.
 * Each export gets its own grid cell with a selectable label header.
 *
 * URL params:
 *   layout   — "horizontal" (default) | "vertical"
 *   selected — export name of the currently selected cell
 *
 * Selection: clicking a cell label updates `?selected=` and posts
 * `storyboard:component-set:select` to the parent window so the
 * canvas widget can track which export the user picked.
 */
import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, Suspense } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getStoryData } from '../../core/index.js'
import { getStoryWrapper } from '../loadConsumerWrapper.js'
import usePrototypeReloadGuard from '../hooks/usePrototypeReloadGuard.js'
import styles from './ComponentSetPage.module.css'

const StoryWrapper = getStoryWrapper()

function parseHashSelected(hash) {
  if (!hash) return ''
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash
  if (!trimmed) return ''
  try {
    const params = new URLSearchParams(trimmed)
    return params.get('selected') || ''
  } catch {
    return ''
  }
}

export default function ComponentSetPage({ name }) {
  const location = useLocation()
  const navigate = useNavigate()
  const searchParams = new URLSearchParams(location.search)

  const layout = searchParams.get('layout') || 'auto'
  const density = searchParams.get('density') || 'comfy'
  const selected = parseHashSelected(location.hash)
  const isEmbed = searchParams.has('_sb_embed')

  // Same reload-guard policy as StoryPage / prototype embeds.
  usePrototypeReloadGuard({ enabled: isEmbed })

  const story = useMemo(() => getStoryData(name), [name])
  const [exports, setExports] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!story?._storyImport) {
      Promise.resolve().then(() => setError(`Story "${name}" not found or missing import`))
      return
    }

    let cancelled = false
    story._storyImport()
      .then((mod) => {
        if (cancelled) return
        const namedExports = {}
        for (const [key, value] of Object.entries(mod)) {
          if (key !== 'default' && typeof value === 'function') {
            // Opt-out: exports with `componentSet = false` are excluded
            // from the grid (e.g. showcase exports that already render
            // every variant themselves).
            if (value.componentSet === false) continue
            namedExports[key] = value
          }
        }
        setExports(namedExports)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(`Failed to load story "${name}": ${err.message || err}`)
      })

    return () => { cancelled = true }
  }, [name, story])

  // Signal snapshot-ready after grid renders in embed mode
  useEffect(() => {
    if (!isEmbed || !exports || window.parent === window) return
    document.fonts.ready.then(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.__sbSnapshotReady?.()
      }))
    })
  }, [isEmbed, exports])

  const gridRef = useRef(null)

  // Post size info to parent widget so the canvas can auto-fit on first
  // render AND snap-to-content on resize end.
  //
  // Two messages, mirrored from the legacy componentSetIsolate.jsx:
  //   - :initial-size — squarish layout hint computed from the *max* cell
  //     dimensions, used by StorySetWidget when the widget has no width/height
  //     set yet.
  //   - :content-size — live cell-bounding-box extent, used by StorySetWidget
  //     to snap width/height down to fit after a user resize. Measured from
  //     bounding boxes (not scrollWidth/scrollHeight) so the reported size
  //     reflects the *natural* cell extent — scrollWidth always matches the
  //     container width when the widget is wider than needed, which would
  //     defeat width-snapping.
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid || !exports) return
    if (!isEmbed || window.parent === window) return

    let postedInitial = false
    function postInitialSize() {
      if (postedInitial) return
      const cells = grid.querySelectorAll(`.${styles.cell}`)
      if (cells.length === 0) return
      let maxW = 0
      let maxH = 0
      cells.forEach((cell) => {
        const r = cell.getBoundingClientRect()
        if (r.width > maxW) maxW = r.width
        if (r.height > maxH) maxH = r.height
      })
      if (maxW < 10 || maxH < 10) return
      const count = cells.length
      const cols = Math.max(1, Math.min(count, Math.ceil(Math.sqrt(count))))
      const rows = Math.ceil(count / cols)
      const gap = 16
      const pad = 32 // 16px padding on both sides
      const width = Math.ceil(maxW * cols + gap * (cols - 1) + pad)
      const height = Math.ceil(maxH * rows + gap * (rows - 1) + pad)
      postedInitial = true
      window.parent.postMessage({
        type: 'storyboard:component-set:initial-size',
        width,
        height,
      }, '*')
    }

    function postContentSize() {
      const cells = grid.querySelectorAll(`.${styles.cell}`)
      if (!cells.length) return
      const gridRect = grid.getBoundingClientRect()
      let maxRight = 0
      let maxBottom = 0
      cells.forEach((cell) => {
        const r = cell.getBoundingClientRect()
        const right = r.right - gridRect.left
        const bottom = r.bottom - gridRect.top
        if (right > maxRight) maxRight = right
        if (bottom > maxBottom) maxBottom = bottom
      })
      const pad = 16 // mirror grid padding
      window.parent.postMessage({
        type: 'storyboard:component-set:content-size',
        width: Math.ceil(maxRight + pad),
        height: Math.ceil(maxBottom + pad),
      }, '*')
    }

    requestAnimationFrame(() => requestAnimationFrame(postInitialSize))
    document.fonts.ready.then(() => requestAnimationFrame(postInitialSize))

    const ro = new ResizeObserver(postContentSize)
    ro.observe(grid)
    return () => ro.disconnect()
  }, [exports, layout, density, isEmbed])

  const handleSelect = useCallback((exportName) => {
    const isToggleOff = exportName === selected
    const newSelected = isToggleOff ? '' : exportName
    const hash = newSelected ? `#selected=${encodeURIComponent(newSelected)}` : ''
    // Preserve current search params; only flip the fragment. The parent
    // widget keeps `selected` in the URL hash specifically so this update
    // round-trips as a same-document fragment change — no iframe reload.
    navigate(`${location.pathname}${location.search}${hash}`, { replace: true })

    // Notify parent widget
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'storyboard:component-set:select',
        storyId: name,
        exportName: newSelected || null,
      }, '*')
    }
  }, [location, navigate, name, selected])

  if (error) {
    return (
      <div className={styles.error}>
        <strong>Component Set Error</strong>
        <span>{error}</span>
      </div>
    )
  }

  if (!exports) {
    if (isEmbed) return null
    return <div className={styles.loading}>Loading component set…</div>
  }

  const exportNames = Object.keys(exports)

  return (
    <Suspense fallback={null}>
      <StoryWrapper>
        <div
          ref={gridRef}
          className={styles.grid}
          data-layout={layout}
          data-density={density}
        >
          {exportNames.map((exportName) => {
            const Component = exports[exportName]
            const isSelected = exportName === selected
            const cellStyle = typeof Component.minHeight === 'number'
              ? { '--cell-min-h': `${Component.minHeight}px` }
              : undefined
            return (
              <div
                key={exportName}
                className={styles.cell}
                data-selected={isSelected || undefined}
                style={cellStyle}
              >
                <button
                  className={styles.cellLabel}
                  onClick={() => handleSelect(exportName)}
                  data-selected={isSelected || undefined}
                  aria-pressed={isSelected}
                >
                  <span className={styles.cellRadio} data-selected={isSelected || undefined} />
                  <span className={styles.cellName}>{exportName}</span>
                </button>
                <div className={styles.cellContent} data-cell-content>
                  <Component />
                </div>
              </div>
            )
          })}
        </div>
      </StoryWrapper>
    </Suspense>
  )
}
