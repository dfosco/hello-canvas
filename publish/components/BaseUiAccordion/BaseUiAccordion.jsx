import { Accordion } from '@base-ui/react/accordion'

function ChevronIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="transition-transform duration-200 group-data-[panel-open]:rotate-180"
    >
      <path d="M3 5l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function BaseUiAccordion({ items = [], ...props }) {
  return (
    <Accordion.Root
      {...props}
      className="flex w-full flex-col divide-y divide-border rounded-md border border-border bg-background text-sm text-foreground"
    >
      {items.map((item) => (
        <Accordion.Item key={item.value} value={item.value} className="group">
          <Accordion.Header className="m-0">
            <Accordion.Trigger
              className="
                flex w-full items-center justify-between gap-3
                px-4 py-3 text-left font-medium
                cursor-pointer
                hover:bg-muted
                focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]
              "
            >
              <span>{item.title}</span>
              <ChevronIcon />
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel
            className="
              overflow-hidden text-muted-foreground
              data-[open]:animate-in data-[closed]:animate-out
            "
          >
            <div className="px-4 pb-4">{item.content}</div>
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  )
}
