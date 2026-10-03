import { useCallback, useSyncExternalStore } from 'react'
import {
  getCurrentMode,
  getRegisteredModes,
  activateMode,
  subscribeToMode,
  getModeSnapshot,
} from '../../core/index.js'

/**
 * React hook for the design-mode system.
 *
 * Uses useSyncExternalStore so the component re-renders whenever
 * the active mode or the set of registered modes changes.
 *
 * @returns {{
 *   mode: string,
 *   modes: Array<{ name: string, label: string, icon?: string }>,
 *   switchMode: (name: string, options?: object) => void,
 *   currentModeConfig: object | undefined,
 * }}
 */
export function useMode() {
  const snapshot = useSyncExternalStore(subscribeToMode, getModeSnapshot)

  // snapshot is "modeName|registeredNames" — we only use it to trigger re-renders
  void snapshot

  const mode = getCurrentMode()
  const modes = getRegisteredModes()
  const currentModeConfig = modes.find((m) => m.name === mode)

  const switchMode = useCallback((name, options) => {
    activateMode(name, options)
  }, [])

  return {
    mode,
    modes,
    switchMode,
    currentModeConfig,
  }
}
