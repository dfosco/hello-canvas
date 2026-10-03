import { forwardRef } from "react";
import { Menu as BUIMenu } from "@base-ui/react/menu";
import { ChevronRight } from "lucide-react";
import { cn } from "../../../utils/index.js";

const DropdownMenuSubTrigger = forwardRef(function DropdownMenuSubTrigger({ className, inset, children, ...props }, ref) {
return (
<BUIMenu.SubmenuTrigger
ref={ref}
data-slot="dropdown-menu-sub-trigger"
data-inset={inset}
className={cn(
"focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[popup-open]:bg-accent data-[popup-open]:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground gap-1.5 rounded-md px-2.5 py-2 text-sm data-inset:pl-7 [&_svg:not([class*='size-'])]:size-4 flex cursor-default items-center outline-hidden select-none data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0",
className
)}
{...props}
>
{children}
<ChevronRight className="ml-auto" />
</BUIMenu.SubmenuTrigger>
);
});
export default DropdownMenuSubTrigger;
