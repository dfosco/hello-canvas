import { forwardRef } from "react";
import { Menu as BUIMenu } from "@base-ui/react/menu";
import { cn } from "../../../utils/index.js";

/**
 * `onSelect` (radix-style) is accepted as an alias for `onClick`. To keep the
 * menu open after activating an item (was `e.preventDefault()` in radix),
 * pass `closeOnSelect={false}`.
 */
const DropdownMenuItem = forwardRef(function DropdownMenuItem({ className, inset, variant = "default", onSelect, onClick, closeOnSelect = true, ...props }, ref) {
const handleClick = (e) => {
if (onSelect) onSelect(e);
if (onClick) onClick(e);
};
return (
<BUIMenu.Item
ref={ref}
data-slot="dropdown-menu-item"
data-inset={inset}
data-variant={variant}
closeOnClick={closeOnSelect}
onClick={handleClick}
className={cn(
"focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:data-[highlighted]:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:text-destructive not-data-[variant=destructive]:focus:**:text-accent-foreground gap-2 rounded-[4px] px-2.5 py-2 text-sm data-inset:pl-7 [&_svg:not([class*='size-'])]:size-4 group/dropdown-menu-item relative flex cursor-default items-center outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0",
className
)}
{...props}
/>
);
});
export default DropdownMenuItem;
