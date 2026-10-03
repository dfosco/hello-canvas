import { Menu as BUIMenu } from "@base-ui/react/menu";
export default function DropdownMenuSub({ children, ...props }) {
return <BUIMenu.SubmenuRoot {...props}>{children}</BUIMenu.SubmenuRoot>;
}
