/**
 * storyboard-core — framework-agnostic data layer.
 *
 * This barrel exports all core utilities that have zero framework dependencies.
 * Any frontend (React, Vue, Alpine, vanilla JS) can use these directly.
 */

// Data index initialization
export { init } from './data/loader.js'

// Flow, object & record loading
export { loadFlow, listFlows, flowExists, getFlowsForPrototype, loadRecord, findRecord, loadObject, deepMerge } from './data/loader.js'
// Scoped name resolution
export { resolveFlowName, resolveRecordName, resolveObjectName } from './data/loader.js'
// Prototype metadata
export { listPrototypes, getPrototypeMetadata } from './data/loader.js'
// Folder metadata
export { listFolders, getFolderMetadata } from './data/loader.js'
// Canvas data
export { listCanvases, getCanvasData } from './data/loader.js'
// Story data
export { listStories, getStoryData } from './data/loader.js'
// Deprecated scene aliases
export { loadScene, listScenes, sceneExists } from './data/loader.js'

// Dot-notation path utilities
export { getByPath, setByPath, deepClone } from './data/dotPath.js'

// URL hash session state (read/write)
export { getParam, setParam, getAllParams, removeParam } from './session/session.js'

// localStorage persistence
export { getLocal, setLocal, removeLocal, getAllLocal, subscribeToStorage, getStorageSnapshot, notifyChange } from './session/localStorage.js'

// Hide mode (clean URLs)
export { isHideMode, activateHideMode, deactivateHideMode, getShadow, setShadow, removeShadow, getAllShadows, pushSnapshot, getOverrideHistory, getCurrentSnapshot, getCurrentRoute, getCurrentIndex, getNextIndex, canUndo, canRedo, undo, redo, syncHashToHistory, installHistorySync } from './session/hideMode.js'
export { interceptHideParams, installHideParamListener } from './session/interceptHideParams.js'

// Hash change subscription (for reactive frameworks)
export { subscribeToHash, getHashSnapshot } from './session/hashSubscribe.js'

// Body class sync (overrides + flow → <body> classes)
export { installBodyClassSync, setFlowClass, syncOverrideClasses } from './session/bodyClasses.js'
// Deprecated alias
export { setSceneClass } from './session/bodyClasses.js'

// Design modes (mode registry, switching, event bus)
export { registerMode, unregisterMode, getRegisteredModes, getCurrentMode, activateMode, deactivateMode, subscribeToMode, getModeSnapshot, syncModeClasses, on, off, emit, initModesConfig, isModesEnabled, getLockedMode, isModeSwitcherVisible } from './modes/modes.js'

// Tool registry (declared in modes.config.json, state managed at runtime)
export { initTools, setToolAction, setToolState, getToolState, getToolsForMode, subscribeToTools, getToolsSnapshot } from './modes/modes.js'

// Dev tools (vanilla JS, framework-agnostic)
// mountDevTools delegates to the compiled UI bundle so consumers

export { mountDevTools } from './devtools/devtools-consumer.js'
export { mountFlowDebug } from './devtools/sceneDebug.js'
// Deprecated alias
export { mountSceneDebug } from './devtools/sceneDebug.js'

// Single entry point for consumer apps
export { mountStoryboardCore } from './mountStoryboardCore.js'

// Viewfinder utilities
export { hash, resolveFlowRoute, getFlowMeta, buildPrototypeIndex, appendTokens } from './data/viewfinder.js'
// Deprecated aliases
export { resolveSceneRoute, getSceneMeta } from './data/viewfinder.js'

// Feature flags
export { initFeatureFlags, getFlag, setFlag, toggleFlag, getAllFlags, resetFlags, getFlagKeys, syncFlagBodyClasses } from './stores/featureFlags.js'

// Knobs system (typed hash-key schema layer)
export * from './knobs/index.js'

// Command actions (config-driven command menu entries)
export { initCommandActions, registerCommandAction, unregisterCommandAction, setDynamicActions, clearDynamicActions, getActionsForMode, executeAction, getActionChildren, hasChildrenProvider, subscribeToCommandActions, getCommandActionsSnapshot, setRoutingBasePath, isExcludedByRoute } from './stores/commandActions.js'

// Plugin configuration
export { initPlugins, isPluginEnabled, getPluginsConfig } from './stores/plugins.js'

// UI config (project-level chrome overrides)
export { initUIConfig, isMenuHidden, getHiddenItems, addHiddenItems } from './stores/uiConfig.js'

