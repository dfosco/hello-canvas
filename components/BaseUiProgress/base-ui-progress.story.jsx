import '../../assets/hello-canvas.css'
import BaseUiProgress from './BaseUiProgress.jsx'

function Frame({ children }) {
  return (
    <div className="flex items-center justify-center min-h-[140px] w-full p-6 bg-card text-card-foreground">
      <div className="w-full max-w-[320px]">{children}</div>
    </div>
  )
}

export function Determinate() {
  return <Frame><BaseUiProgress label="Uploading" value={64} /></Frame>
}

export function Indeterminate() {
  return <Frame><BaseUiProgress label="Loading" value={null} /></Frame>
}

export function Complete() {
  return <Frame><BaseUiProgress label="Done" value={100} /></Frame>
}
