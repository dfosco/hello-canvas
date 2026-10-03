/**
 * Configuration reload guard for pages that consume the generated runtime
 * configuration. It is independent from canvas UI and prototype reload
 * policies so config changes can be tested without changing either policy.
 */
import { useEffect } from 'react'
import { getFlag, subscribeToStorage } from '../../core/index.js'

const FLAG_KEY = 'configuration-auto-reload'
const HEARTBEAT_MS = 3000

export default function useConfigurationReloadGuard() {
  useEffect(() => {
    if (!import.meta.hot) return

    let interval = null

    function start() {
      if (interval) return
      const msg = { active: true }
      import.meta.hot.send('storyboard:configuration-reload-guard', msg)
      interval = setInterval(() => {
        import.meta.hot.send('storyboard:configuration-reload-guard', msg)
      }, HEARTBEAT_MS)
    }

    function stop() {
      if (interval) {
        clearInterval(interval)
        interval = null
      }
      import.meta.hot.send('storyboard:configuration-reload-guard', { active: false })
    }

    function sync() {
      if (getFlag(FLAG_KEY)) stop()
      else start()
    }

    sync()
    const unsub = subscribeToStorage(sync)
    return () => {
      stop()
      unsub()
    }
  }, [])
}
