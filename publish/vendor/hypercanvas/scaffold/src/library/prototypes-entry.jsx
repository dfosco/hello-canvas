/**
 * DO NOT EDIT — storyboard-owned library file.
 *
 * Synced from @dfosco/storyboard. Customize via src/_prototype.jsx.
 * See src/library/README.md for the full customization surface.
 *
 * Isolated prototypes entry point (see .agents/plans/vite-isolation.md).
 *
 * This is the second Vite HTML entry — prototypes.html loads this file.
 * Goal: physically separate the prototypes module graph + Rollup chunk graph
 * from the canvas app so a broken prototype cannot poison canvas surfaces.
 *
 * Uses createHashRouter so prototype routes live in the URL hash of
 * prototypes.html (e.g. prototypes.html#/MyProto/SignupForm). This avoids
 * needing any server rewrite — every iframe load resolves to the same
 * prototypes.html document, then the router renders the matched prototype.
 *
 * Does NOT install the workspace-level hash preserver — that hook is the
 * canvas/workshop SPA concern, not relevant inside an isolated prototype.
 *
 * The prototype provider chain (Primer / Tailwind / fonts / design tokens)
 * comes from the consumer's `src/_prototype.jsx` — wired by the route layout
 * inside ./routes.jsx. When absent, prototypes render with no shared providers.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createHashRouter } from 'react-router-dom'
import { routes, getRoutesForProto } from './routes'
import { mountStoryboardCore } from '@dfosco/hypercanvas/core/mountStoryboardCore'
import '@dfosco/hypercanvas/comments/ui/comment-layout.css'
import storyboardConfig from '../../storyboard.config.json'

// Mount storyboard core. In embed mode (_sb_embed in the URL — always true
// for canvas iframes) this short-circuits past UI mounting and only:
//   - honors the canvas-aware theme (_sb_theme_target, _sb_canvas_theme)
//   - sets up the iframe→parent postMessage navigation bridge
mountStoryboardCore(storyboardConfig, {
  basePath: import.meta.env.BASE_URL,
  loadUIStyles: false,
})

// Per-prototype filtering: when PrototypeEmbed loads us with ?proto=Name in
// dev, narrow the router to that prototype's subtree. Other prototypes'
// lazy() entries never appear in the route table, so a broken sibling
// prototype cannot leak into this iframe's module graph or HMR scope. Falls
// back to the full route tree when no proto param is set (production builds
// + direct-load flows).
const protoParam = new URLSearchParams(window.location.search).get('proto')
const activeRoutes = protoParam ? getRoutesForProto(protoParam) : routes

const router = createHashRouter(activeRoutes)

const rootElement = document.getElementById('root')
const root = createRoot(rootElement)

root.render(
    <StrictMode>
        <RouterProvider router={router} />
    </StrictMode>
)
