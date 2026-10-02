import BaseUiCheckbox from './BaseUiCheckbox.jsx'

function Frame({ children }) {
  return (
    <div className="flex items-center justify-center min-h-[140px] min-w-[200px] p-6 bg-card text-card-foreground">
      {children}
    </div>
  )
}

export function Default() {
  return <Frame><BaseUiCheckbox label="Accept terms" /></Frame>
}

export function Checked() {
  return <Frame><BaseUiCheckbox label="Subscribed" defaultChecked /></Frame>
}

export function Indeterminate() {
  return <Frame><BaseUiCheckbox label="Mixed selection" indeterminate /></Frame>
}

export function Disabled() {
  return <Frame><BaseUiCheckbox label="Unavailable" disabled defaultChecked /></Frame>
}
