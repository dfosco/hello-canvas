import { forwardRef } from "react";
import { cn } from "../../../utils/index.js";

const AlertDescription = forwardRef(function AlertDescription({ className, children, ...props }, ref) {
return (
<div ref={ref} data-slot="alert-description" className={cn("text-muted-foreground text-sm text-balance md:text-pretty [&_p:not(:last-child)]:mb-4 [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3", className)} {...props}>
{children}
</div>
);
});
export default AlertDescription;
