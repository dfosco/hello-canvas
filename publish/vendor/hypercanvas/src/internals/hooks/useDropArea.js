import { useEffect, useRef, useState } from 'react'
import { isTauriAvailable } from '../../core/notebook/tauri-bridge.js'
import { registerDropArea } from '../dragDrop/dropRouter.js'

/**
 * Register a stoppable drop area on an element.
 *
 * Desktop (Tauri): the drop router hit-tests registered areas at the native
 * drag position and delivers each drop to at most one area. Browser: HTML5
 * drag listeners are attached to the element itself, keeping the same
 * innermost-wins claim semantics (`stopPropagation` on claim).
 *
 * - `accepts(drop)` — optional predicate; `drop` is `{ paths, files, event? }`.
 *   Returning false declines the drop so an outer area can claim it.
 * - `onDrop(drop)` — ingestion callback for claimed drops.
 * - `disabled` — set true to ignore all drag activity.
 *
 * Returns `{ ref, isOver }`. Attach `ref` to the claim hit-box element.
 */
export function useDropArea({ accepts, onDrop, disabled = false } = {}) {
  const ref = useRef(null)
  const [isOver, setIsOver] = useState(false)
  const latest = useRef({})
  useEffect(() => {
    latest.current.accepts = accepts
    latest.current.onDrop = onDrop
    latest.current.disabled = disabled
  })

  useEffect(() => {
    const unregister = registerDropArea({
      getElement: () => ref.current,
      disabled: () => Boolean(latest.current.disabled),
      accepts: drop => {
        const acceptsFn = latest.current.accepts
        try {
          return acceptsFn ? acceptsFn(drop) !== false : true
        } catch {
          return false
        }
      },
      onDrop: drop => { latest.current.onDrop?.(drop) },
      onDragStateChange: state => setIsOver(Boolean(state.isOver)),
    })
    return unregister
  }, [])

  useEffect(() => {
    if (isTauriAvailable()) return undefined
    const element = ref.current
    if (!element) return undefined

    let depth = 0
    const dragHasFiles = dataTransfer => Boolean(dataTransfer && Array.from(dataTransfer.types || []).includes('Files'))
    const isActive = () => !latest.current.disabled

    const onDragEnter = event => {
      if (!isActive() || !dragHasFiles(event.dataTransfer)) return
      depth += 1
      event.preventDefault()
      setIsOver(true)
    }
    const onDragOver = event => {
      if (!isActive() || !dragHasFiles(event.dataTransfer)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = () => {
      if (!isActive()) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setIsOver(false)
    }
    const onDrop = event => {
      if (!isActive() || !dragHasFiles(event.dataTransfer)) return
      event.preventDefault()
      const files = Array.from(event.dataTransfer?.files || [])
      const acceptsFn = latest.current.accepts
      let accepted = true
      try {
        accepted = acceptsFn ? acceptsFn({ paths: null, files, event }) !== false : true
      } catch {
        accepted = false
      }
      depth = 0
      setIsOver(false)
      if (!accepted) return
      // Claiming stops outer areas from reacting.
      event.stopPropagation()
      latest.current.onDrop?.({ paths: null, files, event })
    }

    element.addEventListener('dragenter', onDragEnter)
    element.addEventListener('dragover', onDragOver)
    element.addEventListener('dragleave', onDragLeave)
    element.addEventListener('drop', onDrop)
    return () => {
      element.removeEventListener('dragenter', onDragEnter)
      element.removeEventListener('dragover', onDragOver)
      element.removeEventListener('dragleave', onDragLeave)
      element.removeEventListener('drop', onDrop)
    }
  }, [])

  return { ref, isOver }
}
