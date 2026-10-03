/**
 * Consumer-safe proxy for mountDevTools.
 *
 * Delegates to the compiled UI bundle (@dfosco/storyboard/ui-runtime)
 * so consumers don't need internal dependencies. The real mountDevTools in
 * devtools.js imports internal deps and is only usable in the source repo
 * or via the compiled UI bundle.
 */

export async function mountDevTools(options = {}) {
  const ui = await import('@dfosco/hypercanvas/ui-runtime')
  return ui.mountDevTools(options)
}

export async function unmountDevTools() {
  const ui = await import('@dfosco/hypercanvas/ui-runtime')
  return ui.unmountDevTools()
}

/** @deprecated Use mountDevTools instead. */
export function mountFlowDebug(options = {}) {
  return mountDevTools(options)
}

/** @deprecated Use mountDevTools instead. */
export function mountSceneDebug(options = {}) {
  return mountDevTools(options)
}
