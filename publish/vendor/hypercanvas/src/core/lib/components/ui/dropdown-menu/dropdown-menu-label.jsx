import { forwardRef } from "react";
import { cn } from "../../../utils/index.js";

const DropdownMenuLabel = forwardRef(function DropdownMenuLabel({ className, inset, children, ...props }, ref) {
return (
<div
ref={ref}
data-slot="dropdown-menu-label"
data-inset={inset}
className={cn("text-muted-foreground px-1.5 py-1 text-xs font-medium data-inset:pl-7 data-[inset]:pl-8", className)}
{...props}
>
{children}
</div>
);
});
export default DropdownMenuLabel;
