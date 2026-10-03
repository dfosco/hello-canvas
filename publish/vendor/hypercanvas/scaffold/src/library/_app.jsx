import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
// Direct imports bypass the barrel re-export in @dfosco/storyboard/index.js.
// The barrel eagerly re-exports CanvasPage (3K lines), CommandPalette (1.3K lines),
// and Viewfinder (1.5K lines) — all resolved by Vite dev even though _app only
// needs StoryboardProvider and AppErrorBoundary.
import StoryboardProvider from '@dfosco/hypercanvas/context'
import { AppErrorBoundary } from '@dfosco/hypercanvas/error-boundary'
import NotebookGate from '@dfosco/hypercanvas/notebook-gate'
import NotebookShell from '@dfosco/hypercanvas/notebook-shell'
import './_app.module.css'
import '@dfosco/hypercanvas/canvas/style.css'

function PageLoading() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: 'var(--bgColor-default, #0d1117)',
    }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 0.8s linear infinite' }}>
        <circle cx="12" cy="12" r="10" stroke="var(--fgColor-muted, #484f58)" strokeWidth="2.5" opacity="0.25" />
        <path d="M12 2a10 10 0 0 1 10 10" stroke="var(--fgColor-default, #e6edf3)" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

export default function App() {
  return (
    <NotebookShell>
      <StoryboardProvider>
        <NotebookGate />
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </StoryboardProvider>
    </NotebookShell>
  )
}

// Last-resort error boundary — generouted wires this via _app?.Catch
export const Catch = AppErrorBoundary
