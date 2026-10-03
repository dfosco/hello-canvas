/**
 * DO NOT EDIT — storyboard-owned library file.
 *
 * Synced from @dfosco/storyboard. The `home` surface (landing workspace).
 * All presentation props (title, subtitle) come from `pages.home` in
 * storyboard.config.json — configure there, never edit this file.
 * See src/library/README.md for the full customization surface.
 */
import { SimpleWorkspace } from '@dfosco/hypercanvas'
import { getConfig } from '@dfosco/hypercanvas/config'
import { PROTOTYPE_ROUTES } from 'virtual:hypercanvas-notebook-routes'
import storyboardConfig from '../../storyboard.config.json'

const pageModules = {
  ...import.meta.glob('/src/prototypes/*/*.jsx'),
  ...PROTOTYPE_ROUTES,
}
const { pages } = getConfig(storyboardConfig)

export default function HomePage() {
  return (
    <SimpleWorkspace
      {...pages.home}
      pageModules={pageModules}
      basePath={import.meta.env.BASE_URL}
    />
  )
}
