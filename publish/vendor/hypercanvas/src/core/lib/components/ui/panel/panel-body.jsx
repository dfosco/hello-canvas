import { forwardRef } from "react";
import { cn } from "../../../utils/index.js";

const PanelBody = forwardRef(function PanelBody({ className, children, ...props }, ref) {
return (
<div ref={ref} data-slot="panel-body" className={cn("flex-1 overflow-auto px-4 py-2", className)} {...props}>
{children}
</div>
);
});
export default PanelBody;
