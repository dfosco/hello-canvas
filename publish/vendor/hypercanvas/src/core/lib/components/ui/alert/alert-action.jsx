import { forwardRef } from "react";
import { cn } from "../../../utils/index.js";

const AlertAction = forwardRef(function AlertAction({ className, children, ...props }, ref) {
return (
<div ref={ref} data-slot="alert-action" className={cn("absolute top-2 right-2", className)} {...props}>
{children}
</div>
);
});
export default AlertAction;
