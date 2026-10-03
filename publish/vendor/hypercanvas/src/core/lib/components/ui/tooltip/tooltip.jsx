import { Tooltip as BUITooltip } from "@base-ui/react/tooltip";

export default function Tooltip({ children, ...props }) {
return (
<BUITooltip.Provider delay={50}>
<BUITooltip.Root {...props}>
{children}
</BUITooltip.Root>
</BUITooltip.Provider>
);
}
