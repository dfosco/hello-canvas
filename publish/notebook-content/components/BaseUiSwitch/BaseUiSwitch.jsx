import { Switch } from '@base-ui/react/switch'

export default function BaseUiSwitch({ label, ...props }) {
  return (
    <label className="inline-flex items-center gap-3 text-sm text-foreground cursor-pointer select-none">
      <Switch.Root
        {...props}
        className="
          relative h-6 w-10 shrink-0 rounded-full
          border border-input bg-muted transition-colors
          data-[checked]:bg-ring data-[checked]:border-ring
          data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed
          focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2
        "
      >
        <Switch.Thumb
          className="
            block h-5 w-5 rounded-full bg-background shadow-sm
            transition-transform translate-x-0.5
            data-[checked]:translate-x-[18px]
          "
        />
      </Switch.Root>
      {label && <span>{label}</span>}
    </label>
  )
}
