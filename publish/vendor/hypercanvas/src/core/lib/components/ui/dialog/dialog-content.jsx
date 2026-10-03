import { forwardRef } from "react";
import { Dialog as BUIDialog } from "@base-ui/react/dialog";
import { cn } from "../../../utils/index.js";
import css from "./dialog.module.css";

const WIDTH_CLASS = {
  small:  css.widthSmall,
  medium: css.widthMedium,
  large:  css.widthLarge,
  xlarge: css.widthXLarge,
}

const HEIGHT_CLASS = {
  small:  css.heightSmall,
  auto:   css.heightAuto,
  large:  css.heightLarge,
  xlarge: css.heightXLarge,
}

/**
 * DialogContent — modal surface with backdrop + popup.
 *
 * Props beyond the styling helpers (`width`, `height`, `className`) pass
 * straight through to BUIDialog.Popup so callers can override `aria-*` and
 * `data-*` as needed. The backdrop is always rendered.
 */
const DialogContent = forwardRef(function DialogContent({
  className,
  width = 'medium',
  height = 'auto',
  children,
  ...props
}, ref) {
  return (
    <BUIDialog.Portal>
      <BUIDialog.Backdrop className={css.backdrop} />
      <BUIDialog.Popup
        ref={ref}
        className={cn(css.popup, WIDTH_CLASS[width], HEIGHT_CLASS[height], className)}
        {...props}
      >
        {children}
      </BUIDialog.Popup>
    </BUIDialog.Portal>
  )
})

export default DialogContent
