import { forwardRef } from "react";
import { cn } from "../../../utils/index.js";

const AvatarGroupCount = forwardRef(function AvatarGroupCount({ className, children, ...props }, ref) {
return (
<div
ref={ref}
data-slot="avatar-group-count"
className={cn(
"bg-muted text-muted-foreground size-8 rounded-full text-sm group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3 ring-background relative flex shrink-0 items-center justify-center ring-2",
className
)}
{...props}
>
{children}
</div>
);
});
export default AvatarGroupCount;
