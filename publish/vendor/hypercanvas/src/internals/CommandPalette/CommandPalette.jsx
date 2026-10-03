import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Command } from 'cmdk'
import Icon from '../Icon.jsx'
import {
  buildPrototypeIndex,
  listStories,
  getStoryData,
  getActionsForMode,
  executeAction,
  getActionChildren,
  getToolbarToolState,
  getCurrentMode,
  getRecent,
  trackRecent,
  getCommandPaletteConfig,
  getToolbarConfig,
  getConfig,
  setTheme,
  getTheme,
  isExcludedByRoute,
  scoreMatch,
} from '../../core/index.js'
import { widgetTypes, isWidgetFlagEnabled } from '../canvas/widgets/widgetConfig.js'
import CreateDialog from './CreateDialog.jsx'
import { isTauriAvailable } from '../../core/notebook/tauri-bridge.js'
import { coreRequestJson, isBrowserCoreMode, openNotebookSidebar } from '../../core/notebook/browserBridge.js'
import WidgetArtifactDialog from './WidgetArtifactDialog.jsx'

// Widget types that need artifact selection BEFORE creation (via dialog).
const WIDGET_TYPES_WITH_PICKER = new Set(['prototype', 'story', 'component-set'])
import BranchBar from '../BranchBar/BranchBar.jsx'
import AuthModal from '../AuthModal/AuthModal.jsx'
import './command-palette.css'

// Icon size for all palette items
const ICON_SIZE = 16

function getProdDomain() {
  try {
    const cfg = getConfig() || {}
    return (cfg.prodDomain || '').trim()
  } catch {
    return ''
  }
}

function getCurrentBranchName() {
  if (typeof window === 'undefined') return null
  if (typeof window.__SB_CURRENT_BRANCH__ === 'string' && window.__SB_CURRENT_BRANCH__) {
    return window.__SB_CURRENT_BRANCH__
  }
  // Fallback: parse /branch--<name>/ out of BASE_URL for prod static deploys.
  const base = (window.__STORYBOARD_BASE_PATH__ || '').toString()
  const m = base.match(/\/branch--([^/]+)\/?$/)
  return m ? m[1] : null
}

