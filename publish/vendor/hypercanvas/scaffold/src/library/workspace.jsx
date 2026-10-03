/**
 * DO NOT EDIT — storyboard-owned library file.
 *
 * Synced from @dfosco/storyboard. The `workspace` surface (Viewfinder).
 * All presentation props (title, subtitle, logo, tab toggles) come from
 * `pages.workspace` in storyboard.config.json — configure there, never edit
 * this file. See src/library/README.md for the full customization surface.
 */
import { flows } from 'virtual:storyboard-data-index'
import { PROTOTYPE_ROUTES } from 'virtual:hypercanvas-notebook-routes'
import { Workspace } from '@dfosco/hypercanvas'
import { getConfig } from '@dfosco/hypercanvas/config'
import storyboardConfig from '../../storyboard.config.json'

const pageModules = Object.fromEntries(
  Object.entries({
    ...import.meta.glob('/src/prototypes/*.jsx'),
    ...PROTOTYPE_ROUTES,
  }).map(([route, load]) => [
    route.replace(/^\/src\/prototypes\//, '').replace(/(?:\/index)?\.(?:jsx|tsx|mdx)$/, ''),
    load,
  ]),
)
const { pages } = getConfig(storyboardConfig)

export default function WorkspacePage() {
  return (
    <Workspace
      {...pages.workspace}
      flows={flows}
      hideDefaultFlow={true}
      pageModules={pageModules}
      basePath={import.meta.env.BASE_URL}
    />
  )
}
