import BaseUiAccordion from './BaseUiAccordion.jsx'

function Frame({ children }) {
  return (
    <div className="flex items-start justify-center min-h-[280px] w-full p-6 bg-card text-card-foreground">
      <div className="w-full max-w-[420px]">{children}</div>
    </div>
  )
}

const items = [
  { value: 'install', title: 'How do I install?', content: 'Run npm install @base-ui/react in your project root.' },
  { value: 'styling', title: 'How do I style components?', content: 'Base UI is unstyled — bring your own CSS, Tailwind, or styling system.' },
  { value: 'a11y', title: 'Is it accessible?', content: 'Yes — every component ships with WCAG-compliant keyboard and ARIA behavior.' },
]

export function Single() {
  return <Frame><BaseUiAccordion items={items} defaultValue={['install']} /></Frame>
}

export function MultipleOpen() {
  return <Frame><BaseUiAccordion items={items} defaultValue={['install', 'styling']} /></Frame>
}
