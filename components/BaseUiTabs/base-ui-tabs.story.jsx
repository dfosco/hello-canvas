import BaseUiTabs from './BaseUiTabs.jsx'

function Frame({ children }) {
  return (
    <div className="flex items-center justify-center min-h-[220px] w-full p-6 bg-card text-card-foreground">
      <div className="w-full max-w-[420px]">{children}</div>
    </div>
  )
}

const items = [
  { value: 'overview', label: 'Overview', content: 'Project overview and high-level summary.' },
  { value: 'activity', label: 'Activity', content: 'Recent commits, PRs, and discussions.' },
  { value: 'settings', label: 'Settings', content: 'Repository settings and permissions.' },
]

export function Horizontal() {
  return <Frame><BaseUiTabs items={items} defaultValue="overview" /></Frame>
}

export function Vertical() {
  return <Frame><BaseUiTabs items={items} defaultValue="activity" orientation="vertical" /></Frame>
}
