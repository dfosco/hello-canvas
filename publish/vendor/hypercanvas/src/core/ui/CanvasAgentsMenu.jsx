/**
 * CanvasAgentsMenu — CoreUIBar dropdown for adding agent widgets to the active canvas.
 * Reads agent definitions from canvas.agents config and dispatches add-widget events.
 * Only visible when a canvas page is active and agents are configured.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { TriggerButton } from '../lib/components/ui/trigger-button/index.js'
import * as DropdownMenu from '../lib/components/ui/dropdown-menu/index.js'
import Icon from './Icon.jsx'
import CanvasAgentSetupDialog from './CanvasAgentSetupDialog.jsx'
import { createHostToolsBrowserClient } from '../host-tools/browser-client.js'
import { getConfig } from '../index.js'

function availability(preflight, agentId, requestState) {
  if (requestState === 'loading' || requestState === 'idle') return { label: 'Checking...', kind: 'loading' }
  if (requestState === 'failed') return { label: 'Check failed', kind: 'failed' }
  if (preflight?.status === 'unsupported' || preflight?.support?.status === 'unsupported') {
    return { label: 'Unsupported', kind: 'unsupported' }
  }
  const tool = preflight?.agents?.[agentId]
  if (tool?.status === 'installed' && typeof tool.path === 'string' && tool.path.startsWith('/')) {
    return { label: tool.version || 'Installed', kind: 'installed' }
  }
  if (tool?.status === 'missing') return { label: 'Not installed', kind: 'missing' }
  if (tool?.status === 'failed_verification' || tool?.status === 'installed') {
    return { label: 'Verification failed', kind: 'invalid' }
  }
  if (tool?.status === 'unsupported') return { label: 'Unsupported', kind: 'unsupported' }
  return { label: 'Status unavailable', kind: 'invalid' }
}

function baselineLabel(preflight, requestState) {
  if (requestState === 'loading' || requestState === 'idle') return 'Checking host tools...'
  if (requestState === 'failed') return 'Host check failed'
  if (preflight?.status === 'unsupported') return 'Setup supports macOS Apple silicon'
  const status = preflight?.baseline?.status
  if (status === 'valid') return 'Host tools verified'
  if (status === 'outdated') return 'Host Node is outdated'
  if (status === 'partial') return 'Host Node/npm need repair'
  if (status === 'missing') return 'Host Node/npm are missing'
  return 'Host status unavailable'
}

export default function CanvasAgentsMenu({
  config = {},
  data: _data,
  canvasName = '',
  zoom: _zoom,
  tabindex,
  basePath = '/',
  hostToolsClient: providedHostToolsClient,
  pollInterval,
}) {
  void _data
  void _zoom
  const [menuOpen, setMenuOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [setupSelection, setSetupSelection] = useState([])
  const [pendingLaunchAgentId, setPendingLaunchAgentId] = useState(null)
  const [preflight, setPreflight] = useState(null)
  const [requestState, setRequestState] = useState('idle')
  const hostToolsClient = useMemo(
    () => providedHostToolsClient || createHostToolsBrowserClient({ basePath }),
    [basePath, providedHostToolsClient],
  )

  const agents = useMemo(() => {
    const canvasConfig = getConfig('canvas')
    const agentsConfig = canvasConfig?.agents
    if (!agentsConfig || typeof agentsConfig !== 'object') return []
    return Object.entries(agentsConfig).map(([id, cfg]) => ({
      id,
      label: cfg.label || id,
      icon: cfg.icon,
      startupCommand: cfg.startupCommand || id,
      defaultWidth: cfg.defaultWidth,
      defaultHeight: cfg.defaultHeight,
    }))
  }, [])

  const loadPreflight = useCallback(async () => {
    setRequestState('loading')
    try {
      const snapshot = await hostToolsClient.preflight()
      setPreflight(snapshot)
      setRequestState('ready')
    } catch {
      setPreflight(null)
      setRequestState('failed')
    }
  }, [hostToolsClient])

  useEffect(() => {
    if (!menuOpen) return
    let active = true
    hostToolsClient.preflight().then((snapshot) => {
      if (!active) return
      setPreflight(snapshot)
      setRequestState('ready')
    }).catch(() => {
      if (!active) return
      setPreflight(null)
      setRequestState('failed')
    })
    return () => { active = false }
  }, [hostToolsClient, menuOpen])

  function addAgent(agent) {
    document.dispatchEvent(new CustomEvent('storyboard:canvas:add-widget', {
      detail: {
        type: 'agent',
        canvasName,
        props: {
          agentId: agent.id,
          startupCommand: agent.startupCommand,
          ...(agent.defaultWidth ? { width: agent.defaultWidth } : {}),
          ...(agent.defaultHeight ? { height: agent.defaultHeight } : {}),
        },
      }
    }))
    setMenuOpen(false)
  }

  function openSetup(agentId = null) {
    setSetupSelection(agentId ? [agentId] : [])
    setPendingLaunchAgentId(agentId)
    setMenuOpen(false)
    setSetupOpen(true)
  }

  function changeMenuOpen(nextOpen) {
    if (nextOpen) setRequestState('loading')
    setMenuOpen(nextOpen)
  }

  function selectAgent(agent) {
    const state = availability(preflight, agent.id, requestState)
    if (state.kind === 'installed') addAgent(agent)
    else if (state.kind === 'missing' || state.kind === 'invalid') openSetup(agent.id)
  }

  function continueAgent(agentId) {
    const agent = agents.find((entry) => entry.id === agentId)
    if (!agent) return
    setSetupOpen(false)
    addAgent(agent)
  }

  if (agents.length === 0) return null

  return (
    <>
      {!setupOpen && <DropdownMenu.Root open={menuOpen} onOpenChange={changeMenuOpen}>
        <DropdownMenu.Trigger asChild>
          <TriggerButton
            active={menuOpen}
            size="icon-xl"
            aria-label={config.ariaLabel || 'Add agent'}
            tabIndex={tabindex}
          >
            {config.icon ? (
              <Icon name={config.icon} size={16} {...(config.meta || {})} />
            ) : (
              <Icon name="agents" size={16} />
            )}
          </TriggerButton>
        </DropdownMenu.Trigger>

        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={16}
          className="min-w-[240px]"
        >
          <DropdownMenu.Label>Add agent</DropdownMenu.Label>
          {agents.map((agent) => {
            const state = availability(preflight, agent.id, requestState)
            const disabled = state.kind === 'loading' || state.kind === 'failed' || state.kind === 'unsupported'
            return (
              <DropdownMenu.Item key={agent.id} disabled={disabled} onClick={() => selectAgent(agent)}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, width: '100%' }}>
                  <Icon name={agent.icon || 'agents'} size={16} />
                  <span style={{ flex: 1 }}>{agent.label}</span>
                  <span style={{ color: 'var(--color-foreground-muted)', fontSize: '11px' }}>{state.label}</span>
                </span>
              </DropdownMenu.Item>
            )
          })}
          <DropdownMenu.Separator />
          <DropdownMenu.Item onClick={() => openSetup()}>Manage Agent CLIs...</DropdownMenu.Item>
          {requestState === 'failed' && (
            <DropdownMenu.Item closeOnSelect={false} onClick={loadPreflight}>Retry host check</DropdownMenu.Item>
          )}
          <DropdownMenu.Separator />
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {baselineLabel(preflight, requestState)}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Root>}

      <CanvasAgentSetupDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        initialSelectedAgentIds={setupSelection}
        pendingLaunchAgentId={pendingLaunchAgentId}
        preflight={preflight}
        onPreflight={(snapshot) => {
          setPreflight(snapshot)
          setRequestState('ready')
        }}
        onAgentReady={continueAgent}
        client={hostToolsClient}
        pollInterval={pollInterval}
      />
    </>
  )
}
