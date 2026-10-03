/**
 * StoryPage — renders a .story.jsx module at its own route.
 *
 * Renders only the bare component(s) with no layout chrome.
 * When ?export=ExportName is present, renders that single export.
 * Without ?export, renders all named exports stacked.
 */
import { useState, useEffect, useMemo, lazy, Suspense } from 'react'
import { useLocation } from 'react-router-dom'
import { getStoryData } from '../../core/index.js'
import { getStoryWrapper } from '../loadConsumerWrapper.js'
import usePrototypeReloadGuard from '../hooks/usePrototypeReloadGuard.js'
import styles from './StoryPage.module.css'

const StoryWrapper = getStoryWrapper()

const ComponentSetPageLazy = lazy(() => import('./ComponentSetPage.jsx'))

function StoryErrorFallback({ name, error }) {
  return (
    <div className={styles.error}>
      <strong>{name}</strong>
      <span>{String(error?.message || error)}</span>
    </div>
  )
}

export default function StoryPage({ name }) {
  const location = useLocation()
  const searchParams = new URLSearchParams(location.search)
  const exportFilter = searchParams.get('export')
  const isEmbed = searchParams.has('_sb_embed')
  const isComponentSet = searchParams.has('_sb_component_set')

  // Share the same reload-guard policy as prototypes: drop full-reloads so
  // the embedding canvas's data-file edits don't flash the story iframe,
  // but let `update` payloads through so React Fast Refresh works.
  usePrototypeReloadGuard({ enabled: isEmbed })

  const story = useMemo(() => getStoryData(name), [name])
  const [exports, setExports] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (isComponentSet) return
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
  }, [name, story, isComponentSet])

  // Signal snapshot-ready after story renders in embed mode.
  useEffect(() => {
    if (!isEmbed || !exports || window.parent === window) return
    document.fonts.ready.then(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.__sbSnapshotReady?.()
      }))
    })
  }, [isEmbed, exports])

  // Delegate to ComponentSetPage for grid view (after all hooks)
  if (isComponentSet) {
    return (
      <Suspense fallback={isEmbed ? null : <div className={styles.loading}>Loading component set…</div>}>
        <ComponentSetPageLazy name={name} />
      </Suspense>
    )
  }

  if (error) {
    return (
      <StoryErrorFallback name={name} error={error} />
    )
  }

  if (!exports) {
    if (isEmbed) return null
    return (
      <div className={styles.loading}>Loading story…</div>
    )
  }

  // Single export mode
  if (exportFilter) {
    const Component = exports[exportFilter]
    if (!Component) {
      return (
        <StoryErrorFallback
          name={`${name}/${exportFilter}`}
          error={`Export "${exportFilter}" not found in story "${name}"`}
        />
      )
    }

    return (
      <Suspense fallback={null}>
        <StoryWrapper>
          <Component />
        </StoryWrapper>
      </Suspense>
    )
  }

  // All exports — render each component bare
  const exportNames = Object.keys(exports)

  return (
    <Suspense fallback={null}>
      <StoryWrapper>
        {exportNames.map((exportName) => {
          const Component = exports[exportName]
          return <Component key={exportName} />
        })}
      </StoryWrapper>
    </Suspense>
  )
}
