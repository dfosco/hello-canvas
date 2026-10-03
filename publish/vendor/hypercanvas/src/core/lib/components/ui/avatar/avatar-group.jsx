import { forwardRef } from "react";
import { cn } from "../../../utils/index.js";

const AvatarGroup = forwardRef(function AvatarGroup({ className, children, ...props }, ref) {
return (
<div
ref={ref}
data-slot="avatar-group"
className={cn(
"cn-avatar-group *:data-[slot=avatar]:ring-background group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2",
className
)}
{...props}
>
{children}
</div>
);
});
export default AvatarGroup;
