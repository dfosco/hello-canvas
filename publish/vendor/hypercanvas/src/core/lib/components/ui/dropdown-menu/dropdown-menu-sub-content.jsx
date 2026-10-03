import { forwardRef } from "react";
import { Menu as BUIMenu } from "@base-ui/react/menu";
import { cn } from "../../../utils/index.js";

const DropdownMenuSubContent = forwardRef(function DropdownMenuSubContent({ className, sideOffset = 0, align = "start", ...props }, ref) {
return (
<BUIMenu.Portal>
<BUIMenu.Positioner sideOffset={sideOffset} align={align}>
<BUIMenu.Popup
ref={ref}
data-slot="dropdown-menu-sub-content"
className={cn("font-sans data-[open]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[open]:fade-in-0 data-[closed]:zoom-out-95 data-[open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-[10000] bg-popover border-3 border-border text-popover-foreground fill-popover-foreground min-w-[96px] rounded-xl p-2 shadow-xl duration-100 w-auto", className)}
{...props}
/>
</BUIMenu.Positioner>
</BUIMenu.Portal>
);
});
export default DropdownMenuSubContent;
