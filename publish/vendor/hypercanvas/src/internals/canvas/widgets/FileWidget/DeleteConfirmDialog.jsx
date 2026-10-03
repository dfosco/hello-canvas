/**
 * DeleteConfirmDialog — small confirmation modal shown before a widget delete
 * when the widget's config declares `deleteConfirm.enabled`.
 *
 * Used for file and markdown widgets (and any future widget that opts in)
 * to make it explicit that deleting the widget does NOT delete the
 * underlying file on disk.
 *
 * Controlled component: parent owns visibility, passes `onConfirm` /
 * `onCancel`. Renders via the shared Dialog adapter so it inherits
 * canvas/portal theming.
 */
import Dialog from '../../../Dialog.jsx'
import styles from './DeleteConfirmDialog.module.css'

export default function DeleteConfirmDialog({
  title = 'Delete widget?',
  message = 'This action cannot be undone.',
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) {
  return (
    <Dialog title={title} onClose={onCancel} width="small">
      <p className={styles.message}>{message}</p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.cancelBtn}
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={styles.confirmBtn}
          onClick={onConfirm}
          autoFocus
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}
