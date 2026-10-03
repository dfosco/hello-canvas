import { forwardRef } from "react";
import { Separator as BUISeparator } from "@base-ui/react/separator";
import { cn } from "../../../utils/index.js";

const Separator = forwardRef(function Separator({ className, orientation = "horizontal", "data-slot": dataSlot = "separator", ...rest }, ref) {
// `decorative` is a legacy Radix prop; base-ui infers role from orientation, so we drop it silently.
const { decorative: _decorative, ...props } = rest;
void _decorative;
return (
<BUISeparator
ref={ref}
data-slot={dataSlot}
orientation={orientation}
className={cn(
"bg-border shrink-0 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px",
"data-[orientation=vertical]:h-full",
className
)}
{...props}
/>
);
});

export default Separator;
