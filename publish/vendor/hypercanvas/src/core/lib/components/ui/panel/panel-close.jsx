import { forwardRef } from "react";
import { Dialog as BUIDialog } from "@base-ui/react/dialog";
import { Button } from "../button/index.js";
import { X } from "lucide-react";

const PanelClose = forwardRef(function PanelClose({ className, ...props }, ref) {
return (
<BUIDialog.Close
data-slot="panel-close"
render={(closeProps) => (
<Button ref={ref} variant="ghost" size="icon-sm" className={className} {...closeProps} {...props}>
<X />
<span className="sr-only">Close</span>
</Button>
)}
/>
);
});
export default PanelClose;
