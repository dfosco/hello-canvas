import { forwardRef } from "react";
import { cn } from "../../../utils/index.js";
import { tv } from "tailwind-variants";

export const badgeVariants = tv({
base: "h-5 gap-1 rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium transition-all has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:size-3! focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap transition-colors focus-visible:ring-[3px] [&>svg]:pointer-events-none",
variants: {
variant: {
default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
destructive: "bg-destructive/10 [a]:hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 text-destructive dark:bg-destructive/20",
outline: "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
ghost: "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
link: "text-primary underline-offset-4 hover:underline",
},
},
defaultVariants: {
variant: "default",
},
});

const Badge = forwardRef(function Badge({ href, className, variant = "default", children, ...props }, ref) {
const Component = href ? "a" : "span";
return (
<Component ref={ref} data-slot="badge" href={href} className={cn(badgeVariants({ variant }), className)} {...props}>
{children}
</Component>
);
});

export default Badge;
