/**
 * Shared mount helper for isolated iframe entries.
 *
 * Used by `prototypesEntry.jsx` and `storiesEntry.jsx` — they both:
 *   1. Read `storyboard.config.json` via import.meta.glob
 *   2. Call `mountStoryboardCore` so the embed gets ui-runtime CSS, theme
 *      sync, and the iframe→parent postMessage bridge
 *   3. Mount a React tree with `createBrowserRouter` scoped to the entry
 *      page (basename = `${BASE_URL}/${name}`)
 *
 * Centralizing this here means bug fixes / iterations land in one place
 * for both surfaces. Each surface entry shrinks to a few lines:
 *
 *   import { routes, getRoutesForProto } from './prototypeRoutes.jsx'
 *   import { mountIsolationApp } from './mountIsolationApp.jsx'
 *   mountIsolationApp({
 *     name: 'prototypes.html',
 *     wrapperKind: 'prototype',
 *     resolveRoutes: ({ firstSegment, search }) => {
 *       const proto = firstSegment || search.get('proto') || ''
 *       return proto ? getRoutesForProto(proto) : routes
 *     },
 *   })
 *
 * Provider chain: the consumer's `src/_prototype.jsx` (or `src/_story.jsx`)
 * wraps the routes. When absent, both wrappers degrade to a Fragment
 * pass-through — prototypes render with no shared providers (blank slate).
 *
 * @param {object} opts
 * @param {string} opts.name                          — entry name, e.g. 'prototypes.html'
 * @param {'prototype' | 'story'} [opts.wrapperKind='prototype']
 *        — which consumer wrapper to mount around the router. Prototype
 *          uses `src/_prototype.jsx`, story uses `src/_story.jsx`.
 * @param {RouteObject[]} [opts.routes]               — fixed route table (used when resolveRoutes is omitted)
 * @param {(ctx) => RouteObject[]} [opts.resolveRoutes]
 *        — callback that returns the route table to mount, given
 *          `{ basename, pathname, search, firstSegment }`. Use this when a
 *          surface needs to narrow routes per-request (e.g. prototypes
 *          isolate a broken sibling proto from the matched lazy() chain).
 */
import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import { mountStoryboardCore } from '../../../core/index.js'
import { getPrototypeWrapper, getStoryWrapper } from '../../loadConsumerWrapper.js'
import '../../../core/comments/ui/comment-layout.css'

const configModules = import.meta.glob('/storyboard.config.json', { eager: true })

export function mountIsolationApp({ name, wrapperKind = 'prototype', routes, resolveRoutes }) {
  const storyboardConfig = Object.values(configModules)[0]?.default || {}

  // Mount storyboard core. In embed mode (`_sb_embed` in the URL — always true
  // for canvas iframes) this short-circuits past UI mounting and only:
  //   - applies the canvas-aware theme (_sb_theme_target, _sb_canvas_theme)
  //   - sets up the iframe→parent postMessage navigation/wheel bridge
  mountStoryboardCore(storyboardConfig, { basePath: import.meta.env.BASE_URL })

  const basePathNoTrail = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  const basename = `${basePathNoTrail}/${name}`

  const pathname = window.location.pathname
  const search = new URLSearchParams(window.location.search)
  const afterBasename = pathname.startsWith(basename) ? pathname.slice(basename.length) : ''
  const firstSegment = (afterBasename.match(/^\/([^/?#]+)/) || [])[1] || ''

  const activeRoutes = resolveRoutes
    ? resolveRoutes({ basename, pathname, search, firstSegment })
    : routes

  const router = createBrowserRouter(activeRoutes, { basename })

  const Wrapper = wrapperKind === 'story' ? getStoryWrapper() : getPrototypeWrapper()

  const rootElement = document.getElementById('root')
  const root = createRoot(rootElement)

  root.render(
    <StrictMode>
      <Suspense fallback={null}>
        <Wrapper>
          <RouterProvider router={router} />
        </Wrapper>
      </Suspense>
    </StrictMode>,
  )
}

