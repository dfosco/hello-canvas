/**
 * CanvasCreateMenu — CoreUIBar dropdown for adding widgets to the active canvas.
 * Dispatches custom events to bridge to React canvas system.
 * Only visible when a canvas page is active.
 */
import { useState, useMemo, useEffect, useRef } from 'react'
import { TriggerButton } from '../lib/components/ui/trigger-button/index.js'
import * as DropdownMenu from '../lib/components/ui/dropdown-menu/index.js'
import { SearchableList } from '../lib/components/ui/searchable-list.jsx'
import Icon from './Icon.jsx'
import { getConfig } from '../index.js'
import { buildPrototypeIndex } from '../index.js'
import { getFlag } from '../stores/featureFlags.js'
import { isTauriAvailable } from '../notebook/tauri-bridge.js'

const widgetTypes = [
  { type: 'sticky-note', label: 'Sticky Note' },
  { type: 'markdown', label: 'Markdown' },
  { type: 'file', label: 'File…', action: 'open-file-picker' },
  { type: 'prompt', label: 'Prompt', flag: 'prompt-widget' },
  { type: 'terminal', label: 'Terminal' },
  { type: 'agent-chat', label: 'Agent Chat', flag: 'agent-chat-widget' },
]

function formatName(name) {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function ChevronRight({ className, style }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} style={style}>
      <path d="M4.5 2.5L7.5 6L4.5 9.5" />
    </svg>
  )
}

function getApiUrl() {
  const basePath = window.__STORYBOARD_BASE_PATH__ || '/'
  return basePath.replace(/\/$/, '') + '/_storyboard/canvas'
}

