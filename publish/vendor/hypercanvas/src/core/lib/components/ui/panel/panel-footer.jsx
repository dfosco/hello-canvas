import { forwardRef } from "react";
import { cn } from "../../../utils/index.js";

const PanelFooter = forwardRef(function PanelFooter({ className, children, ...props }, ref) {
return (
<div ref={ref} data-slot="panel-footer" className={cn("flex items-center justify-end gap-2 px-4 pt-2 pb-4", className)} {...props}>
{children}
</div>
);
});
export default PanelFooter;
