import { Dialog as BUIDialog } from "@base-ui/react/dialog";

/**
 * Dialog.Root — controlled modal dialog wrapper.
 *
 * Pass `open` and `onOpenChange` (Base UI API). Use `<Dialog.Content>` for
 * the content surface. For backward-compatible callsites that just want a
 * Primer-style `{ title, subtitle, onClose }` API, use the higher-level
 * `<Dialog>` adapter at `packages/storyboard/src/internals/Dialog.jsx`.
 */
export default function DialogRoot({ children, ...props }) {
  return <BUIDialog.Root {...props}>{children}</BUIDialog.Root>
}
