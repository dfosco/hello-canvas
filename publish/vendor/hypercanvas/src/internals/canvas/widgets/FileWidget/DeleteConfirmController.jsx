/**
 * DeleteConfirmController — global mount point for the delete-confirm dialog.
 *
 * Listens to the `storyboard:canvas:request-delete-confirm` document event:
 *   detail: {
 *     title?: string,
 *     message?: string,
 *     confirmLabel?: string,
 *     onConfirm: () => void,
 *     onCancel?: () => void,
 *   }
 *
 * When a widget's config declares `deleteConfirm.enabled`, ChromeWrappedWidget
 * dispatches this event instead of calling onRemove directly. This component
 * pops the modal; on confirm it invokes the supplied callback (which then
 * does the actual delete).
 *
 * Single global instance is mounted in CanvasPage alongside other overlays.
 */
import { useEffect, useState, useCallback } from 'react'
import DeleteConfirmDialog from './DeleteConfirmDialog.jsx'

export default function DeleteConfirmController() {
  const [request, setRequest] = useState(null)

  useEffect(() => {
    function onRequest(e) {
      if (!e?.detail || typeof e.detail.onConfirm !== 'function') return
      setRequest({
        title: e.detail.title,
        message: e.detail.message,
        confirmLabel: e.detail.confirmLabel,
        onConfirm: e.detail.onConfirm,
        onCancel: e.detail.onCancel,
      })
    }
    document.addEventListener('storyboard:canvas:request-delete-confirm', onRequest)
    return () => document.removeEventListener('storyboard:canvas:request-delete-confirm', onRequest)
  }, [])

  const handleConfirm = useCallback(() => {
    request?.onConfirm?.()
    setRequest(null)
  }, [request])

  const handleCancel = useCallback(() => {
    request?.onCancel?.()
    setRequest(null)
  }, [request])

  if (!request) return null

  return (
    <DeleteConfirmDialog
      title={request.title || 'Delete widget?'}
      message={request.message || 'This action cannot be undone.'}
      confirmLabel={request.confirmLabel || 'Delete'}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  )
}
