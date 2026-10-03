import './trigger-button.css';
import { useMemo, forwardRef } from "react";
import { cn } from "../../../utils/index.js";
import { registerSmoothCorners } from '../../../../utils/smoothCorners.js';
import { Button } from '../button/index.js';

registerSmoothCorners();

const TriggerButton = forwardRef(function TriggerButton({
className,
wrapperClass = "",
active = false,
inactive = false,
dimmed = false,
localOnly = false,
size = "icon-2xl",
children,
// Separate Radix trigger props from button props
'aria-expanded': ariaExpanded,
'data-state': dataState,
'aria-haspopup': ariaHaspopup,
...props
}, ref) {
const borderWidth = useMemo(
() => ['icon-2xl', 'icon-xl', '2xl', 'xl'].includes(size) ? '3px' : '2px',
[size]
);

return (
<span
ref={ref}
data-trigger-button=""
data-active={active || undefined}
data-inactive={inactive || undefined}
data-dimmed={dimmed || undefined}
data-local-only={localOnly || undefined}
style={{ '--sb--trigger-border-width': borderWidth }}
aria-expanded={ariaExpanded}
data-state={dataState}
aria-haspopup={ariaHaspopup}
>
<Button
variant="trigger"
size={size}
disabled={inactive}
wrapperClass={cn(
"smooth-corners [--sb--smooth-corners:4] hover:rotate-2 focus-visible:rotate-2 transition-transform",
active && !inactive && "rotate-2",
wrapperClass
)}
className={cn(
"smooth-corners leading-none font-semibold",
className
)}
{...props}
>
{children}
</Button>
</span>
);
});

export default TriggerButton;
