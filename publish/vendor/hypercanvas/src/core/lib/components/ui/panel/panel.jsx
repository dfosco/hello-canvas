import { Dialog as BUIDialog } from "@base-ui/react/dialog";

export default function Panel({ children, ...props }) {
return (
<BUIDialog.Root
modal={false}
disablePointerDismissal
{...props}
>
{children}
</BUIDialog.Root>
);
}
