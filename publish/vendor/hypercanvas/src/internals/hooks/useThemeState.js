/**
 * useThemeState — React hook for the global storyboard theme.
 *
 * Subscribes to the core themeStore via useSyncExternalStore so React
 * components re-render whenever the theme changes (user action, system
 * preference toggle, or sync-target change).
 *
 * Returns { theme, resolved } where `theme` may be "system" and
 * `resolved` is always a concrete Primer theme name.
 *
 * useThemeSyncTargets — React hook for which UI surfaces follow the theme.
 * Returns { prototype, toolbar, codeBoxes, canvas }.
 */

import { useSyncExternalStore } from 'react'
import {
  themeState,
  themeSyncState,
} from '../../core/index.js'

// --- useThemeState ----------------------------------------------------------

function subscribeTheme(cb) {
  return themeState.subscribe(cb)
}

let _themeSnapshot = null
themeState.subscribe((s) => { _themeSnapshot = s })

function getThemeSnapshot() {
  return _themeSnapshot
}

/**
 * Subscribe to the global storyboard theme.
 * @returns {{ theme: string, resolved: string }}
 */
export function useThemeState() {
  return useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeSnapshot)
}

// --- useThemeSyncTargets ----------------------------------------------------

function subscribeSyncTargets(cb) {
  return themeSyncState.subscribe(cb)
}

let _syncSnapshot = null
themeSyncState.subscribe((s) => { _syncSnapshot = s })

function getSyncSnapshot() {
  return _syncSnapshot
}

/**
 * Subscribe to which UI surfaces follow the global theme.
 * @returns {{ prototype: boolean, toolbar: boolean, codeBoxes: boolean, canvas: boolean }}
 */
export function useThemeSyncTargets() {
  return useSyncExternalStore(subscribeSyncTargets, getSyncSnapshot, getSyncSnapshot)
}
