import { Slider } from '@base-ui/react/slider'

export default function BaseUiSlider({ label, marks, format, ...props }) {
  const initial = props.defaultValue ?? props.value ?? 0
  const valueCount = Array.isArray(initial) ? initial.length : 1

  return (
    <div className="flex w-full flex-col gap-3 text-sm text-foreground">
      <Slider.Root {...props} className="flex w-full flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <Slider.Label className="font-medium">{label}</Slider.Label>
          <Slider.Value className="font-mono text-xs text-muted-foreground">
            {format
              ? (values) => values.map(format).join(' – ')
              : (values) => values.join(' – ')}
          </Slider.Value>
        </div>
        <Slider.Control className="relative flex h-6 w-full touch-none select-none items-center">
          <Slider.Track className="relative h-1.5 w-full rounded-full bg-muted">
            <Slider.Indicator className="absolute h-full rounded-full bg-ring" />
          </Slider.Track>
          {Array.from({ length: valueCount }).map((_, i) => (
            <Slider.Thumb
              key={i}
              index={i}
              className="
                block h-4 w-4 rounded-full bg-background
                border-2 border-ring shadow-sm
                focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2
              "
            />
          ))}
        </Slider.Control>
      </Slider.Root>
      {marks && (
        <div className="flex justify-between text-xs text-muted-foreground">
          {marks.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
      )}
    </div>
  )
}
