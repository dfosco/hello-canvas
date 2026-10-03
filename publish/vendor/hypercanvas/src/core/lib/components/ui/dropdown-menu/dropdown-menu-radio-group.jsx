import { forwardRef } from "react";
import { Menu as BUIMenu } from "@base-ui/react/menu";

const DropdownMenuRadioGroup = forwardRef(function DropdownMenuRadioGroup(props, ref) {
return <BUIMenu.RadioGroup ref={ref} data-slot="dropdown-menu-radio-group" {...props} />;
});
export default DropdownMenuRadioGroup;
