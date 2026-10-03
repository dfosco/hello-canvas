import '../../assets/hello-canvas.css'
import BaseUiNumberField from './BaseUiNumberField.jsx'

function Frame({ children }) {
  return (
    <div className="flex items-center justify-center min-h-[160px] min-w-[240px] p-6 bg-card text-card-foreground">
      {children}
    </div>
  )
}

export function Default() {
  return <Frame><BaseUiNumberField label="Quantity" defaultValue={1} /></Frame>
}

export function WithLimits() {
  return <Frame><BaseUiNumberField label="Seats (1–10)" defaultValue={4} min={1} max={10} /></Frame>
}

export function AsPercentage() {
  return (
    <Frame>
      <BaseUiNumberField
        label="Discount"
        defaultValue={0.15}
        min={0}
        max={1}
        step={0.05}
        format={{ style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 0 }}
      />
    </Frame>
  )
}
