import { forwardRef } from "react";
import { Avatar as BUIAvatar } from "@base-ui/react/avatar";
import { cn } from "../../../utils/index.js";

const AvatarImage = forwardRef(function AvatarImage({ className, ...props }, ref) {
return (
<BUIAvatar.Image
ref={ref}
data-slot="avatar-image"
className={cn("rounded-full aspect-square size-full object-cover", className)}
{...props}
/>
);
});
export default AvatarImage;
