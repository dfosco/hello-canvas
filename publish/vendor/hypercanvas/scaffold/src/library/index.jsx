/**
 * DO NOT EDIT — storyboard-owned library file.
 *
 * Synced from @dfosco/storyboard. The site index (`/`).
 *
 * Which surface renders here is configured via `routes["/"]` in
 * storyboard.config.json — a page name (e.g. "home", "workspace") or a
 * per-environment object `{ dev, prod, default }`. Defaults to "home".
 * Configure the route in storyboard.config.json, never edit this file.
 * See src/library/README.md for the full customization surface.
 */
import { useEffect } from 'react'
import { getConfig, resolveRouteTarget } from '@dfosco/hypercanvas/config'
import storyboardConfig from '../../storyboard.config.json'
import HomePage from './home'
import WorkspacePage from './workspace'

const { routes } = getConfig(storyboardConfig)
const target = resolveRouteTarget(routes, '/', { dev: import.meta.env.DEV }) || 'home'

// Built-in surfaces that render inline at the index without a redirect.
const SURFACES = {
  home: HomePage,
  workspace: WorkspacePage,
}

function RedirectTo({ to }) {
  useEffect(() => {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')
    window.location.replace(`${base}/${to}${window.location.hash}`)
  }, [to])
  return null
}

export default function IndexPage() {
  const Surface = SURFACES[target]
  if (Surface) return <Surface />
  // Target is a flat component (src/<Name>.jsx) or another library page —
  // redirect `/` to that route so any configured target works.
  return <RedirectTo to={target} />
}
