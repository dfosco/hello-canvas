/**
 * Library-provided entry for the isolated prototypes iframe.
 *
 * Loaded by the prototypes.html middleware in `data-plugin.js`. All the
 * mount plumbing (consumer stylesheet pull-in, storyboard.config.json read,
 * mountStoryboardCore, basename derivation, React tree) lives in the shared
 * `mountIsolationApp` helper so this file and `storiesEntry.jsx` stay in
 * sync. See `.agents/plans/vite-isolation.md` for the isolation pattern.
 *
 * The `resolveRoutes` callback narrows the route table to a single
 * prototype subtree based on the first path segment after the basename
 * (e.g. `/prototypes.html/MyProto/SignupForm` → narrow to MyProto). This
 * keeps a broken sibling prototype from ever appearing in the matched
 * route's lazy() chain — module-graph isolation.
 *
 * The legacy `?proto=` query param is preserved as a fallback for older
 * canvases / older builds.
 */
import { routes, getRoutesForProto } from './prototypeRoutes.jsx'
import { mountIsolationApp } from './mountIsolationApp.jsx'

mountIsolationApp({
  name: 'prototypes.html',
  resolveRoutes: ({ firstSegment, search }) => {
    const proto = firstSegment || search.get('proto') || ''
    return proto ? getRoutesForProto(proto) : routes
  },
})