// Tool registry (declarative tool system)
export { initToolRegistry, registerToolModule, setToolComponent, setToolGuardResult, getToolComponent, getToolModule, getToolsForToolbar, getToolConfig, getAllToolConfigs, subscribeToToolRegistry, getToolRegistrySnapshot } from './stores/toolRegistry.js'

// Toolbar config store (reactive layered overrides: core → custom → prototype → user)
export { initToolbarConfig, setPrototypeToolbarConfig, clearPrototypeToolbarConfig, getToolbarConfig, subscribeToToolbarConfig, getToolbarConfigSnapshot, setClientToolbarOverrides, consumeClientToolbarOverrides } from './stores/toolbarConfigStore.js'

// Toolbar tool state management (runtime state for toolbar tools)
export { TOOL_STATES, initToolbarToolStates, setToolbarToolState, getToolbarToolState, isToolbarToolLocalOnly, subscribeToToolbarToolStates, getToolbarToolStatesSnapshot } from './stores/toolStateStore.js'

// Comments system
export { initCommentsConfig, getCommentsConfig, isCommentsEnabled } from './comments/config.js'

// Canvas config (paste rules, canvas-level overrides)
export { initCanvasConfig, getPasteRules, getTerminalConfig, getAgentsConfig, isTerminalResizable, getTerminalDimensions, getCanvasZoom, getCanvasProduction, isCanvasProductionEnabled } from './stores/canvasConfig.js'
export { getCommandPaletteConfig, initCommandPaletteConfig } from './stores/commandPaletteConfig.js'

// Unified config store
export { initConfig, getConfig, setOverrides, clearOverrides, clearAllOverrides, subscribeToConfig, getConfigSnapshot } from './stores/configStore.js'

// Customer mode config
export {
  initCustomerModeConfig,
  getCustomerModeConfig,
  isCustomerMode,
  getCustomerModeHomepage,
  resolveHomepageTarget,
  isCustomerHidingHomepage,
  isCustomerHidingAllTools,
  isCustomerHidingCommandPalette,
  isCustomerHidingBranchBar,
  isCustomerToolHidden,
} from './stores/customerModeConfig.js'

// Presentation overrides (advanced, undocumented power-user API)
export {
  initPresentation,
  setPresentation,
  getPresentation,
  subscribeToPresentation,
  getPresentationSnapshot,
} from './stores/presentationStore.js'

// Custom widgets — public API. Register your own canvas widget types with
// full control over rendering, chrome, interaction, and toolbar features.
// See DOCS/custom-widgets.md.
export {
  initWidgetRegistry,
  registerWidget,
  unregisterWidget,
  getWidgetDefinition,
  getAllWidgetDefinitions,
  subscribeToWidgetRegistry,
  getWidgetRegistrySnapshot,
} from './stores/widgetRegistry.js'

// Canvas interaction (advanced, undocumented — scroll axis + zoom gesture gates)
export {
  initCanvasInteraction,
  setCanvasInteraction,
  getCanvasInteraction,
  subscribeToCanvasInteraction,
  getCanvasInteractionSnapshot,
} from './stores/canvasInteractionStore.js'

// Theme
export {
  setTheme,
  getTheme,
  themeState,
  themeSyncState,
  THEMES,
  getThemeSyncTargets,
  setThemeSyncTarget,
  // New config-driven API
  getSurfaceSync,
  setSurfaceSync,
  surfaceSyncState,
  getResolvedFor,
} from './stores/themeStore.js'

// Recent artifacts (command palette recents)
export { trackRecent, getRecent, clearRecent, subscribeToRecent, getRecentSnapshot } from './stores/recentArtifacts.js'

// Fuzzy search (scoring used by command palette custom filter)
export { scoreMatch } from './utils/fuzzySearch.js'

// Icon component for UI rendering
export { default as Icon, default as IconDefault } from './ui/Icon.jsx'

// Shared UI components
export { default as BranchSelect } from './ui/BranchSelect.jsx'

// sbNavigate — SPA-first navigation helper for internal call sites
export { sbNavigate, setNavigationRouter, getNavigationRouter } from './navigation/sbNavigate.js'

// External Site artifacts and machine-local bindings
export { normalizeSiteId, normalizeSiteRoute, normalizeSiteUrl, resolveSiteUrl } from './site/contract.js'
export { createPublishedSiteFrame, normalizeSiteReference, siteCaptureKey } from './site/publish.js'
export { buildPublishedSiteManifest, renderPublishedSiteFrame } from './site/published.js'
