import { Tooltip } from '@base-ui/react/tooltip'

export default function BaseUiTooltip({ children, content, side = 'top', open, ...props }) {
  return (
    <Tooltip.Provider>
      <Tooltip.Root open={open} {...props}>
        <Tooltip.Trigger
          className="
            inline-flex items-center justify-center
            rounded-md border border-input bg-background px-3 py-1.5
            text-sm font-medium text-foreground transition-colors
            hover:bg-muted
            focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2
          "
        >
          {children}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner side={side} sideOffset={6}>
            <Tooltip.Popup
              className="
                rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background
                shadow-md origin-[var(--transform-origin)]
                data-[starting-style]:opacity-0 data-[starting-style]:scale-95
                data-[ending-style]:opacity-0 data-[ending-style]:scale-95
                transition-[opacity,transform] duration-150
              "
            >
              {content}
              <Tooltip.Arrow className="data-[side=top]:-bottom-1 data-[side=bottom]:-top-1 data-[side=left]:-right-1 data-[side=right]:-left-1">
                <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor" className="text-foreground">
                  <path d="M0 0l5 6 5-6z" />
                </svg>
              </Tooltip.Arrow>
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
