import { forwardRef } from "react";
import { Menu as BUIMenu } from "@base-ui/react/menu";
import { Check } from "lucide-react";
import { cn } from "../../../utils/index.js";

const DropdownMenuRadioItem = forwardRef(function DropdownMenuRadioItem({ className, children, value, onSelect, onClick, closeOnSelect = true, ...props }, ref) {
const handleClick = (e) => {
if (onSelect) onSelect(e);
if (onClick) onClick(e);
};
return (
<BUIMenu.RadioItem
ref={ref}
data-slot="dropdown-menu-radio-item"
value={value}
onClick={handleClick}
closeOnClick={closeOnSelect}
className={cn(
"focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground focus:**:text-accent-foreground gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm data-inset:pl-7 [&_svg:not([class*='size-'])]:size-4 relative flex cursor-default items-center outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
className
)}
{...props}
>
<span
className="absolute right-2 flex items-center justify-center pointer-events-none"
data-slot="dropdown-menu-radio-item-indicator"
>
<BUIMenu.RadioItemIndicator>
<Check />
</BUIMenu.RadioItemIndicator>
</span>
{children}
</BUIMenu.RadioItem>
);
});
export default DropdownMenuRadioItem;
