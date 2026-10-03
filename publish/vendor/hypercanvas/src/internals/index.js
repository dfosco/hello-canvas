/**
 * @dfosco/storyboard-react — React framework binding for Storyboard.
 *
 * Provides hooks, context, and provider for React apps.
 * Design-system-agnostic — no Primer, Reshaped, or other UI library deps.
 */

// Context & Provider
export { default as StoryboardProvider } from './context.jsx'
export { StoryboardContext } from './StoryboardContext.js'

// Hooks
export { useFlowData, useFlowLoading } from './hooks/useSceneData.js'
// Deprecated aliases
export { useSceneData, useSceneLoading } from './hooks/useSceneData.js'
export { useOverride } from './hooks/useOverride.js'
export { useOverride as useSession } from './hooks/useOverride.js' // deprecated alias
export { useFlow, useScene } from './hooks/useScene.js'
export { useFlows } from './hooks/useFlows.js'
export { useRecord, useRecords } from './hooks/useRecord.js'
export { useObject } from './hooks/useObject.js'
export { useLocalStorage } from './hooks/useLocalStorage.js'
export { useHideMode } from './hooks/useHideMode.js'
export { useUndoRedo } from './hooks/useUndoRedo.js'
export { useFeatureFlag } from './hooks/useFeatureFlag.js'
export { useMode } from './hooks/useMode.js'
export { useThemeState, useThemeSyncTargets } from './hooks/useThemeState.js'
export { useConfig } from './hooks/useConfig.js'
export { useKnob } from './hooks/useKnob.js'
export { useDropArea } from './hooks/useDropArea.js'
export { registerDropArea } from './dragDrop/dropRouter.js'
export { KnobsForm } from './Knobs/index.js'

// React Router integration
export { installHashPreserver } from './hashPreserver.js'

// Form context (for design system packages to use)
export { FormContext } from './context/FormContext.js'

// Design mode hook (keep — React apps may still read mode state)


// Workspace dashboard
export { default as Workspace } from './Workspace.jsx'
export { default as NotebookShell, openNotebookSidebar, lastVisitedPageStorageKey } from './NotebookShell/NotebookShell.jsx'
// Deprecated alias — use Workspace instead
export { default as Viewfinder } from './Workspace.jsx'

// Simplified workspace — dev-only "old index" view, falls back to Workspace in prod
export { default as SimpleWorkspace } from './SimpleWorkspace/SimpleWorkspace.jsx'

// Command Palette (includes BranchBar automatically)
export { default as StoryboardCommandPalette } from './CommandPalette/CommandPalette.jsx'

// Create-only page (used by `storyboard create --ui`)
export { default as CreatePage } from './CreatePage/CreatePage.jsx'

// Branch Bar (standalone, for consumers who don't use CommandPalette)
export { default as BranchBar } from './BranchBar/BranchBar.jsx'

// Auth Modal (standalone, for consumers who don't use CommandPalette)
export { default as AuthModal } from './AuthModal/AuthModal.jsx'

// Canvas
export { default as CanvasPage } from './canvas/CanvasPage.jsx'
export { useCanvas } from './canvas/useCanvas.js'

// Drag & drop ingestion
export { default as DropZone } from './DropZone/DropZone.jsx'
export { showToast } from './showToast.js'

// Widget — render any registered canvas widget inside a normal React page.
export { default as Widget } from './canvas/widgets/Widget.jsx'
export { getWidgetComponent } from './canvas/widgets/index.js'

// Error boundaries
export { default as PrototypeErrorBoundary, ImportErrorFallback, AppErrorBoundary } from './PrototypeErrorBoundary.jsx'

// Icon
export { default as Icon } from './Icon.jsx'

export { sbNavigate } from '../core/navigation/sbNavigate.js'
