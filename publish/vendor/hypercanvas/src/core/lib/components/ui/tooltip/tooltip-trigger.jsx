import { forwardRef } from "react";
import { Tooltip as BUITooltip } from "@base-ui/react/tooltip";

const TooltipTrigger = forwardRef(function TooltipTrigger({ asChild, children, ...props }, ref) {
if (asChild) {
return (
<BUITooltip.Trigger
ref={ref}
render={children}
{...props}
/>
);
}
return (
<BUITooltip.Trigger
ref={ref}
render={(triggerProps) => (
<span
{...triggerProps}
tabIndex={-1}
style={{ display: "inline-flex" }}
>
{children}
</span>
)}
{...props}
/>
);
});
export default TooltipTrigger;
