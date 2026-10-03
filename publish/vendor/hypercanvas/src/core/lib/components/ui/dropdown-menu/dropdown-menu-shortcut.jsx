import { forwardRef } from "react";
import { cn } from "../../../utils/index.js";

const DropdownMenuShortcut = forwardRef(function DropdownMenuShortcut({ className, children, ...props }, ref) {
return (
<span
ref={ref}
data-slot="dropdown-menu-shortcut"
className={cn("text-muted-foreground group-focus/dropdown-menu-item:text-accent-foreground ml-auto text-xs tracking-widest", className)}
{...props}
>
{children}
</span>
);
});
export default DropdownMenuShortcut;
