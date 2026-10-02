import BaseUiSlider from './BaseUiSlider.jsx'

function Frame({ children }) {
  return (
    <div className="flex items-center justify-center min-h-[160px] w-full p-6 bg-card text-card-foreground">
      <div className="w-full max-w-[320px]">{children}</div>
    </div>
  )
}

export function Default() {
  return (
    <Frame>
      <BaseUiSlider label="Volume" defaultValue={42} min={0} max={100} />
    </Frame>
  )
}

export function Range() {
  return (
    <Frame>
      <BaseUiSlider label="Price range" defaultValue={[20, 80]} min={0} max={100} format={(v) => `$${v}`} />
    </Frame>
  )
}

export function WithMarks() {
  return (
    <Frame>
      <BaseUiSlider
        label="Quality"
        defaultValue={3}
        min={1}
        max={5}
        step={1}
        marks={['1', '2', '3', '4', '5']}
      />
    </Frame>
  )
}
