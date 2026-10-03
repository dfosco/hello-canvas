import { forwardRef, isValidElement } from "react";
import { Menu as BUIMenu } from "@base-ui/react/menu";

const DropdownMenuTrigger = forwardRef(function DropdownMenuTrigger(
{ children, nativeButton, ...rest },
ref,
) {
const { asChild, ...props } = rest;
void asChild;
const isChildNativeButton = isValidElement(children) && children.type === "button";
const resolvedNativeButton = nativeButton ?? isChildNativeButton;
return (
<BUIMenu.Trigger
ref={ref}
nativeButton={resolvedNativeButton}
render={children}
{...props}
/>
);
});
export default DropdownMenuTrigger;
