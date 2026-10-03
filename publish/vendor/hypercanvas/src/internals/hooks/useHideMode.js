import { useCallback, useSyncExternalStore } from 'react'
import { isHideMode, activateHideMode, deactivateHideMode } from '../../core/index.js'
import { subscribeToStorage, getStorageSnapshot } from '../../core/index.js'

/**
 * Read/control hide mode.
 *
 * Hide mode moves all URL hash overrides into localStorage so the URL
 * stays clean — useful when sharing storyboards with customers.
 *
 * @returns {{ isHidden: boolean, hide: function, show: function }}
 *   - isHidden – true when hide mode is active
 *   - hide()   – activate hide mode (copies hash → localStorage, cleans URL)
 *   - show()   – deactivate hide mode (restores localStorage → hash)
 */
export function useHideMode() {
  // Re-render when localStorage changes (hide flag lives there)
  useSyncExternalStore(subscribeToStorage, getStorageSnapshot)

  const isHidden = isHideMode()

  const hide = useCallback(() => {
    activateHideMode()
  }, [])

  const show = useCallback(() => {
    deactivateHideMode()
  }, [])

  return { isHidden, hide, show }
}
