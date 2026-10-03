import { forwardRef } from "react";
import { Menu as BUIMenu } from "@base-ui/react/menu";

const DropdownMenuGroup = forwardRef(function DropdownMenuGroup(props, ref) {
return <BUIMenu.Group ref={ref} data-slot="dropdown-menu-group" {...props} />;
});
export default DropdownMenuGroup;
