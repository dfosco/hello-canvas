import { forwardRef } from "react";
import { Dialog as BUIDialog } from "@base-ui/react/dialog";

const DialogTrigger = forwardRef(function DialogTrigger({ asChild, children, ...props }, ref) {
  if (asChild) {
    return <BUIDialog.Trigger ref={ref} render={children} {...props} />
  }
  return <BUIDialog.Trigger ref={ref} {...props}>{children}</BUIDialog.Trigger>
})

export default DialogTrigger