function openDeployedBranch() {
  if (typeof window === 'undefined') return
  const raw = getProdDomain()
  if (!raw) return
  // prodDomain may be "host" or "host/base/path/" — split on first slash.
  const stripped = raw.replace(/^https?:\/\//i, '').replace(/^\/+/, '')
  const slashIdx = stripped.indexOf('/')
  const host = slashIdx === -1 ? stripped : stripped.slice(0, slashIdx)
  const basePath = slashIdx === -1 ? '' : '/' + stripped.slice(slashIdx + 1).replace(/\/+$/, '')
  if (!host) return
  try {
    const url = new URL(window.location.href)
    url.protocol = 'https:'
    url.host = host
    url.port = ''

    // Strip any /branch--<x>/ prefix already present in the dev pathname
    // (paranoia — current dev URLs don't have one) before appending the
    // current-branch segment for prod.
    let pathname = url.pathname.replace(/^\/branch--[^/]+/, '')

    const branch = getCurrentBranchName()
    const branchSegment = branch && branch !== 'main' ? `/branch--${branch}` : ''

    url.pathname = basePath + branchSegment + pathname
    window.open(url.toString(), '_blank', 'noopener,noreferrer')
  } catch {
    // ignore malformed URLs
  }
}

function getIconMap() {
  const config = getCommandPaletteConfig()
  return config?.icons || {}
}

function ItemIcon({ type, toolIcon, toolMeta }) {
  const icons = getIconMap()
  const entry = toolIcon || icons[type] || icons.fallback || 'feather/hexagon'
  const iconName = typeof entry === 'object' ? entry.name : entry
  const meta = toolMeta || (typeof entry === 'object' ? entry.meta : undefined)
  return <Icon name={iconName} size={ICON_SIZE} color="var(--color-foreground-muted, #656d76)" {...(meta || {})} />
}

function AvatarIcon({ username }) {
  return (
    <img
      src={`https://github.com/${username}.png?size=32`}
      alt={username}
      width={ICON_SIZE}
      height={ICON_SIZE}
      style={{ flexShrink: 0, borderRadius: '50%' }}
    />
  )
}

/**
 * Alt-reactive label for the "Hide toolbars" command palette item.
 * Shows "Completely hide toolbars" when alt is held, "Hide toolbars" otherwise.
 */
function HideToolbarsLabel({ isHidden }) {
  const [altHeld, setAltHeld] = useState(false)
  useEffect(() => {
    const onKey = (e) => setAltHeld(e.altKey)
    const onUp = () => setAltHeld(false)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('keyup', onUp, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('keyup', onUp, true)
    }
  }, [])

  return (
    <span style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
      <span>{altHeld ? 'Completely hide toolbars' : 'Hide toolbars'}</span>
      <span>{isHidden ? '✓' : ''}</span>
    </span>
  )
}

/**
 * Check if a tool should be hidden from the command palette on the current route.
 * Uses the same pattern-matching logic as excludeRoutes.
 */
function isHiddenInPalette(tool, basePath) {
  const val = tool.hideInCommandPalette
  if (val === true) return true
  if (!val || !Array.isArray(val) || val.length === 0) return false
  if (typeof window === 'undefined') return false
  let pathname = window.location.pathname
  const base = (basePath || '/').replace(/\/+$/, '')
  if (base && pathname.startsWith(base)) {
    pathname = pathname.slice(base.length) || '/'
  }
  return val.some(pattern => new RegExp(pattern).test(pathname))
}

/**
 * Build groups from commandPalette.sections config.
 * Returns { groups, toolMenus } where toolMenus are entries with sub-pages.
 *
 * Section types:
 *   - Static items:  { items: [...] }
 *   - Dynamic list:  { source: "canvases"|"prototypes"|"stories"|"recent" }
 *   - Tool section:  { source: "tools", toolIds: ["theme", "flows"] }
 *   - Tool-menu:     { type: "tool-menu", options: [...] }
 */
function buildConfigSections(prefix, onNavigateToPage, onCreateAction) {
  const config = getCommandPaletteConfig()
  const sections = config?.sections || []
  const groups = []
  const toolMenus = []
  const usedToolIds = new Set()
  const hiddenFromSearchIds = new Set()
  const basePath = prefix || '/'

  for (const section of sections) {
    // Separator: id starts with "sep"
    if (section.id?.startsWith('sep')) {
      groups.push({ id: `cfg:${section.id}`, items: [{ id: `cfg:${section.id}:sep`, children: '', keywords: ['*'] }] })
      continue
    }

    if (section.type === 'tool-menu') {
      toolMenus.push(section)
      continue
    }

    if (section.source) {
      // Defer tool-subpages — needs usedToolIds from all other sections first
      if (section.source === 'tool-subpages') continue
      const result = buildDynamicSection(section, prefix, onNavigateToPage, onCreateAction)
      if (result?.group) groups.push(result.group)
      if (result?.subPages) toolMenus.push(...result.subPages)
      if (result?.usedToolIds) result.usedToolIds.forEach(id => usedToolIds.add(id))
      if (result?.hiddenFromSearchIds) result.hiddenFromSearchIds.forEach(id => hiddenFromSearchIds.add(id))
      continue
    }

    if (section.items && section.items.length > 0) {
      groups.push({
        heading: section.title,
        id: `cfg:${section.id}`,
        items: section.items.map((item, i) => {
          const id = `cfg:${section.id}:${i}`
          if (item.type === 'link') {
            const resolvedUrl = item.url?.startsWith('/') ? prefix + item.url : item.url
            return {
              id,
              children: item.label,
              keywords: item.keywords || [item.label],
              url: resolvedUrl,
              onClick: () => {
                if (resolvedUrl) window.location.href = resolvedUrl
              },
            }
          }
          if (item.type === 'action') {
            return {
              id,
              children: item.label,
              keywords: item.keywords || [item.label],
              onClick: () => { if (item.action) executeAction(item.action) },
            }
          }
          return { id, children: item.label, keywords: [item.label] }
        }),
      })
    }
  }

  // Resolve tool-subpages sections (deferred — needs complete usedToolIds)
  for (const section of sections) {
    if (section.source !== 'tool-subpages') continue
    
    // Scan all toolbar tools for sub-page candidates not already listed
    const toolbarConfig = getToolbarConfig()
    const allTools = toolbarConfig?.tools || {}
    const mode = getCurrentMode() || 'default'
    const actions = getActionsForMode(mode)
    const remainingItems = []

    for (const [toolId, tool] of Object.entries(allTools)) {
      if (usedToolIds.has(toolId)) continue
      const state = getToolbarToolState(toolId)
      if (state === 'disabled' || state === 'hidden') continue
      if (tool.disabled) continue
      if (isHiddenInPalette(tool, basePath)) continue

      const label = tool.label || tool.ariaLabel || toolId
      const excluded = isExcludedByRoute(tool)

      // Route-excluded tools show as disabled with hint
      if (excluded) {
        remainingItems.push({
          id: `cfg:${section.id}:${toolId}`,
          children: <><span>{label}</span><span style={{ marginLeft: 'auto', fontSize: '12px', opacity: 0.5 }}>Not available on this page</span></>,
          keywords: [label, toolId].filter(Boolean),
          showType: false,
          disabled: true,
        })
        continue
      }

      // Tools with submenu children
      if (tool.render === 'submenu' || tool.render === 'menu') {
        const action = actions.find(a => a.toolKey === toolId)
        if (action?.type === 'submenu') {
          const children = getActionChildren(action.id)
          if (children.length > 0) {
            const pageId = `tool:${toolId}`
            toolMenus.push({
              id: pageId, label, title: label,
              keywords: [label, toolId].filter(Boolean),
              options: children.map(child => ({
                label: child.label,
                execute: child.execute,
                type: child.type,
                active: child.active,
                icon: child.icon,
              })),
            })
            remainingItems.push({
              id: `cfg:${section.id}:${toolId}`,
              children: label,
              keywords: [label, toolId].filter(Boolean),
              showType: false,
              onClick: () => onNavigateToPage?.(pageId),
              closeOnSelect: false,
            })
            continue
          }
        }
        // Declarative options
        if (tool.options?.length > 0) {
          const pageId = `tool:${toolId}`
          toolMenus.push({
            id: pageId, label, title: label,
            keywords: [label, toolId].filter(Boolean),
            options: tool.options.map(opt => ({ label: opt.label, toolHandler: tool.handler || `core:${toolId}`, value: opt.value })),
          })
          remainingItems.push({
            id: `cfg:${section.id}:${toolId}`,
            children: label,
            keywords: [label, toolId].filter(Boolean),
            showType: false,
            onClick: () => onNavigateToPage?.(pageId),
            closeOnSelect: false,
          })
          continue
        }
      }

      // Inline actions (e.g. toggle-chrome for hide toolbars)
      if (tool.inlineAction === 'toggle-chrome') {
        remainingItems.push({
          id: `cfg:${section.id}:${toolId}`,
          children: label,
          keywords: [label, toolId, 'hide', 'show', 'toolbar', 'completely'].filter(Boolean),
          showType: false,
          onClick: () => {
            document.documentElement.classList.remove('storyboard-chrome-completely-hidden')
            document.documentElement.classList.toggle('storyboard-chrome-hidden')
          },
          onAltClick: () => {
            document.documentElement.classList.add('storyboard-chrome-hidden')
            document.documentElement.classList.add('storyboard-chrome-completely-hidden')
          },
        })
        continue
      }

      if (tool.inlineAction === 'open-palette') {
        // Skip — no point opening the palette from within itself
        continue
      }

      if (tool.inlineAction === 'open-deployed-branch') {
        if (!getProdDomain()) continue
        remainingItems.push({
          id: `cfg:${section.id}:${toolId}`,
          children: label,
          keywords: [label, toolId, 'deployed', 'branch', 'production', 'preview'].filter(Boolean),
          showType: false,
          onClick: () => openDeployedBranch(),
        })
        continue
      }

      // Any remaining tools (all surfaces)
      if (tool.render === 'link' && tool.url) {
        const resolvedUrl = tool.url.startsWith('/') ? prefix + tool.url : tool.url
        remainingItems.push({
          id: `cfg:${section.id}:${toolId}`,
          children: label,
          keywords: [label, toolId].filter(Boolean),
          showType: false,
          url: resolvedUrl,
          onClick: () => { window.location.href = resolvedUrl },
        })
      } else {
        // Menu tools: close palette and dispatch event to open the toolbar menu
        if (tool.render === 'menu') {
          const handlerId = tool.handler || `core:${toolId}`
          remainingItems.push({
            id: `cfg:${section.id}:${toolId}`,
            children: label,
            keywords: [label, toolId].filter(Boolean),
            showType: false,
            onClick: () => {
              setTimeout(() => {
                window.dispatchEvent(new CustomEvent('storyboard:open-tool-menu', { detail: { action: handlerId } }))
              }, 100)
            },
          })
        } else {
          // Fallback: click toolbar button or execute action
          const action = actions.find(a => a.toolKey === toolId)
          const ariaLabel = tool.ariaLabel || tool.label || toolId
          remainingItems.push({
            id: `cfg:${section.id}:${toolId}`,
            children: label,
            keywords: [label, toolId].filter(Boolean),
            showType: false,
            onClick: action
              ? () => executeAction(action.id)
              : () => {
                  setTimeout(() => {
                    const btn = document.querySelector(`[aria-label="${ariaLabel}"]`)
                    if (btn) btn.click()
                  }, 100)
                },
          })
        }
      }
    }

    // Also include any tool sub-pages not yet listed (skip non-tool sub-pages like create-widget)
    for (const menu of toolMenus) {
      if (!menu.id?.startsWith('tool:')) continue
      const menuToolId = menu.id.replace('tool:', '')
      if (usedToolIds.has(menuToolId)) continue
      if (remainingItems.some(i => i.id === `cfg:${section.id}:${menuToolId}`)) continue
      remainingItems.push({
        id: `cfg:${section.id}:${menuToolId || menu.id}`,
        children: menu.label || menu.id,
        keywords: menu.keywords || [menu.label || menu.id],
        showType: false,
        onClick: () => onNavigateToPage?.(menu.id),
        closeOnSelect: false,
      })
    }

    if (remainingItems.length === 0) continue

    // Stamp toolIcon from toolbar config onto remaining items
    for (const item of remainingItems) {
      if (!item.toolIcon) {
        const match = item.id?.match(/cfg:[^:]+:(.+)/)
        if (match) {
          const t = allTools[match[1]]
          if (t?.icon) item.toolIcon = t.icon
        }
      }
    }

    groups.push({
      heading: section.title,
      id: `cfg:${section.id}`,
      items: remainingItems,
    })
  }

  return { groups, toolMenus, hiddenFromSearchIds }
}

function buildDynamicSection(section, prefix, onNavigateToPage, onCreateAction) {
  if (section.source === 'tools') {
    return buildToolsSection(section, prefix, onNavigateToPage)
  }

  // --- Create source (dev-only workshop actions) ---
  if (section.source === 'create') {
    const isLocalDev = typeof window !== 'undefined' && window.__SB_LOCAL_DEV__ === true
    if (!isBrowserCoreMode() && (!isLocalDev || !isTauriAvailable())) return null
    // Same workshop.features.create<X> flags that control the workspace
    // Create-Artifact menu. Default true; set to false in
    // storyboard.config.json to hide that artifact type here too.
    const features = getConfig('workshop')?.features || {}
    const isEnabled = (flag) => features[flag] !== false
    const createItems = [
      { id: 'create:canvas',    children: 'Canvas',    keywords: ['create', 'canvas',    'new', 'board'], itemType: 'create', flag: 'createCanvas',    onClick: () => onCreateAction?.('Canvas') },
      { id: 'create:prototype', children: 'Prototype', keywords: ['create', 'prototype', 'new', 'page'],  itemType: 'create', flag: 'createPrototype', onClick: () => onCreateAction?.('Prototype') },
      { id: 'create:site', children: 'Site', keywords: ['create', 'site', 'new', 'project'], itemType: 'create', flag: 'createSite', onClick: () => onCreateAction?.('Site') },
    ].filter(it => isEnabled(it.flag))
    if (createItems.length === 0) return null
    return { group: { heading: section.title, id: `cfg:${section.id}`, items: createItems } }
  }

  // --- Create widget source (all canvas widget types) ---
  if (section.source === 'create-widget') {
    const isLocalDev = typeof window !== 'undefined' && window.__SB_LOCAL_DEV__ === true
    if (!isLocalDev && !isBrowserCoreMode()) return null
    const isCanvasRoute = typeof window !== 'undefined' && window.location.pathname.includes('/canvas/')
    if (!isCanvasRoute) return null
    // 'story' is shown as "Component" — the StoryPicker auto-upgrades
    // multi-export stories to a component-set widget, so we expose a single
    // unified "Component" entry instead of separate Story / Component Set items.
    // The deprecated 'component' widget type and the raw 'component-set' entry
    // are both hidden in favor of this consolidated flow.
    const hiddenTypes = new Set(['link-preview', 'image', 'figma-embed', 'codepen-embed', 'component', 'component-set', 'terminal-read', 'agent'])
    const labelOverrides = { story: 'Component', file: 'File…' }
    const items = Object.entries(widgetTypes)
      .filter(([type]) => !hiddenTypes.has(type) && isWidgetFlagEnabled(type))
      .map(([type, def]) => {
      const label = labelOverrides[type] || def.label
      return {
        id: `create-widget:${type}`,
        children: label,
        index_tags: [`Add ${label}`],
        keywords: ['add', 'widget', 'create', type, label.toLowerCase(), def.label.toLowerCase()],
        itemType: type === 'story' ? 'component' : type,
        onClick: () => {
          if (type === 'file') {
            // File widget needs the file picker, not a blank create.
            document.dispatchEvent(new CustomEvent('storyboard:canvas:open-file-picker', { detail: {} }))
          } else if (WIDGET_TYPES_WITH_PICKER.has(type)) {
            // Open the artifact picker dialog instead of creating an empty widget.
            document.dispatchEvent(new CustomEvent('storyboard:open-widget-artifact-dialog', { detail: { type } }))
          } else {
            document.dispatchEvent(new CustomEvent('storyboard:canvas:add-widget', { detail: { type } }))
          }
        },
      }
    })

    // Build agent submenu from canvas.agents config
    const subPages = []
    const canvasConfig = getConfig('canvas')
    const agentsConfig = canvasConfig?.agents
    if (agentsConfig && typeof agentsConfig === 'object') {
      const agentEntries = Object.entries(agentsConfig)
      if (agentEntries.length > 0) {
        const pageId = 'create-widget:agents'
        subPages.push({
          id: pageId,
          label: 'Add agent to canvas',
          title: 'Add agent to canvas',
          keywords: ['agent', 'add', 'widget', 'copilot', 'claude', 'codex', 'opencode'],
          options: agentEntries.map(([id, cfg]) => ({
            label: cfg.label || id,
            icon: cfg.icon,
            execute: () => {
              document.dispatchEvent(new CustomEvent('storyboard:canvas:add-widget', {
                detail: {
                  type: 'agent',
                  props: {
                    agentId: id,
                    startupCommand: cfg.startupCommand || id,
                    ...(cfg.defaultWidth ? { width: cfg.defaultWidth } : {}),
                    ...(cfg.defaultHeight ? { height: cfg.defaultHeight } : {}),
                  },
                },
              }))
            },
          })),
        })
        items.push({
          id: 'create-widget:agent',
          children: 'Agent',
          index_tags: ['Add Agent'],
          keywords: ['add', 'widget', 'create', 'agent'],
          itemType: 'agent',
          hideFromSearch: true,
          onClick: () => onNavigateToPage?.(pageId),
          closeOnSelect: false,
        })
      }
    }

    return { group: { heading: section.title, id: `cfg:${section.id}`, items }, subPages }
  }

  // --- Starred source (reads from viewfinder localStorage) ---
  if (section.source === 'starred') {
    const STARRED_KEY = 'sb-workspace-starred'
    let starredIds = []
    try { starredIds = JSON.parse(localStorage.getItem(STARRED_KEY)) || [] } catch { /* empty */ }
    if (starredIds.length === 0) return null

    const index = buildPrototypeIndex()
    // Build a lookup map of all artifacts
    const artifactMap = new Map()
    const allProtos = [...index.prototypes]
    for (const folder of index.folders) {
      allProtos.push(...folder.prototypes)
      if (folder.canvases) folder.canvases.forEach(c => artifactMap.set(`canvas:${c.dirName}`, { ...c, _type: 'canvas' }))
    }
    for (const c of index.canvases) artifactMap.set(`canvas:${c.dirName}`, { ...c, _type: 'canvas' })
    for (const p of allProtos) artifactMap.set(`proto:${p.dirName}`, { ...p, _type: 'prototype' })

    const items = []
    for (const id of starredIds) {
      const artifact = artifactMap.get(id)
      if (!artifact) continue
      const route = artifact._type === 'canvas'
        ? `${prefix}/canvas/${artifact.dirName}`
        : artifact.isExternal
          ? artifact.externalUrl
          : `${prefix}/${artifact.dirName}`
      items.push({
        id: `starred:${id}`,
        children: artifact.name,
        keywords: ['starred', 'star', artifact.name.toLowerCase()],
        itemType: artifact._type === 'canvas' ? 'canvas' : 'prototype',
        url: route,
        onClick: () => {
          if (artifact.isExternal) {
            window.open(route, '_blank')
          } else {
            window.location.href = route
          }
        },
      })
    }
    if (items.length === 0) return null
    return { group: { heading: section.title, id: `cfg:${section.id}`, items } }
  }

  // --- Commands source (all registered toolbar actions) ---
  if (section.source === 'commands') {
    const mode = getCurrentMode() || 'default'
    const actions = getActionsForMode(mode)
    const commandItems = []
    for (const action of actions) {
      if (action.type === 'header' || action.type === 'separator' || action.type === 'footer') continue
      if (action.toolKey) {
        const state = getToolbarToolState(action.toolKey)
        if (state === 'disabled' || state === 'hidden') continue
      }
      if (action.type === 'submenu') {
        const children = getActionChildren(action.id)
        for (const child of children) {
          commandItems.push({
            id: `cmd:${action.id}/${child.id || child.label}`,
            children: child.label,
            keywords: [action.label, child.label],
            itemType: 'command',
            onClick: () => { if (child.execute) child.execute() },
          })
        }
      } else if (action.type === 'link' && action.url) {
        const resolvedUrl = action.url.startsWith('/') && !action.url.startsWith('//') ? prefix + action.url : action.url
        commandItems.push({
          id: `cmd:${action.id}`,
          children: action.label,
          keywords: [action.label],
          itemType: 'link',
          url: resolvedUrl,
          onClick: () => {
            window.location.href = resolvedUrl
          },
        })
      } else {
        commandItems.push({
          id: `cmd:${action.id}`,
          children: action.label,
          keywords: [action.label],
          itemType: 'command',
          onClick: () => executeAction(action.id),
        })
      }
    }
    if (commandItems.length === 0) return null
    return { group: { heading: section.title, id: `cfg:${section.id}`, items: commandItems } }
  }

  // --- Recent source: all artifact types from getRecent() ---
  if (section.source === 'recent') {
    const recent = getRecent()
    if (recent.length === 0) return null
    let items = recent
    if (section.limit) items = items.slice(0, section.limit)
    return {
      group: {
        heading: section.title,
        id: `cfg:${section.id}`,
        items: items.map(entry => {
          const route = resolveRecentRoute(entry, prefix)
          return {
            id: `cfg:${section.id}:${entry.type}:${entry.key}`,
            children: entry.label,
            keywords: [entry.type, entry.key, entry.label],
            itemType: entry.type,
            url: route || undefined,
            onClick: () => {
              trackRecent(entry.type, entry.key, entry.label)
              if (route) window.location.href = route
            },
          }
        }),
      },
    }
  }

  // --- Artifact sources: canvases, prototypes, stories ---
  const index = buildPrototypeIndex()
  let sourceItems = []

  if (section.source === 'canvases') {
    for (const c of index.canvases) sourceItems.push({ name: c.name, route: `${prefix}${c.route}`, id: c.dirName, type: 'canvas' })
    for (const f of index.folders) {
      if (f.canvases) for (const c of f.canvases) sourceItems.push({ name: c.name, route: `${prefix}${c.route}`, id: c.dirName, type: 'canvas' })
    }
  } else if (section.source === 'prototypes') {
    const formatFlowName = (name) => name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    const pushProtoFlows = (p) => {
      if (p.isExternal) {
        sourceItems.push({ name: p.name, route: p.externalUrl, id: p.dirName, type: 'prototype', isExternal: true })
      } else if (p.flows.length <= 1) {
        const route = p.flows.length === 1 ? `${prefix}${p.flows[0].route}` : `${prefix}/${p.dirName}`
        sourceItems.push({ name: p.name, route, id: p.dirName, type: 'prototype' })
      } else {
        for (const flow of p.flows) {
          const flowLabel = flow.meta?.title || formatFlowName(flow.name)
          sourceItems.push({
            name: `${p.name} – ${flowLabel}`,
            route: `${prefix}${flow.route}`,
            id: `${p.dirName}/${flow.name}`,
            type: 'prototype',
          })
        }
      }
    }
    for (const p of index.prototypes) pushProtoFlows(p)
    for (const f of index.folders) {
      for (const p of f.prototypes) pushProtoFlows(p)
    }
  } else if (section.source === 'stories') {
    for (const name of listStories()) {
      const data = getStoryData(name)
      const route = data?._route || `/components/${name}`
      sourceItems.push({ name, route: `${prefix}${route}`, id: name, type: 'story' })
    }
  }

  if (sourceItems.length === 0) return null

  if (section.order === 'recent') {
    const recent = getRecent()
    const recentKeys = recent.map(r => r.key)
    sourceItems.sort((a, b) => {
      const ai = recentKeys.indexOf(a.id)
      const bi = recentKeys.indexOf(b.id)
      if (ai === -1 && bi === -1) return 0
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
  } else if (section.order === 'alphabetical') {
    sourceItems.sort((a, b) => a.name.localeCompare(b.name))
  }

  if (section.limit) sourceItems = sourceItems.slice(0, section.limit)

  return {
    group: {
      heading: section.title,
      id: `cfg:${section.id}`,
      items: sourceItems.map(item => ({
        id: `cfg:${section.id}:${item.id}`,
        children: item.name,
        keywords: [item.name, item.id, item.type],
        itemType: item.type,
        url: item.route,
        onClick: () => {
          trackRecent(item.type, item.id, item.name)
          if (item.isExternal) {
            window.open(item.route, '_blank')
          } else {
            window.location.href = item.route
          }
        },
      })),
    },
  }
}

/**
 * Build a section from toolbar.config.json tools.
 * If toolIds is provided, only include those tools in that order (with optional custom labels).
 * Otherwise include all command-palette tools.
 *
 * toolIds format: ["theme", "flows"] or [{ id: "theme", label: "Change theme" }]
 */
function buildToolsSection(section, prefix, onNavigateToPage) {
  const toolbarConfig = getToolbarConfig()
  const tools = toolbarConfig?.tools || {}
  const mode = getCurrentMode() || 'default'
  const actions = getActionsForMode(mode)
  const basePath = prefix || '/'

  let entries = []

  if (section.toolIds && section.toolIds.length > 0) {
    for (const entry of section.toolIds) {
      const toolId = typeof entry === 'string' ? entry : entry.id
      const customLabel = typeof entry === 'object' ? entry.label : null
      const closeOnSelect = typeof entry === 'object' ? entry.closeOnSelect : undefined
      const iconMeta = typeof entry === 'object' ? entry.meta : undefined
      const hideChildrenFromSearch = typeof entry === 'object' ? entry.hideChildrenFromSearch === true : false
      const tool = tools[toolId]
      if (!tool) continue
      const state = getToolbarToolState(toolId)
      if (state === 'disabled' || state === 'hidden') continue
      if (isHiddenInPalette(tool, basePath)) continue
      entries.push({ toolId, tool, label: customLabel || tool.label || toolId, toolIcon: tool.icon, toolMeta: iconMeta, closeOnSelect: closeOnSelect ?? tool.closeOnSelect, hideChildrenFromSearch })
    }
  } else {
    for (const [toolId, tool] of Object.entries(tools)) {
      if (tool.surface !== 'command-palette') continue
      const state = getToolbarToolState(toolId)
      if (state === 'disabled' || state === 'hidden') continue
      if (isHiddenInPalette(tool, basePath)) continue
      entries.push({ toolId, tool, label: tool.label || toolId, toolIcon: tool.icon, toolMeta: undefined, closeOnSelect: tool.closeOnSelect })
    }
  }

  if (entries.length === 0) return null

  const items = []
  const subPages = []

  for (const { toolId, tool, label, closeOnSelect: entryCloseOnSelect, hideChildrenFromSearch } of entries) {
    // Inline actions
    if (tool.inlineAction === 'toggle-chrome') {
      const isHidden = document.documentElement.classList.contains('storyboard-chrome-hidden')
      items.push({
        id: `cfg:${section.id}:${toolId}`,
        toolIcon: 'primer/light-bulb',
        children: <HideToolbarsLabel isHidden={isHidden} />,
        keywords: [label, toolId, 'hide', 'show', 'toolbar', 'completely'].filter(Boolean),
        showType: false,
        closeOnSelect: entryCloseOnSelect,
        onClick: () => {
          document.documentElement.classList.remove('storyboard-chrome-completely-hidden')
          document.documentElement.classList.toggle('storyboard-chrome-hidden')
        },
        onAltClick: () => {
          document.documentElement.classList.add('storyboard-chrome-hidden')
          document.documentElement.classList.add('storyboard-chrome-completely-hidden')
        },
      })
      continue
    }

    if (tool.inlineAction === 'open-palette') {
      items.push({
        id: `cfg:${section.id}:${toolId}`,
        children: label,
        keywords: [label, toolId, 'command', 'palette', 'search'].filter(Boolean),
        showType: false,
        onClick: () => {
          document.dispatchEvent(new CustomEvent('storyboard:open-palette'))
        },
      })
      continue
    }

    if (tool.inlineAction === 'open-deployed-branch') {
      if (!getProdDomain()) continue
      items.push({
        id: `cfg:${section.id}:${toolId}`,
        children: label,
        keywords: [label, toolId, 'deployed', 'branch', 'production', 'preview'].filter(Boolean),
        showType: false,
        closeOnSelect: entryCloseOnSelect,
        onClick: () => openDeployedBranch(),
      })
      continue
    }

    if (tool.inlineAction === 'open-notebook-sidebar') {
      items.push({
        id: `cfg:${section.id}:${toolId}`,
        children: label,
        keywords: [label, toolId, 'home', 'pages', 'sidebar'],
        showType: false,
        onClick: () => openNotebookSidebar({ focusType: tool.focusType || null }),
      })
      continue
    }

    if (tool.render === 'link' && tool.url) {
      const resolvedUrl = tool.url.startsWith('/') ? prefix + tool.url : tool.url
      items.push({
        id: `cfg:${section.id}:${toolId}`,
        children: label,
        keywords: [label, toolId].filter(Boolean),
        url: resolvedUrl,
        closeOnSelect: entryCloseOnSelect,
        onClick: () => {
          window.location.href = resolvedUrl
        },
      })
      continue
    }

    if (tool.render === 'submenu' || tool.render === 'menu') {
      const action = actions.find(a => a.toolKey === toolId)
      if (action?.type === 'submenu') {
        const children = getActionChildren(action.id)
        if (children.length > 0) {
          const pageId = `tool:${toolId}`
          subPages.push({
            id: pageId,
            label,
            title: label,
            keywords: [label, toolId].filter(Boolean),
            hideChildrenFromSearch,
            options: children.map(child => ({
              label: child.label,
              execute: child.execute,
              type: child.type,
              active: child.active,
            })),
          })
          items.push({
            id: `cfg:${section.id}:${toolId}`,
            children: label,
            keywords: [label, toolId].filter(Boolean),
            onClick: () => onNavigateToPage?.(pageId),
            closeOnSelect: false,
            showType: false,
          })
          continue
        }
      }

      // Declarative options from toolbar.config.json (e.g. theme options)
      if (tool.options && tool.options.length > 0) {
        const pageId = `tool:${toolId}`
        const handlerId = tool.handler || `core:${toolId}`
        subPages.push({
          id: pageId,
          label,
          title: label,
          keywords: [label, toolId].filter(Boolean),
          options: tool.options.map(opt => ({
            label: opt.label,
            // Lazy-execute via the handler's action system
            toolHandler: handlerId,
            value: opt.value,
          })),
        })
        items.push({
          id: `cfg:${section.id}:${toolId}`,
          children: label,
          keywords: [label, toolId].filter(Boolean),
          onClick: () => onNavigateToPage?.(pageId),
          closeOnSelect: false,
          showType: false,
        })
        continue
      }

      // Menu tool without sub-items or options — dispatch open event, fall back to clicking toolbar button
      const ariaLabel = tool.ariaLabel || tool.label || toolId
      items.push({
        id: `cfg:${section.id}:${toolId}`,
        children: label,
        keywords: [label, toolId].filter(Boolean),
        showType: false,
        onClick: () => {
          setTimeout(() => {
            document.dispatchEvent(new CustomEvent(`storyboard:open-${toolId}`))
            const btn = document.querySelector(`[aria-label="${ariaLabel}"]`)
            if (btn) btn.click()
          }, 100)
        },
      })
      continue
    }

    if (tool.render === 'sidepanel' && tool.sidepanel) {
      const action = actions.find(a => a.toolKey === toolId)
      items.push({
        id: `cfg:${section.id}:${toolId}`,
        children: label,
        keywords: [label, toolId].filter(Boolean),
        closeOnSelect: entryCloseOnSelect,
        onClick: () => { if (action) executeAction(action.id) },
      })
      continue
    }

    if (tool.render === 'knobs-panel') {
      const actionId = tool.handler || `core:${toolId}`
      items.push({
        id: `cfg:${section.id}:${toolId}`,
        children: label,
        keywords: [label, toolId, 'tweak', 'configure', 'knob', 'configuration', 'options'].filter(Boolean),
        closeOnSelect: entryCloseOnSelect,
        onClick: () => executeAction(actionId),
      })
      continue
    }

    items.push({
      id: `cfg:${section.id}:${toolId}`,
      children: label,
      keywords: [label, toolId].filter(Boolean),
      closeOnSelect: entryCloseOnSelect,
      onClick: () => executeAction(toolId),
    })
  }

  // Add toolIcon and toolMeta to all items from their entry
  const iconByToolId = new Map(entries.map(e => [e.toolId, { icon: e.toolIcon, meta: e.toolMeta }]))
  for (const item of items) {
    if (!item.toolIcon) {
      const match = item.id?.match(/cfg:[^:]+:(.+)/)
      if (match && iconByToolId.has(match[1])) {
        const entry = iconByToolId.get(match[1])
        item.toolIcon = entry.icon
        if (!item.toolMeta && entry.meta) item.toolMeta = entry.meta
      }
    }
  }

  return {
    group: {
      heading: section.title,
      id: `cfg:${section.id}`,
      items,
    },
    subPages,
    usedToolIds: entries.map(e => e.toolId),
  }
}

function resolveRecentRoute(entry, prefix) {
  switch (entry.type) {
    case 'prototype':
      return `${prefix}/${entry.key}`
    case 'canvas':
      return `${prefix}/canvas/${entry.key}`
    case 'story': {
      const data = getStoryData(entry.key)
      const route = data?._route || `/components/${entry.key}`
      return `${prefix}${route}`
    }
    default:
      return null
  }
}

/**
 * Build a map of author → artifacts from the prototype index.
 * Returns { authorIndex: Map<lowercase-author, { author, items[] }> }
 */
function buildAuthorIndex(prefix) {
  const index = buildPrototypeIndex()
  const authorMap = new Map()

  function addItem(author, item) {
    const key = author.toLowerCase()
    if (!authorMap.has(key)) authorMap.set(key, { author, items: [] })
    authorMap.get(key).items.push(item)
  }

  function processAuthors(authors, item) {
    if (!authors) return
    const list = Array.isArray(authors) ? authors : [authors]
    for (const a of list) if (a) addItem(a, item)
  }

  for (const p of index.prototypes) {
    processAuthors(p.author, { name: p.name, route: `${prefix}/${p.dirName}`, id: p.dirName, type: 'Prototype' })
  }
  for (const f of index.folders) {
    for (const p of f.prototypes) {
      processAuthors(p.author, { name: p.name, route: `${prefix}/${p.dirName}`, id: p.dirName, type: 'Prototype' })
    }
    if (f.canvases) {
      for (const c of f.canvases) {
        processAuthors(c.author, { name: c.name, route: `${prefix}${c.route}`, id: c.dirName, type: 'Canvas' })
      }
    }
  }
  for (const c of index.canvases) {
    processAuthors(c.author, { name: c.name, route: `${prefix}${c.route}`, id: c.dirName, type: 'Canvas' })
  }

  return authorMap
}

/**
 * Build the JSON structure for react-cmdk from all data providers.
 * Entirely config-driven — all sections come from commandPalette.sections.
 */
function buildPaletteItems(basePath, onCreateAction, onNavigateToPage) {
  const base = (basePath || '/').replace(/\/+$/, '')
  const prefix = base === '/' ? '' : base

  const { groups, toolMenus, hiddenFromSearchIds } = buildConfigSections(prefix, onNavigateToPage, onCreateAction)
  const authorIndex = buildAuthorIndex(prefix)

  const settingsItem = {
    id: 'cfg:app:settings',
    children: 'Settings',
    toolIcon: 'iconoir/settings',
    keywords: ['settings', 'preferences', 'config', 'configuration'],
    onClick: () => document.dispatchEvent(new CustomEvent('storyboard:open-settings')),
  }
  const homepageGroup = groups.find(group => group.items?.some(item => ['Go to workspace', 'Homepage', 'Open notebook sidebar'].includes(item.children)))
  const homepageIndex = homepageGroup?.items?.findIndex(item => ['Go to workspace', 'Homepage', 'Open notebook sidebar'].includes(item.children)) ?? -1
  if (homepageGroup && homepageIndex >= 0) {
    homepageGroup.items.splice(homepageIndex + 1, 0, settingsItem)
  } else {
    groups.unshift({ id: 'cfg:app', items: [settingsItem] })
  }

  return { groups, toolMenus, authorIndex, hiddenFromSearchIds }
}

/**
 * StoryboardCommandPalette — React command palette using react-cmdk.
 * Mounted at app root, listens for custom events from CoreUIBar.
 */
export default function StoryboardCommandPalette({ basePath }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [items, setItems] = useState([])
  const [notebookPages, setNotebookPages] = useState([])
  const [toolMenus, setToolMenus] = useState([])
  const [authorIndex, setAuthorIndex] = useState(new Map())
  const [hiddenFromSearchIds, setHiddenFromSearchIds] = useState(new Set())
  const [activePage, setActivePage] = useState('root')
  const [createType, setCreateType] = useState(null)
  const [createInitialValues, setCreateInitialValues] = useState(null)
  const [widgetArtifactType, setWidgetArtifactType] = useState(null)
  const [currentTheme, setCurrentTheme] = useState(() => getTheme())
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!open || !isBrowserCoreMode()) return undefined
    const controller = new AbortController()
    coreRequestJson('/_storyboard/notebook/pages', { cache: 'no-store', signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setNotebookPages(Array.isArray(data.pages) ? data.pages : []) })
      .catch(() => { if (!controller.signal.aborted) setNotebookPages([]) })
    return () => controller.abort()
  }, [open])

  // Track modifier keys for link items (cmd/ctrl → new tab, alt → copy link).
  // Updated from the most recent keyboard/mouse event via a capturing listener
  // on the document so it fires before cmdk's own handlers.
  const modifierHeldRef = useRef(false)
  const altHeldRef = useRef(false)
  useEffect(() => {
    const track = (e) => { modifierHeldRef.current = e.metaKey || e.ctrlKey; altHeldRef.current = e.altKey }
    const reset = () => { modifierHeldRef.current = false; altHeldRef.current = false }
    document.addEventListener('keydown', track, true)
    document.addEventListener('keyup', reset, true)
    document.addEventListener('mousedown', track, true)
    return () => {
      document.removeEventListener('keydown', track, true)
      document.removeEventListener('keyup', reset, true)
      document.removeEventListener('mousedown', track, true)
    }
  }, [])

  // Keep currentTheme in sync when theme changes
  useEffect(() => {
    const handler = (e) => setCurrentTheme(e.detail.theme)
    document.addEventListener('storyboard:theme:changed', handler)
    return () => document.removeEventListener('storyboard:theme:changed', handler)
  }, [])

  // External callers (canvas Add menu, workspace) request the create dialog by
  // dispatching `storyboard:create-artifact` with `{ type: 'Prototype' | ... }`.
  // Accepts both PascalCase (palette ids) and lowercase (schema keys).
  useEffect(() => {
    const handler = (e) => {
      const raw = e?.detail?.type
      if (!raw || (!isTauriAvailable() && !isBrowserCoreMode())) return
      const type = typeof raw === 'string' ? raw.charAt(0).toUpperCase() + raw.slice(1) : raw
      setOpen(false)
      setCreateInitialValues(null)
      requestAnimationFrame(() => setCreateType(type))
    }
    document.addEventListener('storyboard:create-artifact', handler)
    return () => document.removeEventListener('storyboard:create-artifact', handler)
  }, [])

  useEffect(() => {
    const openSiteCreate = event => {
      setOpen(false)
      setActivePage('root')
      setCreateInitialValues(event.detail || {})
      setCreateType('Site')
    }
    document.addEventListener('storyboard:open-site-create', openSiteCreate)
    return () => document.removeEventListener('storyboard:open-site-create', openSiteCreate)
  }, [])

  function handleCreateAction(type) {
    setOpen(false)
    setCreateInitialValues(null)
    requestAnimationFrame(() => setCreateType(type))
  }

  function handleNavigateToPage(pageId) {
    setSearch('')
    setActivePage(pageId)
  }

  // Listen for Cmd+K directly to toggle the palette
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        // Customer mode: disabled when `commandPalette: false` (new class)
        // or `hideChrome: true` legacy fallback (older class — palette is
        // part of chrome).
        const html = document.documentElement.classList
        if (
          html.contains('storyboard-customer-hide-command-palette') ||
          html.contains('storyboard-customer-hide-chrome')
        ) {
          return
        }
        e.preventDefault()
        const built = buildPaletteItems(basePath, handleCreateAction, handleNavigateToPage)
        setItems(built.groups)
        setToolMenus(built.toolMenus)
        setAuthorIndex(built.authorIndex)
        setHiddenFromSearchIds(built.hiddenFromSearchIds || new Set())
        setSearch('')
        setActivePage('root')
        setOpen(prev => !prev)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [basePath])

  // Listen for toggle/open events from toolbar buttons (e.g. CommandPaletteTrigger)
  useEffect(() => {
    function handleToggle() {
      setOpen(prev => {
        if (!prev) {
          // Use setTimeout to set items after open state is committed
          setTimeout(() => {
            const built = buildPaletteItems(basePath, handleCreateAction, handleNavigateToPage)
            setItems(built.groups)
            setToolMenus(built.toolMenus)
            setAuthorIndex(built.authorIndex)
            setHiddenFromSearchIds(built.hiddenFromSearchIds || new Set())
            setSearch('')
            setActivePage('root')
          }, 0)
        }
        return !prev
      })
    }

    function handleOpen() {
      const built = buildPaletteItems(basePath, handleCreateAction, handleNavigateToPage)
      setItems(built.groups)
      setToolMenus(built.toolMenus)
      setAuthorIndex(built.authorIndex)
      setHiddenFromSearchIds(built.hiddenFromSearchIds || new Set())
      setSearch('')
      setActivePage('root')
      setOpen(true)
    }

    document.addEventListener('storyboard:toggle-palette', handleToggle)
    document.addEventListener('storyboard:open-palette', handleOpen)
    return () => {
      document.removeEventListener('storyboard:toggle-palette', handleToggle)
      document.removeEventListener('storyboard:open-palette', handleOpen)
    }
  }, [basePath])

  // Listen for requests to open the widget artifact picker dialog. Items in
  // the create-widget palette section dispatch this when the chosen widget
  // type needs an artifact selected up front (prototype, story, story-set).
  useEffect(() => {
    function handleOpenArtifactDialog(e) {
      const t = e?.detail?.type
      if (!t) return
      setOpen(false)
      setWidgetArtifactType(t)
    }
    document.addEventListener('storyboard:open-widget-artifact-dialog', handleOpenArtifactDialog)
    return () => document.removeEventListener('storyboard:open-widget-artifact-dialog', handleOpenArtifactDialog)
  }, [])

  // Rebuild palette items when a toggle is clicked (refreshKey changes)
  useEffect(() => {
    if (refreshKey === 0) return
    const built = buildPaletteItems(basePath, handleCreateAction, handleNavigateToPage)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(built.groups)
    setToolMenus(built.toolMenus)
  }, [refreshKey, basePath])

  const handleChangeOpen = useCallback((value) => {
    if (!value) {
      // Escape from a sub-page goes back to root instead of closing
      if (activePage !== 'root') {
        setActivePage('root')
        setSearch('')
        return
      }
      setOpen(false)
      setActivePage('root')
    }
  }, [activePage])

  // Flatten sub-page options into searchable groups so they appear in root search
  const subPageGroups = useMemo(() => {
    return toolMenus.filter(menu => !menu.hideChildrenFromSearch).map(menu => ({
      heading: menu.label || menu.title || menu.id,
      id: `subpage:${menu.id}`,
      items: (menu.options || []).map((opt, i) => ({
        id: `subpage:${menu.id}:${i}`,
        label: opt.label,
        icon: opt.icon,
        isToggle: opt.type === 'toggle',
        isActiveToggle: opt.type === 'toggle' && opt.active,
        isActiveTheme: opt.toolHandler === 'core:theme' && opt.value === currentTheme,
        keywords: [opt.label, menu.label || menu.id],
        onSelect: () => {
          if (opt.execute) {
            opt.execute()
          } else if (opt.toolHandler === 'core:theme' && opt.value) {
            setTheme(opt.value)
          } else if (opt.action) {
            executeAction(opt.action, opt.value)
          }
          if (opt.type === 'toggle') {
            setRefreshKey(k => k + 1)
          } else {
            setOpen(false)
            setActivePage('root')
          }
        },
      })),
    })).filter(g => g.items.length > 0)
  }, [toolMenus, currentTheme])

  // Build author groups from the index
  const authorGroups = useMemo(() => {
    const groups = []
    for (const [, { author, items: authorItems }] of authorIndex) {
      groups.push({
        heading: `Artifacts by @${author}`,
        id: `author:${author.toLowerCase()}`,
        author,
        items: authorItems.map(item => ({
          id: `author:${item.id}`,
          label: item.name,
          type: item.type,
          url: item.route,
          keywords: [item.name, item.id, item.type, author, `@${author}`],
          onSelect: () => {
            trackRecent(item.type.toLowerCase(), item.id, item.name)
            setOpen(false)
            setActivePage('root')
            window.location.href = item.route
          },
        })),
      })
    }
    return groups
  }, [authorIndex])

  // Remove consecutive separators and leading/trailing separators
  const cleanedItems = useMemo(() => {
    const result = []
    for (const item of items) {
      const isSep = item.id?.startsWith('cfg:sep')
      if (isSep && (result.length === 0 || result[result.length - 1].id?.startsWith('cfg:sep'))) continue
      result.push(item)
    }
    while (result.length > 0 && result[result.length - 1].id?.startsWith('cfg:sep')) result.pop()
    return result
  }, [items])

  const searchedPageItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (activePage !== 'root' || !query) return []
    const base = (basePath || '/').replace(/\/+$/, '')
    const prefix = base === '/' ? '' : base
    const pageItems = notebookPages
      .filter(page => `${page.title || ''} ${page.id || ''} ${page.type || ''} ${page.status || ''}`.toLowerCase().includes(query))
      .map(page => {
        const params = new URLSearchParams()
        if (page.diagnostics?.some(item => item.code === 'PAGE_ROUTE_CONFLICT')) params.set('_notebookPage', page.id)
        const route = `${prefix}${page.route || '/'}`
        return {
          id: `notebook-page:${page.id}`,
          label: page.title || page.id,
          type: page.type,
          unavailable: page.available === false,
          url: `${route}${params.size ? `?${params}` : ''}`,
          page,
        }
      })
    const componentItems = listStories()
      .filter(name => `${name} component story`.toLowerCase().includes(query))
      .map(name => ({
        id: `notebook-component:${name}`,
        label: name,
        type: 'component',
        url: `${prefix}${getStoryData(name)?._route || `/components/${name}`}`,
      }))
    return [...pageItems, ...componentItems]
  }, [activePage, basePath, notebookPages, search])

  // Build search value string from keywords array.
  // `index_tags` (array) are prepended so they get prefix-match scoring
  // (highest tier in scoreMatch), allowing per-entry boosting in search
  // ranking — e.g. index_tags:["Add Sticky note"] means typing "add" ranks
  // this item at the top via SCORE_PREFIX. `tag` (string) is purely visual
  // and does NOT participate in scoring.
  function itemValue(item) {
    const parts = []
    if (Array.isArray(item.index_tags)) parts.push(...item.index_tags)
    if (typeof item.children === 'string') parts.push(item.children)
    if (item.label) parts.push(item.label)
    if (item.keywords) parts.push(...item.keywords)
    return parts.filter(Boolean).join(' ')
  }

  // Custom filter using scoreMatch for better ranking.
  // scoreMatch tiers: prefix (100) > word-boundary (75) > substring (50) > fuzzy (5-25).
  // Normalizes to 0-1 for cmdk; weak fuzzy matches (score < 10) are hidden to
  // prevent garbage results from dominating above exact matches in other groups.
  const MAX_SCORE = 110
  const cmdkFilter = useCallback((value, search) => {
    if (!search) return 1
    const score = scoreMatch(value, search.toLowerCase().trim())
    if (score < 10) return 0
    return Math.min(1, score / MAX_SCORE)
  }, [])

  function showCenterToast(message) {
    const el = document.createElement('div')
    Object.assign(el.style, {
      position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      zIndex: '10000', padding: '0.625rem 1rem', borderRadius: '0.5rem',
      background: 'var(--color-background-emphasis, #1f2328)', color: 'var(--color-foreground-on-emphasis, #fff)',
      fontSize: '0.8125rem', fontFamily: 'var(--font-sans, system-ui)',
      opacity: '0', transition: 'opacity 0.15s ease',
      pointerEvents: 'none',
    })
    el.textContent = message
    document.body.appendChild(el)
    requestAnimationFrame(() => { el.style.opacity = '1' })
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 200) }, 1800)
  }

  function copyLinkToClipboard(url, itemType) {
    const fullUrl = url.startsWith('/') ? window.location.origin + url : url
    const isCanvasRoute = typeof window !== 'undefined' && window.location.pathname.includes('/canvas/')
    const isPasteable = itemType === 'prototype' || itemType === 'story'
    const shouldPaste = isCanvasRoute && isPasteable

    navigator.clipboard.writeText(fullUrl).then(() => {
      showCenterToast(shouldPaste ? 'Link copied and pasted' : 'Link copied to clipboard')
    })

    if (shouldPaste) {
      document.dispatchEvent(new CustomEvent('storyboard:canvas:paste-url', { detail: { url: fullUrl } }))
    }
  }

  return (
    <>
    {open && (
      <>
      {/* Overlay */}
      <div data-cmdk-overlay="" onClick={() => handleChangeOpen(false)} />
      {/* Dialog container — replaces Command.Dialog to avoid Radix context issues */}
      <div
        data-cmdk-dialog=""
        role="dialog"
        aria-label="Command Menu"
      >
      <Command
        className="command-palette"
        shouldFilter={activePage === 'root'}
        filter={cmdkFilter}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && activePage !== 'root') {
            e.preventDefault()
            e.stopPropagation()
            setActivePage('root')
            setSearch('')
          } else if (e.key === 'Escape') {
            handleChangeOpen(false)
          }
        }}
      >
      <Command.Input
        autoFocus
        placeholder={activePage === 'root'
          ? 'Search commands, prototypes, canvases, stories...'
          : `Search ${toolMenus.find(m => m.id === activePage)?.label || ''}...`
        }
        value={search}
        onValueChange={setSearch}
      />
      <Command.List>
        <Command.Empty>No results found.</Command.Empty>

        {activePage === 'root' ? (
          <>
            {/* Sub-page options flattened for root search — rendered first
                so high-scoring items (e.g. "Copilot CLI" for query "cop")
                appear above weaker matches in later groups. */}
            {search && subPageGroups.map(group => (
              <Command.Group key={group.id} heading={group.heading}>
                {group.items.map(item => (
                  <Command.Item
                    key={item.id}
                    value={itemValue(item)}
                    onSelect={item.onSelect}
                  >
                    {item.icon && <Icon name={item.icon} size={ICON_SIZE} color="var(--color-foreground-muted, #656d76)" />}
                    <span style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{item.label}</span>
                      {(item.isActiveToggle || item.isActiveTheme) && <span>✓</span>}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            ))}

            {searchedPageItems.length > 0 && (
              <Command.Group heading="Notebook pages and components">
                {searchedPageItems.map(item => (
                  <Command.Item
                    key={item.id}
                    value={`${item.label} ${item.type || ''} ${item.page?.id || ''}`}
                    onSelect={() => {
                      if (item.page) trackRecent(item.page.type, item.page.id, item.label)
                      window.location.href = item.url
                    }}
                  >
                    <ItemIcon type={item.type} />
                    <span style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <span>{item.label}</span>
                      {item.unavailable && <small>Unavailable</small>}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Main config-driven groups */}
            {cleanedItems.map((list) => (
              list.id?.startsWith('cfg:sep') ? (
                !search && <Command.Separator key={list.id} />
              ) : (
                <Command.Group key={list.id} heading={list.heading}>
                  {list.items.map(({ id, children, keywords, tag, index_tags, onClick, onAltClick, itemType, toolIcon, toolMeta, closeOnSelect, hideFromSearch, url }) => {
                    if (search && hideFromSearch) return null
                    if (hiddenFromSearchIds.size > 0) {
                      for (const toolId of hiddenFromSearchIds) {
                        if (id?.includes(toolId)) return null
                      }
                    }
                    return (
                      <Command.Item
                        key={id}
                        value={itemValue({ children, keywords, index_tags })}
                        onSelect={() => {
                          if (url && altHeldRef.current) {
                            copyLinkToClipboard(url, itemType)
                          } else if (url && modifierHeldRef.current) {
                            window.open(url, '_blank')
                          } else if (onAltClick && altHeldRef.current) {
                            onAltClick()
                          } else {
                            onClick?.()
                          }
                          if (closeOnSelect !== false) {
                            setOpen(false)
                            setActivePage('root')
                          }
                        }}
                      >
                        <ItemIcon type={itemType} toolIcon={toolIcon} toolMeta={toolMeta} />
                        <span style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                          <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
                          {tag && <span data-cmdk-item-tag="">{tag}</span>}
                        </span>
                      </Command.Item>
                    )
                  })}
                </Command.Group>
              )
            ))}

            {/* Author groups */}
            {search && authorGroups.map(group => (
              <Command.Group key={group.id} heading={group.heading}>
                {group.items.map(item => (
                  <Command.Item
                    key={item.id}
                    value={itemValue(item)}
                    onSelect={() => {
                      if (item.url && altHeldRef.current) {
                        copyLinkToClipboard(item.url, item.type?.toLowerCase())
                        setOpen(false)
                        setActivePage('root')
                      } else if (item.url && modifierHeldRef.current) {
                        window.open(item.url, '_blank')
                        setOpen(false)
                        setActivePage('root')
                      } else {
                        item.onSelect()
                      }
                    }}
                  >
                    <AvatarIcon username={group.author} />
                    <span style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{item.label}</span>
                      <span style={{ fontSize: '12px', color: 'var(--color-foreground-muted, #999)' }}>{item.type}</span>
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </>
        ) : (
          /* Tool-menu sub-pages */
          toolMenus.filter(menu => menu.id === activePage).map(menu => (
            <Command.Group key={menu.id} heading={menu.title || menu.label || menu.id}>
              {(menu.options || []).map((opt, i) => {
                const isActiveToggle = opt.type === 'toggle' && opt.active
                const isActiveTheme = opt.toolHandler === 'core:theme' && opt.value === currentTheme
                return (
                  <Command.Item
                    key={`${menu.id}:${i}`}
                    value={opt.label}
                    onSelect={() => {
                      if (opt.execute) {
                        opt.execute()
                      } else if (opt.toolHandler === 'core:theme' && opt.value) {
                        setTheme(opt.value)
                      } else if (opt.action) {
                        executeAction(opt.action, opt.value)
                      }
                      if (opt.type === 'toggle') {
                        setRefreshKey(k => k + 1)
                      } else {
                        setOpen(false)
                        setActivePage('root')
                      }
                    }}
                  >
                    {opt.icon && <Icon name={opt.icon} size={ICON_SIZE} color="var(--color-foreground-muted, #656d76)" />}
                    <span style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{opt.label}</span>
                      {(isActiveToggle || isActiveTheme) && <span>✓</span>}
                    </span>
                  </Command.Item>
                )
              })}
            </Command.Group>
          ))
        )}
      </Command.List>
    </Command>
      </div>
      </>
    )}

    <CreateDialog
      type={createType}
      basePath={basePath}
      initialValues={createInitialValues}
      onClose={() => { setCreateType(null); setCreateInitialValues(null) }}
    />
    <WidgetArtifactDialog
      type={widgetArtifactType}
      onClose={() => setWidgetArtifactType(null)}
    />
    <BranchBar basePath={basePath} />
    <AuthModal />
    </>
  )
}
