/**
 * FilePickerController — global event-driven mount for the FilePicker modal.
 *
 * Mount once near the top of the canvas tree. Listens for the custom event
 * `storyboard:canvas:open-file-picker` on `document` and renders the picker
 * modal when triggered.
 *
 * Event detail shape:
 *   {
 *     widgetId?: string,
 *     onSelect?: (path: string) => void,
 *   }
 *
 * On selection:
 *   - If `widgetId` was provided → dispatch `storyboard:canvas:update-widget`
 *     with `{ widgetId, updates: { path } }`.
 *   - If `onSelect` was provided → call it directly.
 *   - Otherwise → dispatch `storyboard:canvas:add-widget` with
 *     `{ type: 'file', props: { path } }`.
 */
import { useCallback, useEffect, useState } from 'react'
import FilePicker from './FilePicker.jsx'
import { importCoreFile } from '../../../../core/notebook/browserBridge.js'

const OPEN_EVENT = 'storyboard:canvas:open-file-picker'
const UPDATE_EVENT = 'storyboard:canvas:update-widget'
const ADD_EVENT = 'storyboard:canvas:add-widget'

export default function FilePickerController() {
  const [pickerState, setPickerState] = useState(null) // null | { widgetId?, onSelect? }

  useEffect(() => {
    function handleOpen(e) {
      const detail = e.detail ?? {}
      setPickerState({
        widgetId: detail.widgetId ?? null,
        onSelect: typeof detail.onSelect === 'function' ? detail.onSelect : null,
      })
    }

    document.addEventListener(OPEN_EVENT, handleOpen)
    return () => document.removeEventListener(OPEN_EVENT, handleOpen)
  }, [])

  const handleSelect = useCallback((path) => {
    if (!pickerState) return

    const { widgetId, onSelect } = pickerState

    if (widgetId) {
      document.dispatchEvent(
        new CustomEvent(UPDATE_EVENT, { detail: { widgetId, updates: { path } } }),
      )
    } else if (onSelect) {
      onSelect(path)
    } else {
      document.dispatchEvent(
        new CustomEvent(ADD_EVENT, { detail: { type: 'file', props: { path } } }),
      )
    }

    setPickerState(null)
  }, [pickerState])

  const handleCancel = useCallback(() => {
    setPickerState(null)
  }, [])

  const handleImport = useCallback(async () => {
    const result = await importCoreFile()
    return result?.cancelled ? null : result?.path || null
  }, [])

  return (
    <FilePicker
      isOpen={pickerState !== null}
      onSelect={handleSelect}
      onCancel={handleCancel}
      onImport={handleImport}
    />
  )
}
