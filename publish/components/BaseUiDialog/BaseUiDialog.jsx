import { Dialog } from '@base-ui/react/dialog'

export default function BaseUiDialog({
  trigger = 'Open',
  title,
  description,
  children,
  primaryLabel = 'Confirm',
  cancelLabel = 'Cancel',
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger
        className="
          inline-flex items-center justify-center
          rounded-md border border-input bg-background px-3 py-1.5
          text-sm font-medium text-foreground transition-colors
          hover:bg-muted
          focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2
        "
      >
        {trigger}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop
          className="
            fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm
            data-[starting-style]:opacity-0 data-[ending-style]:opacity-0
            transition-opacity duration-150
          "
        />
        <Dialog.Popup
          className="
            fixed left-1/2 top-1/2 z-50 w-[min(420px,90vw)]
            -translate-x-1/2 -translate-y-1/2
            rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-xl
            data-[starting-style]:opacity-0 data-[starting-style]:scale-95
            data-[ending-style]:opacity-0 data-[ending-style]:scale-95
            transition-[opacity,transform] duration-150
          "
        >
          {title && <Dialog.Title className="m-0 text-base font-semibold">{title}</Dialog.Title>}
          {description && (
            <Dialog.Description className="mt-2 text-sm text-muted-foreground">
              {description}
            </Dialog.Description>
          )}
          {children && <div className="mt-3 text-sm text-foreground">{children}</div>}
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close
              className="
                inline-flex items-center justify-center
                rounded-md border border-input bg-background px-3 py-1.5
                text-sm font-medium text-foreground transition-colors
                hover:bg-muted
              "
            >
              {cancelLabel}
            </Dialog.Close>
            <Dialog.Close
              className="
                inline-flex items-center justify-center
                rounded-md bg-ring px-3 py-1.5
                text-sm font-medium text-background transition-opacity
                hover:opacity-90
              "
            >
              {primaryLabel}
            </Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
