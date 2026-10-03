import { forwardRef } from "react";
import { Dialog as BUIDialog } from "@base-ui/react/dialog";
import { cn } from "../../../utils/index.js";

const PanelTitle = forwardRef(function PanelTitle({ className, children, ...props }, ref) {
return (
<BUIDialog.Title ref={ref} data-slot="panel-title" className={cn("text-sm font-semibold", className)} {...props}>
{children}
</BUIDialog.Title>
);
});
export default PanelTitle;