export default function CanvasCreateMenu({ config = {}, data: _data, canvasName = '', zoom: _zoom, tabindex }) {
  void _data
  void _zoom
  const [menuOpen, setMenuOpen] = useState(false)
  const [view, setView] = useState('menu')
  const [stories, setStories] = useState([])
  const [storiesLoaded, setStoriesLoaded] = useState(false)
  const componentSearchRef = useRef(null)
  const prototypeSearchRef = useRef(null)
  const [expandedProtos, setExpandedProtos] = useState(new Set())

  const showAgentsInMenu = useMemo(() => {
    const canvasConfig = getConfig('canvas')
    return canvasConfig?.showAgentsInAddMenu !== false
  }, [])

  // Read agent configs from canvas.agents
  const agents = useMemo(() => {
    if (!showAgentsInMenu) return []
    const canvasConfig = getConfig('canvas')
    const agentsConfig = canvasConfig?.agents
    if (!agentsConfig || typeof agentsConfig !== 'object') return []
    return Object.entries(agentsConfig).map(([id, cfg]) => ({
      id,
      label: cfg.label || id,
      startupCommand: cfg.startupCommand || id,
      defaultWidth: cfg.defaultWidth,
      defaultHeight: cfg.defaultHeight,
    }))
  }, [])

  // Build prototype list for the Prototype submenu
  const prototypeItems = useMemo(() => {
    try {
      const idx = buildPrototypeIndex()
      const allProtos = []
      for (const folder of (idx.sorted?.title?.folders || idx.folders || [])) {
        for (const proto of folder.prototypes || []) {
          if (!proto.isExternal) allProtos.push(proto)
        }
      }
      for (const proto of (idx.sorted?.title?.prototypes || idx.prototypes || [])) {
        if (!proto.isExternal) allProtos.push(proto)
      }
      return allProtos.map((proto) => {
        if (proto.hideFlows && proto.flows.length === 1) {
          return { name: proto.name, dirName: proto.dirName, flows: [{ name: proto.name, route: proto.flows[0].route }], singleFlow: true }
        } else if (proto.flows.length > 0) {
          return { name: proto.name, dirName: proto.dirName, flows: proto.flows.map((f) => ({ name: f.meta?.title || formatName(f.name), route: f.route })), singleFlow: false }
        } else {
          return { name: proto.name, dirName: proto.dirName, flows: [{ name: proto.name, route: `/${proto.dirName}` }], singleFlow: true }
        }
      })
    } catch {
      return []
    }
  }, [])

  // Create flow state lives in CommandPalette's CreateDialog now —
  // we just dispatch a `storyboard:create-artifact` event.

  async function loadStories() {
    try {
      const res = await fetch(getApiUrl() + '/stories')
      if (res.ok) {
        const d = await res.json()
        setStories(d.stories || [])
      }
    } catch { /* ignore */ }
    setStoriesLoaded(true)
  }

  // Load stories when menu opens (deferred to next tick to avoid sync setState in effect)
  useEffect(() => {
    if (!menuOpen) return
    const id = setTimeout(() => { void loadStories() }, 0)
    return () => clearTimeout(id)
  }, [menuOpen])

  // Focus first menu item when dropdown opens on menu view
  useEffect(() => {
    if (menuOpen && view === 'menu') {
      requestAnimationFrame(() => {
        const item = document.querySelector('[data-bits-dropdown-menu-content] [data-bits-dropdown-menu-item]:not([data-disabled])')
        item?.focus()
      })
    }
  }, [menuOpen, view])

  // Reset expanded prototype list when menu closes
  useEffect(() => {
    if (!menuOpen && view === 'menu') {
      requestAnimationFrame(() => setExpandedProtos(new Set()))
    }
  }, [menuOpen, view])

  function addWidget(type, props) {
    document.dispatchEvent(new CustomEvent('storyboard:canvas:add-widget', {
      detail: { type, canvasName, props }
    }))
    setMenuOpen(false)
  }

  function addStoryWidget(story) {
    const exports = Array.isArray(story?.exports) ? story.exports : []
    if (exports.length > 1) {
      addWidget('component-set', { storyId: story.name, layout: 'auto', selected: '' })
      return
    }
    document.dispatchEvent(new CustomEvent('storyboard:canvas:add-story-widget', {
      detail: { storyId: story.name, canvasName }
    }))
    setMenuOpen(false)
  }

  function addPrototypeWidget(route) {
    addWidget('prototype', { src: route })
  }

  function showCreateProtoForm() {
    setMenuOpen(false)
    document.dispatchEvent(new CustomEvent('storyboard:create-artifact', { detail: { type: 'Prototype' } }))
  }

  function handleOpenChange(open) {
    setMenuOpen(open)
    if (!open && view !== 'menu') {
      setView('menu')
    }
  }

  return (
    <DropdownMenu.Root open={menuOpen} onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <TriggerButton
          active={menuOpen}
          size="icon-xl"
          aria-label={config.ariaLabel || 'Add widget'}
          tabIndex={tabindex}
        >
          {config.icon ? (
            <Icon name={config.icon} size={16} {...(config.meta || {})} />
          ) : '+'}
        </TriggerButton>
      </DropdownMenu.Trigger>

      <DropdownMenu.Content
        side="top"
        align="start"
        sideOffset={16}
        className="min-w-[180px]"
        style={config.menuWidth ? { width: config.menuWidth } : undefined}
        onInteractOutside={undefined}
      >
        {view === 'menu' && (
          <>
            <DropdownMenu.Label>Add to canvas</DropdownMenu.Label>
            {widgetTypes.filter((wt) => !wt.flag || getFlag(wt.flag)).map((wt) => (
              <DropdownMenu.Item key={wt.type} onClick={() => {
                if (wt.action === 'open-file-picker') {
                  setMenuOpen(false)
                  document.dispatchEvent(new CustomEvent('storyboard:canvas:open-file-picker', { detail: {} }))
                } else {
                  addWidget(wt.type)
                }
              }}>
                {wt.label}
              </DropdownMenu.Item>
            ))}

            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger>
                Prototype
              </DropdownMenu.SubTrigger>
              <DropdownMenu.SubContent
                className="min-w-[260px]"
                onOpenAutoFocus={(e) => {
                  e.preventDefault()
                }}
              >
                <SearchableList
                  items={prototypeItems}
                  loading={false}
                  filterFn={(proto, q) =>
                    proto.name.toLowerCase().includes(q) ||
                    proto.flows.some((f) => f.name.toLowerCase().includes(q))
                  }
                  renderItem={(proto) => {
                    const hasMultipleFlows = !proto.singleFlow && proto.flows.length > 1
                    const isExpanded = expandedProtos.has(proto.dirName)
                    const isFiltering = prototypeSearchRef.current?.value?.trim().length > 0
                    const showFlows = hasMultipleFlows && (isExpanded || isFiltering)

                    return (
                      <div key={proto.dirName}>
                        <DropdownMenu.Item
                          onSelect={(e) => {
                            if (hasMultipleFlows) {
                              e.preventDefault()
                              setExpandedProtos((prev) => {
                                const next = new Set(prev)
                                if (next.has(proto.dirName)) next.delete(proto.dirName)
                                else next.add(proto.dirName)
                                return next
                              })
                            } else {
                              addPrototypeWidget(proto.flows[0]?.route || `/${proto.dirName}`)
                            }
                          }}
                        >
                          <span className="flex items-center justify-between w-full">
                            <span>{proto.name}</span>
                            {hasMultipleFlows && (
                              <ChevronRight style={{
                                marginLeft: 'auto',
                                transition: 'transform 0.15s',
                                transform: showFlows ? 'rotate(90deg)' : 'none',
                              }} />
                            )}
                          </span>
                        </DropdownMenu.Item>
                        {showFlows && proto.flows.map((flow) => (
                          <DropdownMenu.Item
                            key={flow.route}
                            onSelect={() => addPrototypeWidget(flow.route)}
                            className="text-muted-foreground text-xs"
                          >
                            {flow.name}
                          </DropdownMenu.Item>
                        ))}
                      </div>
                    )
                  }}
                  placeholder="Filter prototypes…"
                  emptyMessage="No prototypes found"
                  listClassName="max-h-[300px]"
                  inputRef={prototypeSearchRef}
                  header={
                    <>
                      {isTauriAvailable() && <button
                        className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground w-full text-left bg-transparent border-none"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); showCreateProtoForm() }}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <span className="font-medium">Create new prototype…</span>
                      </button>}
                      {prototypeItems.length > 0 && <DropdownMenu.Separator />}
                    </>
                  }
                />
              </DropdownMenu.SubContent>
            </DropdownMenu.Sub>

            {agents.length > 0 && (
              <>
                <DropdownMenu.Separator />
                <DropdownMenu.Label>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Icon name="agents" size={12} />
                    Agents
                  </span>
                </DropdownMenu.Label>
                {agents.map((agent) => (
                  <DropdownMenu.Item key={agent.id} onClick={() => addWidget('agent', {
                    agentId: agent.id,
                    startupCommand: agent.startupCommand,
                    ...(agent.defaultWidth ? { width: agent.defaultWidth } : {}),
                    ...(agent.defaultHeight ? { height: agent.defaultHeight } : {}),
                  })}>
                    {agent.label}
                  </DropdownMenu.Item>
                ))}
              </>
            )}

            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger>
                Component
              </DropdownMenu.SubTrigger>
              <DropdownMenu.SubContent
                className="min-w-[320px]"
                onOpenAutoFocus={(e) => {
                  e.preventDefault()
                }}
              >
                <SearchableList
                  items={stories}
                  loading={!storiesLoaded}
                  filterFn={(story, q) =>
                    story.name.toLowerCase().includes(q) ||
                    story.path.toLowerCase().includes(q)
                  }
                  renderItem={(story) => {
                    const exportCount = Array.isArray(story.exports) ? story.exports.length : 0
                    const typeLabel = exportCount > 1 ? `Component set · ${exportCount} variants` : 'Component'
                    return (
                      <DropdownMenu.Item key={story.name} onClick={() => addStoryWidget(story)}>
                        <span className="flex flex-col">
                          <span>{story.name}</span>
                          <span className="text-xs text-muted-foreground">{typeLabel}</span>
                        </span>
                      </DropdownMenu.Item>
                    )
                  }}
                  placeholder="Filter components…"
                  emptyMessage="No components found"
                  loadingMessage="Loading components…"
                  listClassName="max-h-[260px]"
                  inputRef={componentSearchRef}
                />
              </DropdownMenu.SubContent>
            </DropdownMenu.Sub>
          </>
        )}

        {/* Create flows now delegate to the unified ArtifactForm via the
            `storyboard:create-artifact` event handled by CommandPalette. */}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  )
}
