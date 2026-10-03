import { CreatePage } from '@dfosco/hypercanvas'

/**
 * `/create` route — standalone schema-driven artifact creator.
 * Opened by `storyboard create --ui` to give a focused creation surface
 * without the workspace chrome.
 */
export default function CreateRoute() {
  return <CreatePage basePath={import.meta.env.BASE_URL} />
}
