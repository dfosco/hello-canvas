import { forwardRef } from "react";
import { Dialog as BUIDialog } from "@base-ui/react/dialog";
import { cn } from "../../../utils/index.js";

const PanelContent = forwardRef(function PanelContent({ className, children, ...props }, ref) {
return (
<BUIDialog.Portal>
<BUIDialog.Popup
ref={ref}
data-slot="panel-content"
className={cn(
"font-sans fixed z-[10000] bottom-28 right-6 w-[400px] max-h-[90vh] flex flex-col",
"bg-popover text-popover-foreground border-3 border-slate-400",
"rounded-xl shadow-xl overflow-x-hidden overflow-y-auto",
"data-[open]:animate-in data-[open]:fade-in-0 data-[open]:slide-in-from-bottom-4",
"data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:slide-out-to-bottom-4",
"duration-150",
className
)}
{...props}
>
{children}
</BUIDialog.Popup>
</BUIDialog.Portal>
);
});
export default PanelContent;
