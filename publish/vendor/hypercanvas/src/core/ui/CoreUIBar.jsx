/**
 * CoreUIBar — unified floating button bar for the storyboard devtools.
 *
 * Fixed bottom-right. Always shows the ⌘ command button (rightmost).
 * Mode-specific buttons appear to its left at a smaller size.
 * Hue follows the active mode's collar color via --trigger-* CSS custom
 * properties set in modes.css.
 *
 * Initializes the command action registry and registers core handlers.
 */

import './CoreUIBar.css';
import { useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore } from 'react'
import './core-ui-colors.css'
import * as Panel from '../lib/components/ui/panel/index.js'
import PwaInstallBanner from './PwaInstallBanner.jsx'
import { TriggerButton } from '../lib/components/ui/trigger-button/index.js'
import * as Tooltip from '../lib/components/ui/tooltip/index.js'
import Icon from './Icon.jsx'
import { getCurrentMode, getRegisteredModes, subscribeToMode, isModeSwitcherVisible } from '../modes/modes.js'
import { sidePanelState, togglePanel } from '../stores/sidePanelStore.js'
import {
  initCommandActions, registerCommandAction, getActionChildren,
  hasChildrenProvider, isExcludedByRoute, setRoutingBasePath,
  setDynamicActions, clearDynamicActions,
} from '../stores/commandActions.js'
import { isMobile, subscribeToMobile } from '../utils/mobileViewport.js'
import { isMenuHidden } from '../stores/uiConfig.js'
import { isCustomerToolHidden } from '../stores/customerModeConfig.js'
import { subscribeToToolbarConfig, getToolbarConfig } from '../stores/toolbarConfigStore.js'
import {
  initToolbarToolStates, getToolbarToolState, isToolbarToolLocalOnly,
  subscribeToToolbarToolStates,
} from '../stores/toolStateStore.js'
import defaultToolbarConfig from '../../../toolbar.config.json'
import { getPrototypeMetadata } from '../data/loader.js'
import { setPrototypeToolbarConfig, clearPrototypeToolbarConfig } from '../stores/toolbarConfigStore.js'
import { setOverrides, clearOverrides } from '../stores/configStore.js'
import { coreHandlers } from '../tools/registry.js'
import { subscribeToHash } from '../session/hashSubscribe.js'
import { toggleCommentMode, isCommentModeActive } from '../comments/commentMode.js'
import { getFlag } from '../stores/featureFlags.js'
import { isAuthenticated } from '../comments/auth.js'
import { openAuthModal } from '../comments/ui/authModal.js'
import { setTheme, getTheme } from '../stores/themeStore.js'
import { getConfig } from '../stores/configStore.js'
import SidePanelComponent from './SidePanel.jsx'
import ChromeSlot from './ChromeSlot.jsx'
import KnobsPanel from './KnobsPanel.jsx'
import { isKnobsPanelOpen, toggleKnobsPanel } from './knobsPanelState.js'

const isEmbed = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('_sb_embed')
const isLocalDev = typeof window !== 'undefined' && window.__SB_LOCAL_DEV__ === true && !new URLSearchParams(window.location.search).has('prodMode')

/**
 * Resolve a handler reference to a module loader function.
 * Format: "core:name" → core registry, "custom:name" → client handlers
 */
function resolveHandlerModule(ref, coreModules, custom) {
  const colonIdx = ref.indexOf(':')
  if (colonIdx === -1) return coreModules[ref] || null
  const prefix = ref.slice(0, colonIdx)
  const name = ref.slice(colonIdx + 1)
  if (prefix === 'core') return coreModules[name] || null
  if (prefix === 'custom') return custom[name] || null
  return null
}

// Resolve tools → menus compatibility layer.
function resolveMenus(cfg) {
  if (cfg.tools) {
    const result = {}
    for (const [key, tool] of Object.entries(cfg.tools)) {
      if (tool.surface === 'command-palette' || tool.surface === 'canvas-toolbar' || tool.surface === 'collab-bar') continue
      const menu = { ...tool }
      if (tool.render === 'menu' && tool.handler) {
        menu.action = tool.handler
      }
      result[key] = { ...menu, _toolId: key }
    }
    return result
  }
  return cfg.menus || {}
}

function resolveCommandConfig(cfg) {
  if (!cfg.tools) return cfg.menus?.command || null
  const actions = []
  actions.push({ type: 'header', label: 'Command Menu' })

  for (const [toolKey, tool] of Object.entries(cfg.tools)) {
    if (tool.surface !== 'command-palette') continue
    if (tool.render === 'separator') {
      actions.push({ type: 'separator' })
      continue
    }
    actions.push({
      id: tool.handler || `core/${tool.label?.toLowerCase().replace(/\s+/g, '-')}`,
      label: tool.label || tool.ariaLabel,
      type: tool.render || 'default',
      url: tool.url || null,
      modes: tool.modes || ['*'],
      toolKey,
      localOnly: !tool.prod,
      hideFromCommandPaletteSearch: tool.hideFromCommandPaletteSearch || false,
    })
  }

  return {
    ariaLabel: 'Command Menu',
    trigger: 'command',
    default: true,
    modes: ['*'],
    actions,
  }
}

