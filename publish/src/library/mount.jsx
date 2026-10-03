/**
 * DO NOT EDIT — storyboard-owned library file.
 *
 * Synced from @dfosco/storyboard. Customize via storyboard.config.json,
 * src/_prototype.jsx, src/_story.jsx, or src/library/_app.jsx.
 * See src/library/README.md for the full customization surface.
 *
 * Workspace SPA entry. Mounts the React Router with the file-based prototype
 * routes (see ./routes.jsx) and bootstraps storyboard core (devtools, comments,
 * theming, etc.) via mountStoryboardCore.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import { routes } from './routes'

import { installHashPreserver } from '@dfosco/hypercanvas/hash-preserver'
import { mountStoryboardCore } from '@dfosco/hypercanvas/core/mountStoryboardCore'
import { installPrototypeOverlayIsolation } from '@dfosco/hypercanvas/vite/dev-overlay-isolation'
import '@dfosco/hypercanvas/comments/ui/comment-layout.css'
import '@dfosco/hypercanvas/ui-runtime/style.css'
import storyboardConfig from '../../storyboard.config.json'

// Restore direct GitHub Pages links after 404.html finds the project base.
const fallbackParams = new URLSearchParams(window.location.search)
const fallbackRoute = fallbackParams.get('p')
const fallbackBase = fallbackParams.get('b')
if (globalThis.__HYPERCANVAS_NOTEBOOK_PUBLICATION__ === true
  && fallbackRoute !== null
  && fallbackBase?.startsWith('/')
  && !fallbackBase.startsWith('//')) {
  const base = fallbackBase.endsWith('/') ? fallbackBase : `${fallbackBase}/`
  window.history.replaceState(null, '', `${base}${fallbackRoute.replace(/^\/+/, '')}`)
}

// Suppress Vite error overlays that originate in /src/prototypes/ so a
// broken prototype can't take down the canvas surface. Dev-only no-op
// in production builds.
installPrototypeOverlayIsolation()

// Redirect after canvas creation — Vite full-reloads when a new
// .canvas.jsonl is created. The form sets ?redirect=/canvas/name
// which survives the reload. We navigate once the route is registered.
const redirectParam = new URLSearchParams(window.location.search).get('redirect')
if (redirectParam) {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  window.location.replace(base + redirectParam)
}

const router = createBrowserRouter(routes, {
    basename: import.meta.env.BASE_URL,
})

installHashPreserver(router, import.meta.env.BASE_URL)
mountStoryboardCore(storyboardConfig, { basePath: import.meta.env.BASE_URL })

const rootElement = document.getElementById('root')
const root = createRoot(rootElement)

root.render(
    <StrictMode>
        <RouterProvider router={router} />
    </StrictMode>
)
