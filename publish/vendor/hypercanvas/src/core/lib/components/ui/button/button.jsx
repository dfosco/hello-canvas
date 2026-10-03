import { forwardRef } from "react";
import { cn } from "../../../utils/index.js";
import { tv } from "tailwind-variants";

export const buttonVariants = tv({
base: "focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 rounded-lg font-medium focus-visible:ring-3 aria-invalid:ring-3 [&_svg:not([class*='size-'])]:size-4 group/button inline-flex size-full shrink-0 items-center justify-center whitespace-nowrap transition-colors outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
variants: {
variant: {
default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
outline: "bg-background hover:bg-muted hover:text-foreground dark:bg-input/30 dark:hover:bg-input/50 aria-expanded:bg-muted aria-expanded:text-foreground",
trigger: "focus-visible:ring-0",
secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
ghost: "hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground",
destructive: "bg-destructive/10 hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/20 text-destructive dark:hover:bg-destructive/30",
link: "text-primary underline-offset-4 hover:underline",
},
size: {
default: "text-sm gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
xs: "text-xs gap-1 rounded-[min(var(--sb--radius-md),10px)] px-2 in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
sm: "text-[0.8rem] gap-1 rounded-[min(var(--sb--radius-md),12px)] px-2.5 in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
lg: "text-sm gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
xl: "text-base gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-5",
"2xl": "text-lg gap-2.5 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4 [&_svg:not([class*='size-'])]:size-6",
icon: "text-sm",
"icon-xs": "text-xs rounded-[min(var(--sb--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
"icon-sm": "text-[0.8rem] rounded-[min(var(--sb--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
"icon-lg": "text-sm",
"icon-xl": "text-base [&_svg:not([class*='size-'])]:size-5",
"icon-2xl": "text-lg [&_svg:not([class*='size-'])]:size-6",
},
},
defaultVariants: {
variant: "default",
size: "default",
},
});

export const wrapperVariants = tv({
base: "inline-flex shrink-0 transition-transform",
variants: {
size: {
default: "h-8",
xs: "h-6 rounded-[min(var(--sb--radius-md),10px)] in-data-[slot=button-group]:rounded-lg",
sm: "h-7 rounded-[min(var(--sb--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
lg: "h-9",
xl: "h-11",
"2xl": "h-14",
icon: "size-8",
"icon-xs": "size-6 rounded-[min(var(--sb--radius-md),10px)] in-data-[slot=button-group]:rounded-lg",
"icon-sm": "size-7 rounded-[min(var(--sb--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
"icon-lg": "size-9",
"icon-xl": "size-11",
"icon-2xl": "size-14",
},
},
defaultVariants: {
size: "default",
},
});

const Button = forwardRef(function Button(
{ className, wrapperClass = "", variant = "default", size = "default", href, type = "button", disabled, children, ...props },
ref
) {
return (
<span
data-slot="button-wrapper"
className={cn(wrapperVariants({ size }), wrapperClass)}
style={{ background: "var(--sb--sc-border-color, transparent)", padding: "var(--sb--sc-border-width, 0px)" }}
>
{href ? (
<a
ref={ref}
className={cn(buttonVariants({ variant, size }), className)}
href={disabled ? undefined : href}
aria-disabled={disabled}
role={disabled ? "link" : undefined}
tabIndex={disabled ? -1 : undefined}
data-slot="button"
{...props}
>
{children}
</a>
) : (
<button
ref={ref}
className={cn(buttonVariants({ variant, size }), className)}
type={type}
disabled={disabled}
data-slot="button"
{...props}
>
{children}
</button>
)}
</span>
);
});

export default Button;
