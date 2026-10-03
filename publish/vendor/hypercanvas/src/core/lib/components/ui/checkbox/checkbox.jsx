import { forwardRef } from "react";
import { Checkbox as BUICheckbox } from "@base-ui/react/checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "../../../utils/index.js";

const Checkbox = forwardRef(function Checkbox({ className, checked, onCheckedChange, ...props }, ref) {
const isIndeterminate = checked === "indeterminate";
const controlledChecked = isIndeterminate ? false : checked;
return (
<BUICheckbox.Root
ref={ref}
data-slot="checkbox"
className={cn(
"border-input dark:bg-input/30 data-[checked]:bg-primary data-[checked]:text-primary-foreground dark:data-[checked]:bg-primary data-[checked]:border-primary aria-invalid:aria-checked:border-primary aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 flex size-4 items-center justify-center rounded-[4px] border transition-colors group-has-disabled/field:opacity-50 focus-visible:ring-3 aria-invalid:ring-3 peer relative shrink-0 outline-none after:absolute after:-inset-x-3 after:-inset-y-2 disabled:cursor-not-allowed disabled:opacity-50",
className
)}
checked={controlledChecked}
indeterminate={isIndeterminate || undefined}
onCheckedChange={onCheckedChange ? (next) => onCheckedChange(next) : undefined}
{...props}
>
<BUICheckbox.Indicator
data-slot="checkbox-indicator"
className="[&>svg]:size-3.5 grid place-content-center text-current transition-none"
>
{isIndeterminate ? <Minus /> : <Check />}
</BUICheckbox.Indicator>
</BUICheckbox.Root>
);
});

export default Checkbox;
