import BaseUiTooltip from './BaseUiTooltip.jsx'

function Frame({ children }) {
  return (
    <div className="flex items-center justify-center min-h-[180px] min-w-[220px] p-10 bg-card text-card-foreground">
      {children}
    </div>
  )
}

export function Top() {
  return <Frame><BaseUiTooltip content="Tooltip on top" side="top" open><span>Hover top</span></BaseUiTooltip></Frame>
}

export function Right() {
  return <Frame><BaseUiTooltip content="Tooltip on right" side="right" open><span>Hover right</span></BaseUiTooltip></Frame>
}

export function Bottom() {
  return <Frame><BaseUiTooltip content="Tooltip on bottom" side="bottom" open><span>Hover bottom</span></BaseUiTooltip></Frame>
}

export function Left() {
  return <Frame><BaseUiTooltip content="Tooltip on left" side="left" open><span>Hover left</span></BaseUiTooltip></Frame>
}
