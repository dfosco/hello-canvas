import { useKnob } from '@dfosco/hypercanvas'

export default function Branding() {
  const headline = useKnob('headline')
  const accentHue = useKnob('accentHue')
  const safeHeadline = String(headline ?? 'Close the feedback loop.')
  const numericHue = Number(accentHue ?? 239)
  const safeAccentHue = Number.isFinite(numericHue)
    ? Math.min(360, Math.max(0, numericHue))
    : 239

  const valueProps = [
    'Collect feedback from every channel in one inbox',
    'Spot trends with AI-powered theme detection',
    'Close the loop with automated follow-ups',
  ]

  return (
    <aside
      data-knob-id="accentHue"
      className="relative flex h-screen max-h-screen flex-col justify-between overflow-hidden bg-indigo-950 p-6 text-white"
      style={{
        '--brand-hue': String(safeAccentHue),
        backgroundColor: 'hsl(var(--brand-hue) 64% 20%)',
      }}
    >
      <header className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-md bg-indigo-500 text-lg"
          style={{ backgroundColor: 'hsl(var(--brand-hue) 84% 67%)' }}
        >
          🔁
        </span>
        <span className="text-lg font-semibold tracking-tight text-white">Loopline</span>
      </header>

      <div className="max-w-md">
        <h1
          data-knob-id="headline"
          className="text-4xl font-semibold leading-[1.1] tracking-tight text-white"
        >
          {safeHeadline}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-indigo-100">
          Loopline turns scattered customer feedback into a clear roadmap — so your
          team ships what people actually want.
        </p>

        <ul className="mt-7 space-y-3">
          {valueProps.map((text) => (
            <li key={text} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-indigo-500"
                style={{ backgroundColor: 'hsl(var(--brand-hue) 84% 67%)' }}
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-3.5 w-3.5 text-white"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 011.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
              <span className="text-base leading-relaxed text-white">{text}</span>
            </li>
          ))}
        </ul>
      </div>

      <figure
        className="mb-6 rounded-xl border border-indigo-800 bg-indigo-900/60 p-4"
        style={{
          backgroundColor: 'hsl(var(--brand-hue) 47% 27% / 0.6)',
          borderColor: 'hsl(var(--brand-hue) 47% 34%)',
        }}
      >
        <blockquote className="text-sm leading-relaxed text-white">
          “Loopline replaced four tools and finally got product, support, and design
          talking about the same feedback.”
        </blockquote>
        <figcaption className="mt-3 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 text-xs font-semibold text-white"
            style={{ backgroundColor: 'hsl(var(--brand-hue) 84% 67%)' }}
          >
            MK
          </span>
          <span className="text-sm">
            <span className="block font-medium text-white">Maya Kapoor</span>
            <span className="block text-indigo-300">Head of Product, Northwind</span>
          </span>
        </figcaption>
      </figure>
    </aside>
  )
}
