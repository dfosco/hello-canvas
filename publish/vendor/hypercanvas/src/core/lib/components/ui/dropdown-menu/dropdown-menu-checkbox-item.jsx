import { forwardRef } from "react";
import { Menu as BUIMenu } from "@base-ui/react/menu";
import { Check, Minus } from "lucide-react";
import { cn } from "../../../utils/index.js";

const DropdownMenuCheckboxItem = forwardRef(function DropdownMenuCheckboxItem({ className, children, checked, onCheckedChange, onSelect, onClick, closeOnSelect = true, ...props }, ref) {
const isIndeterminate = checked === "indeterminate";
const controlledChecked = isIndeterminate ? false : checked;
const handleClick = (e) => {
if (onSelect) onSelect(e);
if (onClick) onClick(e);
};
return (
<BUIMenu.CheckboxItem
ref={ref}
data-slot="dropdown-menu-checkbox-item"
checked={controlledChecked}
indeterminate={isIndeterminate || undefined}
onCheckedChange={onCheckedChange ? (next) => onCheckedChange(next) : undefined}
onClick={handleClick}
closeOnClick={closeOnSelect}
className={cn(
"focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground focus:**:text-accent-foreground gap-2 rounded-[4px] py-2 pr-8 pl-2.5 text-sm data-inset:pl-7 [&_svg:not([class*='size-'])]:size-4 relative flex cursor-default items-center outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
className
)}
{...props}
>
<span
className="absolute right-2 flex items-center justify-center pointer-events-none"
data-slot="dropdown-menu-checkbox-item-indicator"
>
<BUIMenu.CheckboxItemIndicator>
{isIndeterminate ? <Minus /> : <Check />}
</BUIMenu.CheckboxItemIndicator>
</span>
{children}
</BUIMenu.CheckboxItem>
);
});
export default DropdownMenuCheckboxItem;
