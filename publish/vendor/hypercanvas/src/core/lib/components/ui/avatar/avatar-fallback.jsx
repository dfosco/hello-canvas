import { forwardRef } from "react";
import { Avatar as BUIAvatar } from "@base-ui/react/avatar";
import { cn } from "../../../utils/index.js";

const AvatarFallback = forwardRef(function AvatarFallback({ className, ...props }, ref) {
return (
<BUIAvatar.Fallback
ref={ref}
data-slot="avatar-fallback"
className={cn(
"bg-muted text-muted-foreground rounded-full flex size-full items-center justify-center text-sm group-data-[size=sm]/avatar:text-xs",
className
)}
{...props}
/>
);
});
export default AvatarFallback;