function menuVisibleInMode(menu, mode) {
  if (!menu?.modes) return false
  if (isExcludedByRoute(menu)) return false
  return menu.modes.includes('*') || menu.modes.includes(mode)
}

function shortcutRequiresShift(shortcut) {
  const key = String(shortcut?.key || '')
  return shortcut?.shift === true || /\bshift\b/i.test(shortcut?.label || '') || key !== key.toLowerCase()
}

function shortcutMatches(event, shortcut) {
  if (!shortcut?.key) return false
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return false
  if (event.shiftKey !== shortcutRequiresShift(shortcut)) return false
  return String(event.key || '').toLowerCase() === String(shortcut.key).toLowerCase()
}

function KnobsPanelToolbarButton({ config = {}, data, tabIndex, localOnly }) {
  const open = useSyncExternalStore(subscribeToHash, isKnobsPanelOpen, () => false)
  const execute = data?.execute || toggleKnobsPanel

  return (
    <TriggerButton
      active={open}
      localOnly={localOnly}
      size={config.size || 'icon-xl'}
      aria-label={config.ariaLabel || 'Tweak knobs'}
      tabIndex={tabIndex}
      onClick={execute}
    >
      <Icon name={config.icon || 'iconoir/settings'} size={16} {...(config.meta || {})} />
    </TriggerButton>
  )
}

// Subscribable mode state for useExternalStore
const modeState = {
  get mode() { return getCurrentMode() },
  get modes() { return getRegisteredModes() },
  get switcherVisible() { return isModeSwitcherVisible() },
  subscribe(fn) {
    const snapshot = () => ({
      mode: getCurrentMode(),
      modes: getRegisteredModes(),
      switcherVisible: isModeSwitcherVisible(),
    })
    fn(snapshot())
    return subscribeToMode(() => fn(snapshot()))
  },
}

// Hook to subscribe to an external store (modeState, sidePanelState)
function useExternalStore(store) {
  const [value, setValue] = useState(() => ({ ...store }))
  useEffect(() => {
    // For stores that expose subscribe
    if (store.subscribe) {
      const unsub = store.subscribe((v) => setValue({ ...v }))
      return unsub
    }
  }, [store])
  return value
}

