import '../../assets/hello-canvas.css'
import BaseUiSwitch from './BaseUiSwitch.jsx'

function Frame({ children }) {
  return (
    <div className="flex items-center justify-center min-h-[140px] min-w-[220px] p-6 bg-card text-card-foreground">
      {children}
    </div>
  )
}

export function Off() {
  return <Frame><BaseUiSwitch label="Notifications" /></Frame>
}

export function On() {
  return <Frame><BaseUiSwitch label="Email digest" defaultChecked /></Frame>
}

export function Disabled() {
  return <Frame><BaseUiSwitch label="Read-only" defaultChecked disabled /></Frame>
}
