import { Tabs } from '@base-ui/react/tabs'

export default function BaseUiTabs({ items = [], orientation = 'horizontal', ...props }) {
  const isVertical = orientation === 'vertical'

  return (
    <Tabs.Root
      orientation={orientation}
      {...props}
      className={`flex w-full gap-4 text-sm text-foreground ${isVertical ? 'flex-row' : 'flex-col'}`}
    >
      <Tabs.List
        className={`
          relative flex shrink-0 gap-1 rounded-md bg-muted p-1
          ${isVertical ? 'flex-col' : 'flex-row'}
        `}
      >
        {items.map((item) => (
          <Tabs.Tab
            key={item.value}
            value={item.value}
            className="
              relative z-10 rounded-sm px-3 py-1.5 font-medium text-muted-foreground
              transition-colors cursor-pointer
              hover:text-foreground
              data-[selected]:text-foreground
              focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2
            "
          >
            {item.label}
          </Tabs.Tab>
        ))}
        <Tabs.Indicator
          className={`
            absolute z-0 rounded-sm bg-background shadow-sm transition-all
            ${isVertical ? 'left-1 right-1' : 'top-1 bottom-1'}
          `}
          style={
            isVertical
              ? { top: 'var(--active-tab-top)', height: 'var(--active-tab-height)' }
              : { left: 'var(--active-tab-left)', width: 'var(--active-tab-width)' }
          }
        />
      </Tabs.List>
      <div className="min-w-0 flex-1">
        {items.map((item) => (
          <Tabs.Panel
            key={item.value}
            value={item.value}
            className="rounded-md border border-border bg-background p-4 text-foreground"
          >
            {item.content}
          </Tabs.Panel>
        ))}
      </div>
    </Tabs.Root>
  )
}
