/**
 * Route table for the isolated stories iframe (`/stories.html/components/...`).
 *
 * Mirrors the canvas SPA's story-route matching but built as a real react-router
 * route table so the route lives in the URL (deep-linkable, "open in new tab"
 * works) and a broken `.story.jsx` only crashes the matched story — not the
 * canvas chrome (module-graph isolation: each .story.jsx is dynamic-imported
 * by StoryPage._storyImport, not eagerly globbed).
 *
 * Uses a single splat route — the story name is derived at render time by
 * matching the full route path against the stories index (`_route` field).
 * Falls back to a friendly "story not found" message when no match.
 */
import { lazy, Suspense } from 'react'
import { useLocation } from 'react-router-dom'
import { stories } from 'virtual:storyboard-data-index'

const StoryPageLazy = lazy(() => import('../../story/StoryPage.jsx'))

function resolveStoryName(pathname) {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  for (const [name, data] of Object.entries(stories || {})) {
    if (data?._route && data._route.replace(/\/+$/, '') === normalized) {
      return name
    }
  }
  return null
}

function StoryRouteComponent() {
  const location = useLocation()
  const storyName = resolveStoryName(location.pathname)

  if (!storyName) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', color: 'var(--color-foreground-muted, #57606a)' }}>
        <strong>Story not found</strong>
        <br />
        <code>{location.pathname}</code>
      </div>
    )
  }

  return (
    <Suspense fallback={null}>
      <StoryPageLazy name={storyName} />
    </Suspense>
  )
}

export const storyRoutes = [
  { path: '/components', element: <StoryRouteComponent /> },
  { path: '/components/*', element: <StoryRouteComponent /> },
  { path: '*', element: <StoryRouteComponent /> },
]
