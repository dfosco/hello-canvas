import { Menu as BUIMenu } from "@base-ui/react/menu";
export default function DropdownMenu({ children, ...props }) {
return <BUIMenu.Root {...props}>{children}</BUIMenu.Root>;
}
