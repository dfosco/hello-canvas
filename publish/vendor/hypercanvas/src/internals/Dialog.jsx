/**
 * Dialog — internal adapter that exposes a Primer-style
 * `<Dialog title subtitle onClose width height>` API on top of the
 * framework-neutral core Dialog primitive (`core/lib/components/ui/dialog`).
 *
 * Lets the command palette mount its existing dialogs without pulling in
 * `@primer/react/experimental`. See plan `.github/plans/style-separation.md`
 * (Layer A).
 *
 * Semantics:
 *   - The dialog is open while mounted (caller controls visibility by
 *     conditionally rendering this component, matching Primer's behaviour).
 *   - Backdrop click + ESC fire `onClose`.
 */
import * as Dialog from '../core/lib/components/ui/dialog/index.js'
import css from '../core/lib/components/ui/dialog/dialog.module.css'

export default function DialogAdapter({
  title,
  subtitle,
  onClose,
  width = 'medium',
  height = 'auto',
  children,
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose?.() }}>
      <Dialog.Content width={width} height={height} aria-label={typeof title === 'string' ? title : undefined}>
        {(title || subtitle) && (
          <div className={css.header}>
            <div className={css.titleGroup}>
              {title && <h2 className={css.title}>{title}</h2>}
              {subtitle && <p className={css.subtitle}>{subtitle}</p>}
            </div>
            <button
              type="button"
              className={css.closeBtn}
              onClick={() => onClose?.()}
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </button>
          </div>
        )}
        <div className={css.body}>{children}</div>
      </Dialog.Content>
    </Dialog.Root>
  )
}
