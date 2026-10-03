/**
 * DO NOT EDIT — storyboard-owned library file.
 *
 * Synced from @dfosco/storyboard. Customize via src/_prototype.jsx (wraps
 * every prototype route) or src/library/_app.jsx (workspace SPA shell).
 * See src/library/README.md for the full customization surface.
 *
 * Custom generouted routes entry for storyboard.
 *
 * generouted hardcodes /src/pages/ in both its import.meta.glob patterns and
 * its route-path regex. This module mirrors the generouted runtime but scans
 * two directories:
 *   - /src/library/  — storyboard's workspace pages (workspace, viewfinder,
 *     create, index) plus _app.jsx (SPA shell wrapper).
 *   - /src/prototypes/  — the consumer's actual prototypes.
 *
 * Both directories have their prefix segment stripped from the URL — so
 * src/library/workspace.jsx mounts at /workspace, and
 * src/prototypes/MyProto/index.jsx mounts at /MyProto.
 *
 * Every PROTOTYPE route (anything originating from /src/prototypes/) is
 * wrapped in the consumer's src/_prototype.jsx (resolved via
 * `getPrototypeWrapper`). LIBRARY routes (workspace, viewfinder, create,
 * index) are NOT wrapped — they own their own provider chain inherited
 * from _app.jsx.
 */
import { Fragment, Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import PrototypeErrorBoundary, { ImportErrorFallback } from '@dfosco/hypercanvas/error-boundary'
import { getPrototypeWrapper } from '@dfosco/hypercanvas/wrappers'
import { PROTOTYPE_ROUTES as NOTEBOOK_PROTOTYPE_ROUTES, PROTOTYPE_MODALS as NOTEBOOK_PROTOTYPE_MODALS } from 'virtual:hypercanvas-notebook-routes'
import {
  generatePreservedRoutes,
  generateRegularRoutes,
  generateModalRoutes,
  patterns,
} from '@generouted/react-router/core'

// Patch the route regex to strip src/library/, src/prototypes/, .folder/,
// and `drafts/` segments. A `drafts/` dir is a gitignored scratch root —
// prototypes inside route at the same URL as a non-prefixed sibling (so
// `prototypes/drafts/Foo/` and `prototypes/Foo/` both resolve at `/Foo`).
//
// The second alternation strips a leading `/src/` for BARE top-level files
// (`/src/Dashboard.jsx` → `Dashboard`). The lookahead `(?=[^/]+\.(jsx|tsx|mdx)$)`
// ensures it only fires for files directly under /src (no further slash), so
// it never touches library/ or prototypes/ paths.
patterns.route = [/^.*\/src\/(library|prototypes)\/|^.*\/src\/(?=[^/]+\.(jsx|tsx|mdx)$)|^\/(library|prototypes)\/|[^/]*\.folder\/|(?<=^|\/)drafts\/|\.(jsx|tsx|mdx)$/g, '']

// `_app.jsx` lives in src/library/ — it's storyboard's SPA shell
// (StoryboardProvider + suspense + error boundary). Consumers can copy
// it to src/library/_app.jsx and customize freely. `404` is currently a
// no-op convention, kept for parity with generouted preserved routes.
const PRESERVED = import.meta.glob('/src/library/(_app|404).{jsx,tsx}', { eager: true })
const MODALS = {
  ...import.meta.glob('/src/prototypes/**/[+]*.{jsx,tsx}', { eager: true }),
  ...NOTEBOOK_PROTOTYPE_MODALS,
}

const PrototypeWrapper = getPrototypeWrapper()

// Library workspace pages — non-prototype routes (Workspace, Viewfinder,
// Create, landing index). Bypasses the PrototypeWrapper.
const LIBRARY_ROUTES = import.meta.glob(
  ['/src/library/*.{jsx,tsx}', '!/src/library/(_app|404|mount|prototypes-entry|routes).{jsx,tsx}'],
)

// Lazy-load prototype routes — only the matched route's module is fetched.
// This prevents story/canvas URLs from paying for every prototype page's
// imports (Primer, Reshaped, user components, etc.) on first load.
const PROTOTYPE_ROUTES = {
  ...import.meta.glob(
    ['/src/prototypes/**/[\\w[-]*.{jsx,tsx,mdx}', '!/src/prototypes/**/(_!(layout)*(/*)?|_app|404)*'],
  ),
  ...NOTEBOOK_PROTOTYPE_ROUTES,
}

// Flat-file routes — any top-level `src/<Name>.jsx` becomes a `/<Name>` route,
// rendered BARE (only the _app SPA shell, NOT wrapped in _prototype). Files
// prefixed with `_` (e.g. _prototype.jsx, _story.jsx) are excluded.
const ROOT_ROUTES = import.meta.glob(
  ['/src/*.{jsx,tsx}', '!/src/_*.{jsx,tsx}'],
)

const preservedRoutes = generatePreservedRoutes(PRESERVED)
const modalRoutes = generateModalRoutes(MODALS)

function makeLazyRoute(importFn, key) {
  const index = /index\.(jsx|tsx|mdx)$/.test(key) && !key.includes('prototypes/index') && !key.includes('library/index')
    ? { index: true }
    : {}
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
        // Import itself failed (syntax error, broken dependency, etc.)
        return {
          Component: () => <ImportErrorFallback error={err} route={key} />,
        }
      }
    },
  }
}

