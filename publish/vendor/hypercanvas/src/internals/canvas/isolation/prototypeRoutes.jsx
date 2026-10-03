/**
 * Library-side prototype routes builder for the isolated prototypes iframe.
 *
 * Mirrors the consumer-scaffold convention (src/routes.jsx) but lives inside
 * the library so consumers no longer need to maintain their own
 * prototypes-entry plumbing. Uses absolute globs (`/src/prototypes/...`),
 * which Vite resolves against the *consumer's* project root regardless of
 * where this file physically lives.
 *
 * Used by `prototypesEntry.jsx`, which is the iframe entry served by the
 * `prototypes.html` middleware in `data-plugin.js`.
 */
import { Fragment, Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import {
  generatePreservedRoutes,
  generateRegularRoutes,
  generateModalRoutes,
  patterns,
} from '@generouted/react-router/core'
import PrototypeErrorBoundary, { ImportErrorFallback } from '../../PrototypeErrorBoundary.jsx'
import { filterChildrenForProto } from './routeFilter.js'
// Notebook prototypes live outside the application root (the glob below
// resolves against the Vite root), so they reach us through the
// data-plugin-hosted route map instead. Notebook entries win on route-key
// collisions — user content is what the canvas is editing.
import { PROTOTYPE_ROUTES as NOTEBOOK_PROTOTYPE_ROUTES } from 'virtual:storyboard-notebook-prototype-routes'

// Strip src/library/, src/prototypes/, .folder/, and `drafts/` segments
// from route paths. `_app.jsx` lives in src/library/ (since
// b144dace5); user-authored prototype routes live in src/prototypes/.
// Both prefixes are stripped so the generated route paths (and the
// preservedRoutes _app key) come out clean.
//
// A `drafts/` dir is a gitignored scratch root — prototypes inside route at
// the same URL as a non-prefixed sibling. The lookbehind ensures we only
// match `drafts/` as a directory segment, not as part of a filename.
patterns.route = [/^.*\/src\/(library|prototypes)\/|^\/(library|prototypes)\/|[^/]*\.folder\/|(?<=^|\/)drafts\/|\.(jsx|tsx|mdx)$/g, '']

// `_app.jsx` lives in src/library/ — it's the consumer's SPA shell that
// wraps every route in <StoryboardProvider>. Without this glob hitting
// the right path, the iframe entry would render prototypes with no
// provider and any useFlowData / useObject / useRecord call would crash.
const PRESERVED = import.meta.glob('/src/library/(_app|404).{jsx,tsx}', { eager: true })
const MODALS = import.meta.glob('/src/prototypes/**/[+]*.{jsx,tsx}', { eager: true })

// Lazy-load prototype routes — only the matched route's module is fetched.
// This prevents story/canvas URLs from paying for every prototype page's
// imports (Primer, Reshaped, user components, etc.) on first load.
const ROUTES = import.meta.glob(
  ['/src/prototypes/**/[\\w[-]*.{jsx,tsx,mdx}', '!/src/prototypes/**/(_!(layout)*(/*)?|_app|404)*'],
)

const ALL_ROUTES = { ...ROUTES, ...NOTEBOOK_PROTOTYPE_ROUTES }

const preservedRoutes = generatePreservedRoutes(PRESERVED)
const modalRoutes = generateModalRoutes(MODALS)

const regularRoutes = generateRegularRoutes(ALL_ROUTES, (importFn, key) => {
  const index = /index\.(jsx|tsx|mdx)$/.test(key) && !key.includes('prototypes/index') ? { index: true } : {}
  return {
    ...index,
    lazy: async () => {
      try {
        const module = await importFn()
        const Default = module?.default || Fragment
        const Page = () =>
          module?.Pending ? (
            <Suspense fallback={<module.Pending />}>
              <Default />
            </Suspense>
          ) : (
            <Default />
          )
        return {
          Component: Page,
          ErrorBoundary: module?.Catch || PrototypeErrorBoundary,
          loader: module?.Loader,
          action: module?.Action,
        }
      } catch (err) {
        return {
          Component: () => <ImportErrorFallback error={err} route={key} />,
        }
      }
    },
  }
})

const _app = preservedRoutes?.['_app']
const _404 = preservedRoutes?.['404']
const Default = _app?.default || Outlet

// eslint-disable-next-line react-refresh/only-export-components
const Modals_ = () => {
  const Modal = modalRoutes[useLocation().state?.modal] || Fragment
  return <Modal />
}

// eslint-disable-next-line react-refresh/only-export-components
const Layout = () => (
  <>
    <Default /> <Modals_ />
  </>
)

// eslint-disable-next-line react-refresh/only-export-components
const App = () =>
  _app?.Pending ? (
    <Suspense fallback={<_app.Pending />}>
      <Layout />
    </Suspense>
  ) : (
    <Layout />
  )

const app = { Component: _app?.default ? App : Layout, ErrorBoundary: _app?.Catch, loader: _app?.Loader }
const fallback = { path: '*', Component: _404?.default || Fragment }

export const routes = [{ ...app, children: [...regularRoutes, fallback] }]

/**
 * Filter a route tree's children down to a single prototype subtree.
 *
 * Pure helper (no module-level globs) so it's unit-testable. Keeps `*` and
 * pathless layout wrappers (descending into the latter to reach the prototype
 * routes). Any route WITH a path is kept iff its first segment matches the
 * requested proto — and when it matches we keep its ENTIRE subtree intact,
 * since generouted nests sub-routes under the prototype (e.g.
 * `canvas-threats/threats` → a `threats` child of `canvas-threats`).
 * Re-filtering those children by first segment would drop them because their
 * own path segment isn't the proto name — that was the nested-route bug.
 */
export { filterChildrenForProto } from './routeFilter.js'

/**
 * Return a routes tree filtered to a single prototype subtree. Used by the
 * per-prototype iframe entry — filtering at this layer keeps a broken
 * sibling prototype from ever appearing in the matched route's lazy() chain
 * (only the requested prototype's modules are reachable from the router).
 */
export function getRoutesForProto(proto) {
  if (!proto) return routes
  return [{ ...routes[0], children: filterChildrenForProto(routes[0].children || [], proto) }]
}
