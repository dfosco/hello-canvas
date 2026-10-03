import { Select } from '@base-ui/react/select'

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth={2} width={12} height={10}>
      <path d="M1 5l3 3L11 1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function BaseUiSelect({ label, placeholder = 'Select…', items = [], groups, ...props }) {
  return (
    <div className="flex w-full flex-col gap-2 text-sm text-foreground">
      <Select.Root {...props}>
        {label && <Select.Label className="font-medium">{label}</Select.Label>}
        <Select.Trigger
          className="
            inline-flex h-9 w-full items-center justify-between gap-2
            rounded-md border border-input bg-background px-3
            text-foreground transition-colors
            hover:border-ring
            data-[popup-open]:border-ring data-[popup-open]:ring-1 data-[popup-open]:ring-ring
            focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2
          "
        >
          <Select.Value placeholder={placeholder} />
          <Select.Icon className="text-muted-foreground">
            <ChevronIcon />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner className="z-50" sideOffset={6}>
            <Select.Popup
              className="
                min-w-[var(--anchor-width)] overflow-hidden rounded-md
                border border-border bg-popover text-popover-foreground shadow-lg
                origin-[var(--transform-origin)] transition
                data-[starting-style]:opacity-0 data-[starting-style]:scale-95
                data-[ending-style]:opacity-0 data-[ending-style]:scale-95
              "
            >
              <Select.List className="max-h-[260px] overflow-auto p-1">
                {groups
                  ? groups.map((g) => (
                      <Select.Group key={g.label}>
                        <Select.GroupLabel className="px-2 py-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                          {g.label}
                        </Select.GroupLabel>
                        {g.items.map((item) => (
                          <Item key={item.value} item={item} />
                        ))}
                      </Select.Group>
                    ))
                  : items.map((item) => <Item key={item.value} item={item} />)}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  )
}

function Item({ item }) {
  return (
    <Select.Item
      value={item.value}
      className="
        relative flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm
        outline-none cursor-pointer
        data-[highlighted]:bg-muted
        data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed
      "
    >
      <span className="w-3 text-ring">
        <Select.ItemIndicator>
          <CheckIcon />
        </Select.ItemIndicator>
      </span>
      <Select.ItemText>{item.label}</Select.ItemText>
    </Select.Item>
  )
}