const libraryRoutes = generateRegularRoutes(LIBRARY_ROUTES, makeLazyRoute)
// The Site viewer also accepts deep links; reuse the same lazy library page.
const siteViewerRoute = LIBRARY_ROUTES['/src/library/sites.jsx']
  ? { path: 'sites/:siteId/*', ...makeLazyRoute(LIBRARY_ROUTES['/src/library/sites.jsx'], '/src/library/sites.jsx') }
  : null
const prototypeRoutes = generateRegularRoutes(PROTOTYPE_ROUTES, makeLazyRoute)
const rootRoutes = generateRegularRoutes(ROOT_ROUTES, makeLazyRoute)

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

// Wrap every PROTOTYPE route in <PrototypeWrapper> via a layout route.
// The wrapper resolves to consumer's src/_prototype.jsx — or a Fragment
// pass-through when absent (truly blank slate).
//
// The wrapping <div data-storyboard-prototype> uses `display: contents` so
// it never affects layout — it only exposes a CSS-selector hook
// (`[data-storyboard-prototype] selector`) that consumers can use to scope
// prototype-side styles.
//
// eslint-disable-next-line react-refresh/only-export-components
function PrototypeLayout() {
  return (
    <Suspense fallback={null}>
      <PrototypeWrapper>
        <div data-storyboard-prototype style={{ display: 'contents' }}>
          <Outlet />
        </div>
      </PrototypeWrapper>
    </Suspense>
  )
}

const prototypeLayoutRoute = {
  Component: PrototypeLayout,
  children: prototypeRoutes,
}

export const routes = [{
  ...app,
  children: [...libraryRoutes, ...(siteViewerRoute ? [siteViewerRoute] : []), ...rootRoutes, prototypeLayoutRoute, fallback],
}]

// Return a routes tree filtered to a single prototype subtree. Used by the
// per-prototype iframe entry (see prototypes-entry.jsx + PrototypeEmbed
// dev URL builder). Filtering at this layer keeps a broken sibling
// prototype from ever appearing in the matched route's lazy() chain — only
// the requested prototype's modules are reachable from the router.
//
// Library routes (workspace, viewfinder, create) are NEVER in the iframe
// path because the iframe entry uses a different routes module
// (prototypeRoutes.jsx inside the library). So filtering here only needs
// to walk the prototype subtree.
export function getRoutesForProto(proto) {
    if (!proto) return routes
    const matchesProto = (route) => {
        const seg = (route.path || '').split('/').filter(Boolean)[0]
        return seg === proto
    }
    const filter = (children) => children
        .map((r) => {
            if (r.path === '*') return r
            if (!r.path) {
                return r.children ? { ...r, children: filter(r.children) } : r
            }
            // A route WITH a path is kept iff its first segment matches the
            // requested proto. When it matches, keep its ENTIRE subtree — do
            // NOT re-filter children, since generouted nests sub-routes under
            // the prototype (e.g. `canvas-threats/threats` becomes a `threats`
            // child of `canvas-threats`); re-filtering would drop them because
            // their own segment isn't the proto name.
            return matchesProto(r) ? r : null
        })
        .filter(Boolean)
    return [{
      ...routes[0],
      children: routes[0].children.map((child) => {
        // Only the prototype-layout child has nested children we want to filter.
        if (child === prototypeLayoutRoute) return { ...child, children: filter(child.children || []) }
        return child
      }),
    }]
}
