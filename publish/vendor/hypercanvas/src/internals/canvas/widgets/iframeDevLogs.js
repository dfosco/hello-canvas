import { useEffect, useRef } from 'react'

let loadedIframeCount = 0

function isDevRuntime() {
  return typeof window !== 'undefined' && window.__SB_LOCAL_DEV__ === true
}

function toText(value) {
  return value ? String(value) : '(no src)'
}

function logIframeEvent(event, count, meta) {
  console.log(`[storyboard][iframe] ${event} | count=${count} | ${meta.widget}`, {
    event,
    count,
    widget: meta.widget,
    src: toText(meta.src),
  })
}

/**
 * Dev-only iframe load/unload logging with a live count of mounted iframes.
 */
export function useIframeDevLogs({ widget, loaded, src }) {
  const metaRef = useRef({ widget, src })

  useEffect(() => {
    metaRef.current = { widget, src }
  }, [widget, src])

  useEffect(() => {
    if (!loaded) return

    loadedIframeCount += 1
    if (isDevRuntime()) {
      const meta = metaRef.current
      logIframeEvent('loaded', loadedIframeCount, meta)
    }

    return () => {
      loadedIframeCount = Math.max(0, loadedIframeCount - 1)
      if (isDevRuntime()) {
        const meta = metaRef.current
        logIframeEvent('unloaded', loadedIframeCount, meta)
      }
    }
  }, [loaded])
}
