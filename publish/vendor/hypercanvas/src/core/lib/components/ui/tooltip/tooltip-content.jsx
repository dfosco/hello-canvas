import { forwardRef } from "react";
import { Tooltip as BUITooltip } from "@base-ui/react/tooltip";
import { cn } from "../../../utils/index.js";
import "./tooltip-content.css";

const TooltipContent = forwardRef(function TooltipContent({ className, sideOffset = 8, side, align, ...props }, ref) {
return (
<BUITooltip.Portal>
<BUITooltip.Positioner sideOffset={sideOffset} side={side} align={align}>
<BUITooltip.Popup
ref={ref}
data-slot="tooltip-content"
className={cn(
"font-sans bg-slate-700 text-white text-xs px-2.5 py-1.5 rounded-lg shadow-lg z-[10001] animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
className
)}
{...props}
/>
</BUITooltip.Positioner>
</BUITooltip.Portal>
);
});
export default TooltipContent;
