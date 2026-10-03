/**
 * CreatePage — full-page route that renders only the schema-driven
 * artifact creation form, centered on a clean background. Used by
 * `storyboard create --ui` to give the user a focused creation surface
 * without the workspace/viewfinder chrome.
 *
 * URL contract:
 *   /create               → picker (TypeSelector visible)
 *   /create?type=canvas   → fixed type
 *
 * The component renders as a fixed full-viewport overlay so it covers
 * the chrome (BranchBar, FeatureFlagBanner, CoreUIBar toolbar) that
 * StoryboardProvider mounts globally — even on this route. No close
 * button: this surface is opened by the CLI specifically as the create
 * flow; the user closes it by completing/cancelling the form.
 *
 * After successful create:
 *   - If the artifact has a route (prototype, canvas, page) → navigate to it.
 *   - Otherwise → navigate back to the workspace (basePath).
 */
import { useMemo } from 'react'
import CreateArtifactForm from '../CommandPalette/CreateArtifactForm.jsx'
import { isTauriAvailable } from '../../core/notebook/tauri-bridge.js'
import { isBrowserCoreMode } from '../../core/notebook/browserBridge.js'
import styles from './CreatePage.module.css'

export default function CreatePage({ basePath }) {
  const resolvedBase = basePath || (typeof window !== 'undefined' ? '/' : '/')

  // Parse `?type=<type>` once. We don't react to changes — switching the
  // type is handled in-form via the TypeSelector when in picker mode.
  const type = useMemo(() => {
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(window.location.search)
    return params.get('type') || null
  }, [])

  function handleClose() {
    // Cancel = navigate back to the workspace. Hard navigation so we
    // drop the `?type=…` query and any in-flight form state.
    if (typeof window !== 'undefined') {
      const target = (resolvedBase || '/').replace(/\/+$/, '/') || '/'
      window.location.href = target
    }
  }

  if (!isTauriAvailable() && !isBrowserCoreMode()) {
    return <main className={styles.page}><p>Artifact creation requires a running Hypercanvas Core session or the native app.</p></main>
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <CreateArtifactForm
          type={type}
          basePath={resolvedBase}
          onClose={handleClose}
          hideHeader={false}
        />
      </div>
    </div>
  )
}
