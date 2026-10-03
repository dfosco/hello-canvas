import { forwardRef } from "react";
import { cn } from "../../../utils/index.js";

const PanelHeader = forwardRef(function PanelHeader({ className, children, ...props }, ref) {
return (
<div ref={ref} data-slot="panel-header" className={cn("flex items-center justify-between gap-2 px-4 pt-4 pb-2", className)} {...props}>
{children}
</div>
);
});
export default PanelHeader;
