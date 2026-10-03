import { forwardRef } from "react";
import { Avatar as BUIAvatar } from "@base-ui/react/avatar";
import { cn } from "../../../utils/index.js";

const Avatar = forwardRef(function Avatar({ className, size = "default", ...props }, ref) {
return (
<BUIAvatar.Root
ref={ref}
data-slot="avatar"
data-size={size}
className={cn(
"size-8 rounded-full after:rounded-full data-[size=lg]:size-10 data-[size=sm]:size-6 after:border-border group/avatar relative flex shrink-0 select-none after:absolute after:inset-0 after:border after:mix-blend-darken dark:after:mix-blend-lighten",
className
)}
{...props}
/>
);
});
export default Avatar;
