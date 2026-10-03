import { forwardRef } from "react";
import { cn } from "../../../utils/index.js";

const AlertTitle = forwardRef(function AlertTitle({ className, children, ...props }, ref) {
return (
<div ref={ref} data-slot="alert-title" className={cn("font-medium group-has-[>svg]/alert:col-start-2 [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3", className)} {...props}>
{children}
</div>
);
});
export default AlertTitle;
