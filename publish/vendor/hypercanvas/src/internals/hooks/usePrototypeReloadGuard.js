/**
 * Embed reload guard — suppresses Vite HMR full-reloads for iframe-embedded
 * pages (prototypes and stories alike).
 *
 * Controlled by the "prototype-auto-reload" feature flag (normally false;
 * live-source desktop development defaults it on).
 * The flag name predates story-widget support; it now toggles the guard
 * for both prototypes AND stories, which share the policy: drop
 * `full-reload` payloads so in-page state survives unrelated file edits,
 * but let `update` payloads through so React Fast Refresh works.
 *
 * The default is false (guard ON) because the dev server emits frequent
 * full-reload broadcasts from data-plugin watchers; without the guard,
 * embedded pages get stuck in a reload loop. Users can opt in via the
 * devtools menu.
 *
 * Heartbeats are sent every 3s and auto-expire server-side after 5s, so
 * closed tabs never leave the guard stuck.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=true] — when false, no heartbeats are sent
 *        (used by pages that only want to guard when in embed mode).
 */
import { useEffect } from 'react'
import { getFlag, subscribeToStorage } from '../../core/index.js'

const FLAG_KEY = 'prototype-auto-reload'
const HEARTBEAT_MS = 3000

export default function usePrototypeReloadGuard({ enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return
    if (!import.meta.hot) return

    let interval = null

    function start() {
      if (interval) return
      const msg = { active: true }
      import.meta.hot.send('storyboard:prototype-reload-guard', msg)
      interval = setInterval(() => {
        import.meta.hot.send('storyboard:prototype-reload-guard', msg)
      }, HEARTBEAT_MS)
    }

    function stop() {
      if (interval) {
        clearInterval(interval)
        interval = null
      }
      import.meta.hot.send('storyboard:prototype-reload-guard', { active: false })
    }

    function sync() {
      const autoReload = getFlag(FLAG_KEY)
      if (autoReload) {
        stop()
      } else {
        start()
      }
    }

    // Initial sync
    sync()

    // Re-sync when any storyboard storage entry changes (subscribeToStorage
    // fires without a key arg, so we just re-read the flag every time).
    const unsub = subscribeToStorage(() => sync())

    return () => {
      stop()
      unsub()
    }
  }, [enabled])
}
