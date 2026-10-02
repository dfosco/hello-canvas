import '../../assets/hello-canvas.css'
import BaseUiDialog from './BaseUiDialog.jsx'

function Frame({ children }) {
  return (
    <div className="flex items-center justify-center min-h-[160px] min-w-[220px] p-6 bg-card text-card-foreground">
      {children}
    </div>
  )
}

export function Default() {
  return (
    <Frame>
      <BaseUiDialog
        trigger="Open dialog"
        title="Invite teammates"
        description="They'll get an email with a link to join the workspace."
        primaryLabel="Send invites"
      />
    </Frame>
  )
}

export function Destructive() {
  return (
    <Frame>
      <BaseUiDialog
        trigger="Delete project"
        title="Delete project?"
        description="This action cannot be undone. The project and all its data will be permanently removed."
        primaryLabel="Delete"
      />
    </Frame>
  )
}
