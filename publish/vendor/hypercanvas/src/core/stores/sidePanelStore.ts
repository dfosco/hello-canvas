/**
 * Side Panel Store — manages the open/close state and active tab of the
 * side panel UI.
 *
 * Framework-agnostic state with a subscribe/set interface.
 * Toggles the `sb-sidepanel-open` class on `<html>` so CSS can react
 * to the panel being open (e.g. shifting the main content area).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SidePanelTab = 'docs' | 'inspector' | 'sites' | 'publish'

export interface SidePanelState {
  /** Whether the side panel is currently open */
  open: boolean
  /** The currently active tab */
  activeTab: SidePanelTab
}

type Subscriber<T> = (value: T) => void
type Unsubscriber = () => void

interface Readable<T> {
  subscribe(run: Subscriber<T>): Unsubscriber
}

interface Writable<T> extends Readable<T> {
  set(value: T): void
  update(fn: (value: T) => T): void
}

function writable<T>(initial: T): Writable<T> {
  let value = initial
  const subs = new Set<Subscriber<T>>()
  return {
    set(v: T) {
      value = v
      subs.forEach((fn) => fn(value))
    },
    update(fn: (v: T) => T) {
      value = fn(value)
      subs.forEach((fn) => fn(value))
    },
    subscribe(run: Subscriber<T>): Unsubscriber {
      subs.add(run)
      run(value)
      return () => { subs.delete(run) }
    },
  }
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const PANEL_CLASS = 'sb-sidepanel-open'

const DEFAULT_STATE: SidePanelState = Object.freeze({
  open: false,
  activeTab: 'docs',
})

const _store = writable<SidePanelState>({ ...DEFAULT_STATE })

// ---------------------------------------------------------------------------
// DOM class sync
// ---------------------------------------------------------------------------

/**
 * Toggle the `sb-sidepanel-open` class on `document.documentElement`
 * to match the current open state. Guarded for SSR.
 */
function _syncDomClass(open: boolean): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle(PANEL_CLASS, open)
}

// ---------------------------------------------------------------------------
// Readable store
// ---------------------------------------------------------------------------

/**
 * Readable store for the side panel state.
 */
export const sidePanelState: Readable<SidePanelState> = { subscribe: _store.subscribe }

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Open the side panel to the given tab.
 *
 * @param tab — The tab to display when the panel opens.
 */
export function openPanel(tab: SidePanelTab): void {
  _store.set({ open: true, activeTab: tab })
  _syncDomClass(true)
}

/**
 * Close the side panel. The active tab is preserved so that
 * re-opening the panel returns to the same tab.
 */
export function closePanel(): void {
  _store.update((s) => ({ ...s, open: false }))
  _syncDomClass(false)
}

/**
 * Toggle the side panel for a specific tab.
 *
 * - If the panel is open **and** already showing this tab → close it.
 * - Otherwise → open the panel to the given tab.
 *
 * @param tab — The tab to toggle.
 */
export function togglePanel(tab: SidePanelTab): void {
  _store.update((s) => {
    const shouldClose = s.open && s.activeTab === tab
    const next: SidePanelState = shouldClose
      ? { ...s, open: false }
      : { open: true, activeTab: tab }
    _syncDomClass(next.open)
    return next
  })
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Reset the side panel store to its default state.
 * Only for use in tests.
 */
export function _resetSidePanel(): void {
  _store.set({ ...DEFAULT_STATE })
  _syncDomClass(false)
}
