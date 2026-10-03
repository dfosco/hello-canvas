import { forwardRef } from "react";
import { Separator as BUISeparator } from "@base-ui/react/separator";
import { cn } from "../../../utils/index.js";

const DropdownMenuSeparator = forwardRef(function DropdownMenuSeparator({ className, ...props }, ref) {
return (
<BUISeparator
ref={ref}
data-slot="dropdown-menu-separator"
className={cn("bg-border -mx-1.5 my-1 h-px", className)}
{...props}
/>
);
});
export default DropdownMenuSeparator;