export default function CoreUIBar({ basePath = '/', toolbarConfig, customHandlers = {} }) {
  const [visible, setVisible] = useState(
    () => !document.documentElement.classList.contains('storyboard-chrome-hidden')
  )
  const [completelyHidden, setCompletelyHidden] = useState(
    () => document.documentElement.classList.contains('storyboard-chrome-completely-hidden')
  )
  const [toolComponents, setToolComponents] = useState({})
  const [toolData, setToolData] = useState({})
  const [navVersion, setNavVersion] = useState(0)
  const [canvasActive, setCanvasActive] = useState(false)
  const [activeCanvasId, setActiveCanvasId] = useState('')
  const [canvasZoom, setCanvasZoom] = useState(100)
  const [toolStateVersion, setToolStateVersion] = useState(0)
  const [isMobileState, setIsMobileState] = useState(isMobile())
  const [activeToolbarIndex, setActiveToolbarIndex] = useState(-1)
  const [flowDialogOpen, setFlowDialogOpen] = useState(false)
  const [flowName, setFlowName] = useState('default')
  const [flowJson, setFlowJson] = useState('')
  const [flowError, setFlowError] = useState(null)

  const toolbarEl = useRef(null)
  const mobileActionsRegistered = useRef(false)
  const origPushStateRef = useRef(null)
  const origReplaceStateRef = useRef(null)
  const bumpNavRef = useRef(null)

  // Subscribe to external stores
  const currentModeState = useExternalStore(modeState)
  const currentSidePanelState = useExternalStore(sidePanelState)

  // Subscribe to toolbar config store
  const [storeConfig, setStoreConfig] = useState(getToolbarConfig())
  useEffect(() => {
    const unsub = subscribeToToolbarConfig((cfg) => setStoreConfig(cfg))
    return unsub
  }, [])

  // Subscribe to tool state changes
  useEffect(() => {
    const unsub = subscribeToToolbarToolStates(() => setToolStateVersion((v) => v + 1))
    return unsub
  }, [])

  // Resolved config
  const config = useMemo(() => {
    return (storeConfig && Object.keys(storeConfig).length > 0)
      ? storeConfig
      : (toolbarConfig || defaultToolbarConfig)
  }, [storeConfig, toolbarConfig])

  // Re-seed tool states whenever config changes
  useEffect(() => {
    const tools = config.tools || {}
    initToolbarToolStates(tools, { isLocalDev })
  }, [config])

  const commandMenuConfig = useMemo(() => resolveCommandConfig(config), [config])

  const shortcutsConfig = useMemo(() => {
    const tools = config.tools || {}
    const hideChromeTool = tools['hide-chrome']
    const commandPaletteTool = tools['command-palette']
    return {
      hideChrome: hideChromeTool?.shortcut || { key: '.', label: '⌘.' },
      openCommandMenu: commandPaletteTool?.shortcut || { key: 'k', label: '⌘K' },
    }
  }, [config])

  const allMenus = useMemo(() => resolveMenus(config), [config])

  const orderedMenus = useMemo(() => {
    // Reference toolStateVersion to re-compute when tool states change
    void toolStateVersion
    return Object.entries(allMenus)
      .filter(([key]) => key !== 'command')
      .filter(([key]) => !isMenuHidden(key))
      .filter(([key]) => !isCustomerToolHidden(key))
      .filter(([key]) => key !== 'agents-ready' || getFlag('agents-ready'))
      .filter(([key]) => getToolbarToolState(key) !== 'disabled')
      .map(([key, menu]) => ({ key, ...menu }))
  }, [allMenus, toolStateVersion])

  const sidepanelMenus = useMemo(
    () => orderedMenus.filter((menu) => menu.sidepanel),
    [orderedMenus],
  )

  const canvasMenus = useMemo(() => {
    return config.tools
      ? Object.entries(config.tools)
          .filter(([, tool]) => tool.surface === 'canvas-toolbar')
          .filter(([, tool]) => tool.prod || isLocalDev)
          .filter(([key]) => !isMenuHidden(key))
          .filter(([key]) => !isCustomerToolHidden(key))
          .map(([key, tool]) => ({ key, ...tool }))
      : []
  }, [config])

  const collabBarMenus = useMemo(() => {
    return config.tools
      ? Object.entries(config.tools)
          .filter(([, tool]) => tool.surface === 'collab-bar')
          .filter(([, tool]) => tool.prod || isLocalDev)
           .filter(([key]) => !isMenuHidden(key))
           .filter(([key]) => !isCustomerToolHidden(key))
           .filter(([key]) => key !== 'agents-ready' || getFlag('agents-ready'))
          .map(([key, tool]) => ({ key, ...tool }))
      : []
  }, [config])

  const visibleMenus = useMemo(() => {
    void navVersion
    void toolStateVersion
    return orderedMenus
      .filter((menu) => {
        const toolState = getToolbarToolState(menu.key)
        if (toolState === 'hidden') return false
        if (menu.render === 'separator') return true
        if (!menuVisibleInMode(menu, currentModeState.mode)) return false
        if (menu.render === 'sidepanel') return true
        if (menu.render === 'knobs-panel') return true
        if (!toolComponents[menu.key]) return false
        const actionId = menu.handler || menu.action
        if (actionId && menu.render === 'menu' && hasChildrenProvider(actionId)) {
          return getActionChildren(actionId).length > 0
        }
        return true
      })
  }, [orderedMenus, navVersion, toolStateVersion, currentModeState.mode, toolComponents])

  const cleanedMenus = useMemo(() => {
    const result = []
    for (const item of visibleMenus) {
      if (item.render === 'separator') {
        if (result.length === 0 || result[result.length - 1].render === 'separator') continue
        result.push(item)
      } else {
        result.push(item)
      }
    }
    while (result.length > 0 && result[result.length - 1].render === 'separator') result.pop()
    return result
  }, [visibleMenus])

  const toolbarItemCount = useMemo(
    () => cleanedMenus.filter((m) => m.render !== 'separator').length,
    [cleanedMenus],
  )

  const lastToolIndex = useMemo(
    () => cleanedMenus.filter((m) => m.render !== 'separator').length - 1,
    [cleanedMenus],
  )

  function getTabindex(index) {
    if (activeToolbarIndex < 0) {
      return index === lastToolIndex ? 0 : -1
    }
    return index === activeToolbarIndex ? 0 : -1
  }

  const focusToolbarItem = useCallback((index) => {
    setActiveToolbarIndex(index)
    if (!toolbarEl.current) return
    const buttons = toolbarEl.current.querySelectorAll('[data-slot="button"]')
    buttons[index]?.focus()
  }, [])

  const handleToolbarKeydown = useCallback((e) => {
    if (toolbarItemCount === 0) return
    const current = activeToolbarIndex < 0 ? toolbarItemCount - 1 : activeToolbarIndex

    if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusToolbarItem((current + 1) % toolbarItemCount)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusToolbarItem((current - 1 + toolbarItemCount) % toolbarItemCount)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusToolbarItem(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      focusToolbarItem(toolbarItemCount - 1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const openContent = document.querySelector('[data-slot="dropdown-menu-content"]')
      if (openContent) {
        const items = openContent.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')
        if (items.length > 0) items[items.length - 1].focus()
        return
      }
      const focusedBtn = toolbarEl.current?.querySelector('[data-slot="button"]:focus')
      if (focusedBtn?.getAttribute('aria-haspopup')) {
        focusedBtn.click()
        requestAnimationFrame(() => {
          const content = document.querySelector('[data-slot="dropdown-menu-content"]')
          if (content) {
            const items = content.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')
            if (items.length > 0) items[items.length - 1].focus()
          }
        })
      }
    }
  }, [toolbarItemCount, activeToolbarIndex, focusToolbarItem])

  const toggleToolsVisibility = useCallback(() => {
    setVisible((v) => {
      const next = !v
      document.documentElement.classList.toggle('storyboard-chrome-hidden', !next)
      // Always clear completely-hidden when toggling via cmd+.
      document.documentElement.classList.remove('storyboard-chrome-completely-hidden')
      return next
    })
  }, [])

  const toggleCompletelyHidden = useCallback(() => {
    const isAnyHidden = document.documentElement.classList.contains('storyboard-chrome-hidden')
    if (isAnyHidden) {
      document.documentElement.classList.remove('storyboard-chrome-hidden')
      document.documentElement.classList.remove('storyboard-chrome-completely-hidden')
      setVisible(true)
    } else {
      document.documentElement.classList.add('storyboard-chrome-hidden')
      document.documentElement.classList.add('storyboard-chrome-completely-hidden')
      setVisible(false)
    }
  }, [])

  function showFlowInfoDialog(name, json, error) {
    setFlowName(name)
    setFlowJson(json)
    setFlowError(error)
    setFlowDialogOpen(true)
  }

  // Stable refs for syncMobileActions
  const configRef = useRef(config)
  // eslint-disable-next-line react-hooks/refs
  configRef.current = config
  const toolComponentsRef = useRef(toolComponents)
  // eslint-disable-next-line react-hooks/refs
  toolComponentsRef.current = toolComponents
  const isMobileStateRef = useRef(isMobileState)
  // eslint-disable-next-line react-hooks/refs
  isMobileStateRef.current = isMobileState

  const syncMobileActions = useCallback(async () => {
    if (!isMobileStateRef.current) {
      if (mobileActionsRegistered.current) {
        clearDynamicActions('mobile-toolbar')
        mobileActionsRegistered.current = false
      }
      return
    }

    const actions = []
    const handlers = {}
    const toolConfigs = configRef.current.tools || {}

    actions.push({ type: 'header', label: 'Tools', id: '_mobile_header' })

    for (const [key, tool] of Object.entries(toolConfigs)) {
      if (tool.surface !== 'command-toolbar') continue
      if (tool.render === 'separator') continue
      if (!tool.prod && !isLocalDev) continue
      if (getToolbarToolState(key) === 'disabled') continue
      if (isExcludedByRoute(tool)) continue

      const mobileId = `mobile:${key}`
      const desktopActionId = tool.handler || `core:${key}`

      if (tool.render === 'menu' && hasChildrenProvider(desktopActionId)) {
        actions.push({
          id: mobileId,
          label: tool.label || tool.ariaLabel,
          type: 'submenu',
          modes: tool.modes || ['*'],
          excludeRoutes: tool.excludeRoutes,
          toolKey: key,
          localOnly: !tool.prod,
        })
        handlers[mobileId] = {
          getChildren: () => getActionChildren(desktopActionId),
        }
      } else if (tool.render === 'sidepanel') {
        actions.push({
          id: mobileId,
          label: tool.ariaLabel || tool.label || key,
          type: 'default',
          modes: tool.modes || ['*'],
          excludeRoutes: tool.excludeRoutes,
          toolKey: key,
          localOnly: !tool.prod,
        })
        handlers[mobileId] = () => { togglePanel(tool.sidepanel) }
      } else if (tool.render === 'knobs-panel') {
        actions.push({
          id: mobileId,
          label: tool.ariaLabel || tool.label || key,
          type: 'default',
          modes: tool.modes || ['*'],
          excludeRoutes: tool.excludeRoutes,
          toolKey: key,
          localOnly: !tool.prod,
        })
        handlers[mobileId] = { execute: () => toggleKnobsPanel() }
      } else if (tool.render === 'button' && toolComponentsRef.current[key]) {
        try {
          if (key === 'comments') {
            
            
            actions.push({
              id: mobileId,
              label: tool.ariaLabel || 'Comments',
              type: 'toggle',
              modes: tool.modes || ['*'],
              excludeRoutes: tool.excludeRoutes,
              toolKey: key,
              localOnly: !tool.prod,
            })
            handlers[mobileId] = {
              execute: async () => {
                if (!isAuthenticated()) {
                  const user = await openAuthModal()
                  if (!user) return
                }
                toggleCommentMode()
              },
              getState: () => isCommentModeActive(),
            }
          }
        } catch { /* comments module not available */ }
      }
    }

    // Theme tool — special handling
    if (toolConfigs.theme && toolComponentsRef.current.theme) {
      if (!actions.some((a) => a.id === 'mobile:theme')) {
        try {
          actions.push({
            id: 'mobile:theme',
            label: 'Theme',
            type: 'submenu',
            modes: ['*'],
            toolKey: 'theme',
            localOnly: !toolConfigs.theme.prod,
          })
          handlers['mobile:theme'] = {
            getChildren: () => {
              const current = getTheme()
              const themes = (getConfig('theming') || {}).themes || {}
              return Object.entries(themes).map(([id, def]) => ({
                id: `theme:${id}`,
                label: def?.label || id,
                type: 'toggle',
                active: current === id,
                execute: () => setTheme(id),
              }))
            },
          }
        } catch { /* theme store not available */ }
      }
    }

    setDynamicActions('mobile-toolbar', actions, handlers)
    mobileActionsRegistered.current = true
  }, [])

  // Canvas event handlers
  const handleCanvasMounted = useCallback((e) => {
    setCanvasActive(true)
    const detail = e.detail
    setActiveCanvasId(detail?.canvasId || detail?.name || '')
    setCanvasZoom(detail?.zoom ?? 100)
    syncMobileActions()
  }, [syncMobileActions])

  const handleCanvasUnmounted = useCallback(() => {
    setCanvasActive(false)
    setActiveCanvasId('')
    setCanvasZoom(100)
    syncMobileActions()
  }, [syncMobileActions])

  const handleZoomChanged = useCallback((e) => {
    setCanvasActive(true)
    setCanvasZoom(e.detail?.zoom ?? 100)
  }, [])

  // Main mount effect
  useEffect(() => {
    let mounted = true

    setRoutingBasePath(basePath)

    // Sync visible + completelyHidden state when classes are toggled externally
    const chromeObserver = new MutationObserver(() => {
      const hidden = document.documentElement.classList.contains('storyboard-chrome-hidden')
      const fully = document.documentElement.classList.contains('storyboard-chrome-completely-hidden')
      setVisible((v) => {
        if (v === !hidden) return v
        return !hidden
      })
      setCompletelyHidden(fully)
    })
    chromeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    ;(async () => {
      if (!mounted) return

      function syncPrototypeToolbar() {
        let pathname = window.location.pathname
        const base = basePath.replace(/\/+$/, '')
        if (base && pathname.startsWith(base)) pathname = pathname.slice(base.length)
        const firstSegment = pathname.replace(/^\//, '').split('/')[0] || null
        if (firstSegment) {
          const meta = getPrototypeMetadata(firstSegment)

          if (meta?.toolbarConfig) {
            setPrototypeToolbarConfig(meta.toolbarConfig)
            setOverrides('toolbar', meta.toolbarConfig)
          } else {
            clearPrototypeToolbarConfig()
            clearOverrides('toolbar')
          }

          const domainMap = [
            ['commandPaletteConfig', 'commandPalette'],
            ['widgetsConfig', 'widgets'],
            ['pasteConfig', 'paste'],
          ]
          for (const [metaKey, domain] of domainMap) {
            if (meta?.[metaKey]) {
              setOverrides(domain, meta[metaKey])
            } else {
              clearOverrides(domain)
            }
          }
        } else {
          clearPrototypeToolbarConfig()
          clearOverrides('toolbar')
          clearOverrides('commandPalette')
          clearOverrides('widgets')
          clearOverrides('paste')
        }
      }

      const bumpNav = () => {
        setNavVersion((v) => v + 1)
        syncPrototypeToolbar()
        syncMobileActions()
      }
      bumpNavRef.current = bumpNav

      window.addEventListener('popstate', bumpNav)
      origPushStateRef.current = history.pushState.bind(history)
      history.pushState = (...args) => { origPushStateRef.current(...args); bumpNav() }
      origReplaceStateRef.current = history.replaceState.bind(history)
      history.replaceState = (...args) => { origReplaceStateRef.current(...args); bumpNav() }

      syncPrototypeToolbar()

      // Seed the command action registry from config
      if (commandMenuConfig) {
        initCommandActions(commandMenuConfig)
      }

      // Register sidepanel toggle actions
      for (const menu of sidepanelMenus) {
        registerCommandAction(`core:${menu.key}`, () => {
          togglePanel(menu.sidepanel)
        })
      }

      // Load all tool modules from the registry — in parallel
      
      const toolConfigs = config.tools || {}
      const ctx = { basePath, showFlowInfoDialog }

      const loadedComponents = {}
      const loadedData = {}

      await Promise.all(Object.entries(toolConfigs).map(async ([toolId, toolConfig]) => {
        if (toolConfig.render === 'separator') return
        if (getToolbarToolState(toolId) === 'disabled') return

        const handlerRef = toolConfig.handler || `core:${toolId}`
        const loadModule = resolveHandlerModule(handlerRef, coreHandlers, customHandlers)
        if (!loadModule) return

        try {
          const mod = await loadModule()
          const toolCtx = { ...ctx, config: toolConfig }

          if (mod.guard) {
            const ok = await mod.guard(toolCtx)
            if (!ok) return
          }

          if (mod.setup) {
            const setupResult = await mod.setup(toolCtx)
            if (setupResult) {
              loadedData[toolId] = setupResult
            }
          }

          if (mod.handler) {
            const handlerResult = await mod.handler(toolCtx)
            const actionId = toolConfig.handler || `core:${toolId}`
            if (handlerResult && !handlerResult.getChildren) {
              loadedData[toolId] = { ...(loadedData[toolId] || {}), ...handlerResult }
            }
            registerCommandAction(actionId, handlerResult)
          }

          if (mod.component) {
            const component = await mod.component(toolConfig.render)
            loadedComponents[toolId] = component
          }
        } catch (err) {
          console.warn(`[CoreUIBar] Failed to load tool "${toolId}":`, err)
        }
      }))

      if (mounted) {
        setToolComponents(loadedComponents)
        setToolData(loadedData)
      }

      // Sync canvas bridge state
      if (typeof window !== 'undefined') {
        const state = window.__storyboardCanvasBridgeState
        if (state && typeof state === 'object') {
          setCanvasActive(state.active === true)
          setActiveCanvasId(state.canvasId || state.name || '')
          setCanvasZoom(typeof state.zoom === 'number' ? state.zoom : 100)
        } else {
          document.dispatchEvent(new CustomEvent('storyboard:canvas:status-request'))
        }
      }

      syncMobileActions()
    })()

    // Subscribe to mobile viewport changes
    const unsubMobile = subscribeToMobile((mobile) => {
      setIsMobileState(mobile)
      // syncMobileActions will be called by the isMobileState change
    })

    return () => {
      mounted = false
      if (bumpNavRef.current) window.removeEventListener('popstate', bumpNavRef.current)
      if (origPushStateRef.current) history.pushState = origPushStateRef.current
      if (origReplaceStateRef.current) history.replaceState = origReplaceStateRef.current
      unsubMobile()
      clearDynamicActions('mobile-toolbar')
      chromeObserver.disconnect()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Canvas event listeners
  useEffect(() => {
    document.addEventListener('storyboard:canvas:mounted', handleCanvasMounted)
    document.addEventListener('storyboard:canvas:unmounted', handleCanvasUnmounted)
    document.addEventListener('storyboard:canvas:zoom-changed', handleZoomChanged)
    document.addEventListener('storyboard:canvas:status', handleCanvasMounted)
    return () => {
      document.removeEventListener('storyboard:canvas:mounted', handleCanvasMounted)
      document.removeEventListener('storyboard:canvas:unmounted', handleCanvasUnmounted)
      document.removeEventListener('storyboard:canvas:zoom-changed', handleZoomChanged)
      document.removeEventListener('storyboard:canvas:status', handleCanvasMounted)
    }
  }, [handleCanvasMounted, handleCanvasUnmounted, handleZoomChanged])

  // Sync mobile actions when isMobileState changes
  useEffect(() => {
    syncMobileActions()
  }, [isMobileState, syncMobileActions])

  // Keyboard shortcut handler
  useEffect(() => {
    function handleKeydown(e) {
      // Customer mode with hideChrome: lock toolbars hidden — ignore Cmd+. toggle.
      if (document.documentElement.classList.contains('storyboard-customer-hide-chrome')) {
        return
      }
      const hideKey = shortcutsConfig.hideChrome?.key || '.'

      if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
        // Alt+Cmd+. — completely hide (use e.code since alt changes e.key on macOS)
        if (e.altKey && e.code === 'Period') {
          e.preventDefault()
          toggleCompletelyHidden()
          return
        }
        // Cmd+. — regular hide/show
        if (!e.altKey && e.key === hideKey) {
          e.preventDefault()
          toggleToolsVisibility()
          return
        }
      }

      for (const menu of cleanedMenus) {
        const shortcut = menu.shortcut
        if (!shortcut?.key) continue
        if (shortcutMatches(e, shortcut)) {
          const toolState = getToolbarToolState(menu.key)
          if (toolState === 'inactive' || toolState === 'disabled') break
          if (menu.sidepanel) {
            e.preventDefault()
            togglePanel(menu.sidepanel)
          } else if (menu.render === 'knobs-panel') {
            e.preventDefault()
            const execute = toolData[menu.key]?.execute || toggleKnobsPanel
            execute()
          }
          break
        }
      }

      // Cmd+Opt+Ctrl+F — prototype fullscreen (immersive mode)
      // Use e.code since alt/opt changes e.key on macOS (e.g. 'f' → 'ƒ')
      if (e.metaKey && e.altKey && e.ctrlKey && e.code === 'KeyF') {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent('storyboard:canvas:prototype-fullscreen'))
        return
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [shortcutsConfig, cleanedMenus, toolData, toggleToolsVisibility, toggleCompletelyHidden])

  if (isEmbed) return null

  return (
    <>
      <KnobsPanel basePath={basePath} navigationVersion={navVersion} />
      {/* Collab bar (top-right, canvas only) */}
      {canvasActive && visible && !completelyHidden && collabBarMenus.length > 0 && (
        <ChromeSlot id="toolbar:collab" surface="collab-bar">
          <div
            className="fixed z-[9999] font-sans flex items-center gap-3"
            data-collab-bar
            role="toolbar"
            aria-label="Collab bar"
          >
            {collabBarMenus.map((collabTool) => {
              const CollabToolComponent = toolComponents[collabTool.key]
              if (!CollabToolComponent) return null
              return (
                <Tooltip.Root key={collabTool.key}>
                  <Tooltip.Trigger>
                    <ChromeSlot id={`tool:${collabTool.key}`} surface="collab-bar" ctx={{ toolKey: collabTool.key }}>
                      <span data-tool-id={collabTool.key} data-local-only={isToolbarToolLocalOnly(collabTool.key) || undefined}>
                        <CollabToolComponent
                          config={collabTool}
                          data={toolData[collabTool.key]}
                          canvasName={activeCanvasId}
                          tabIndex={0}
                        />
                      </span>
                    </ChromeSlot>
                  </Tooltip.Trigger>
                  <Tooltip.Content side="bottom">{collabTool.ariaLabel || collabTool.key}</Tooltip.Content>
                </Tooltip.Root>
              )
            })}
          </div>
        </ChromeSlot>
      )}

      {/* Canvas toolbar */}
      {canvasActive && visible && !completelyHidden && canvasMenus.length > 0 && (
        <ChromeSlot id="toolbar:canvas" surface="canvas-toolbar">
          <div
            className="fixed bottom-6 left-6 z-[9999] font-sans flex items-center gap-3"
            role="toolbar"
            aria-label="Canvas toolbar"
          >
            {canvasMenus.map((canvasTool) => {
              const CanvasToolComponent = toolComponents[canvasTool.key]
              if (!CanvasToolComponent) return null
              if (canvasTool.render === 'menu') {
                return (
                  <Tooltip.Root key={canvasTool.key}>
                    <Tooltip.Trigger>
                      <ChromeSlot id={`tool:${canvasTool.key}`} surface="canvas-toolbar" ctx={{ toolKey: canvasTool.key, canvasId: activeCanvasId }}>
                        <span data-tool-id={canvasTool.key} data-local-only={isToolbarToolLocalOnly(canvasTool.key) || undefined}>
                          <CanvasToolComponent
                            config={canvasTool}
                            data={toolData[canvasTool.key]}
                            canvasName={activeCanvasId}
                            zoom={canvasZoom}
                            tabIndex={0}
                          />
                        </span>
                      </ChromeSlot>
                    </Tooltip.Trigger>
                    <Tooltip.Content side="top">{canvasTool.ariaLabel || canvasTool.key}</Tooltip.Content>
                  </Tooltip.Root>
                )
              }
              return (
                <ChromeSlot key={canvasTool.key} id={`tool:${canvasTool.key}`} surface="canvas-toolbar" ctx={{ toolKey: canvasTool.key, canvasId: activeCanvasId }}>
                  <span data-tool-id={canvasTool.key} style={{ display: 'contents' }}>
                    <CanvasToolComponent
                      config={canvasTool}
                      data={toolData[canvasTool.key]}
                      canvasName={activeCanvasId}
                      zoom={canvasZoom}
                      tabIndex={0}
                    />
                  </span>
                </ChromeSlot>
              )
            })}
          </div>
        </ChromeSlot>
      )}

      {/* Main toolbar */}
      <ChromeSlot id="toolbar:main" surface="command-toolbar">
        <div
          id="storyboard-controls"
          className="fixed bottom-6 right-6 z-[9999] font-sans flex items-end gap-3"
          data-core-ui-bar=""
          data-sb-surface="toolbar"
          role="toolbar"
          tabIndex={0}
          aria-label="Storyboard controls"
          onKeyDown={handleToolbarKeydown}
          ref={toolbarEl}
        >
          {/* Always-visible tools (left) */}
          {cleanedMenus.map((menu, i) => {
            if (!menu.alwaysVisible || !toolComponents[menu.key]) return null
            const ToolComponent = toolComponents[menu.key]
            return (
              <Tooltip.Root key={menu.key}>
                <Tooltip.Trigger>
                  <ChromeSlot id={`tool:${menu.key}`} surface="command-toolbar" ctx={{ toolKey: menu.key }}>
                    <span data-tool-id={menu.key} style={{ display: 'contents' }}>
                      <ToolComponent
                        config={menu}
                        data={toolData[menu.key]}
                        tabIndex={getTabindex(i)}
                        localOnly={isToolbarToolLocalOnly(menu.key)}
                        basePath={basePath}
                      />
                    </span>
                  </ChromeSlot>
                </Tooltip.Trigger>
                <Tooltip.Content side="top">
                  {menu.ariaLabel || menu.key}{menu.shortcut?.label ? ` · ${menu.shortcut.label}` : ''}
                </Tooltip.Content>
              </Tooltip.Root>
            )
          })}

          {visible && !isMobileState && cleanedMenus.map((menu, i) => {
            if (menu.alwaysVisible) return null
            if (menu.render === 'separator') {
              return <div key={menu.key} className="toolbar-separator" aria-hidden="true" data-sb-chrome={`tool:${menu.key}`} />
            }
            const toolState = getToolbarToolState(menu.key)
            return (
              <Tooltip.Root key={menu.key}>
                <Tooltip.Trigger>
                  {menu.render === 'sidepanel' ? (
                    <ChromeSlot id={`tool:${menu.key}`} surface="command-toolbar" ctx={{ toolKey: menu.key }}>
                      <span data-tool-id={menu.key} style={{ display: 'contents' }}>
                        <TriggerButton
                          active={currentSidePanelState.open && currentSidePanelState.activeTab === menu.sidepanel}
                          inactive={toolState === 'inactive'}
                          dimmed={toolState === 'dimmed'}
                          localOnly={isToolbarToolLocalOnly(menu.key)}
                          size="icon-xl"
                          aria-label={menu.ariaLabel || menu.key}
                          tabIndex={getTabindex(i)}
                          onFocus={() => setActiveToolbarIndex(i)}
                          onClick={() => togglePanel(menu.sidepanel)}
                        >
                          <Icon name={menu.icon || menu.key} size={16} {...(menu.meta || {})} />
                        </TriggerButton>
                      </span>
                    </ChromeSlot>
                  ) : menu.render === 'knobs-panel' ? (
                    <ChromeSlot id={`tool:${menu.key}`} surface="command-toolbar" ctx={{ toolKey: menu.key }}>
                      <span
                        data-tool-id={menu.key}
                        data-tool-state={toolState}
                        data-local-only={isToolbarToolLocalOnly(menu.key) || undefined}
                        className={toolState === 'inactive' ? 'tool-inactive' : toolState === 'dimmed' ? 'tool-dimmed' : ''}
                      >
                        <KnobsPanelToolbarButton
                          config={menu}
                          data={toolData[menu.key]}
                          tabIndex={getTabindex(i)}
                          localOnly={isToolbarToolLocalOnly(menu.key)}
                        />
                      </span>
                    </ChromeSlot>
                  ) : toolComponents[menu.key] ? (() => {
                    const ToolComponent = toolComponents[menu.key]
                    return (
                      <ChromeSlot id={`tool:${menu.key}`} surface="command-toolbar" ctx={{ toolKey: menu.key }}>
                        <span
                          data-tool-id={menu.key}
                          data-tool-state={toolState}
                          data-local-only={isToolbarToolLocalOnly(menu.key) || undefined}
                          className={toolState === 'inactive' ? 'tool-inactive' : toolState === 'dimmed' ? 'tool-dimmed' : ''}
                        >
                          <ToolComponent
                            config={menu}
                            data={toolData[menu.key]}
                            tabIndex={getTabindex(i)}
                            localOnly={isToolbarToolLocalOnly(menu.key)}
                            basePath={basePath}
                          />
                        </span>
                      </ChromeSlot>
                    )
                  })() : null}
                </Tooltip.Trigger>
                <Tooltip.Content side="top">
                  {menu.ariaLabel || menu.key}{menu.shortcut?.label ? ` · ${menu.shortcut.label}` : ''}
                </Tooltip.Content>
              </Tooltip.Root>
            )
          })}

        </div>
      </ChromeSlot>

      {/* Side panel */}
      {(sidepanelMenus.length > 0 || currentSidePanelState.open) && (
        <SidePanelComponent
          basePath={basePath}
          onClose={() => focusToolbarItem(activeToolbarIndex < 0 ? toolbarItemCount - 1 : activeToolbarIndex)}
        />
      )}

      {/* PWA install banner */}
      <PwaInstallBanner />

      {/* Flow info panel */}
      <Panel.Root open={flowDialogOpen} onOpenChange={setFlowDialogOpen}>
        <Panel.Content>
          <Panel.Header>
            <Panel.Title>Flow: {flowName}</Panel.Title>
            <Panel.Close />
          </Panel.Header>
          <Panel.Body>
            {flowError ? (
              <span className="text-destructive text-sm">{flowError}</span>
            ) : (
              <pre className="m-0 bg-transparent text-sm font-mono leading-relaxed whitespace-pre-wrap break-words">{flowJson}</pre>
            )}
          </Panel.Body>
        </Panel.Content>
      </Panel.Root>
    </>
  )
}
