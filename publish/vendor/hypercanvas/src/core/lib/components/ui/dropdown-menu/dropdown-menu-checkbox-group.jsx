import { forwardRef } from "react";
import { Menu as BUIMenu } from "@base-ui/react/menu";

// Base-UI also has no dedicated CheckboxGroup for menus — use Group as the container.
const DropdownMenuCheckboxGroup = forwardRef(function DropdownMenuCheckboxGroup(props, ref) {
return <BUIMenu.Group ref={ref} data-slot="dropdown-menu-checkbox-group" {...props} />;
});
export default DropdownMenuCheckboxGroup;
