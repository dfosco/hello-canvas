import { useState, useEffect } from 'react'
import { TriggerButton } from '../lib/components/ui/trigger-button/index.js'
import * as DropdownMenu from '../lib/components/ui/dropdown-menu/index.js'
import Icon from './Icon.jsx'
import {
  themeState, setTheme, getTheme,
  surfaceSyncState, getSurfaceSync, setSurfaceSync,
} from '../index.js'
import { getConfig, subscribeToConfig } from '../stores/configStore.js'

export default function ThemeMenuButton({ config = {}, data: _data, localOnly: _localOnly, tabindex = -1 }) {
  void _data
  void _localOnly
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [canvasActive, setCanvasActive] = useState(false)
  const [theme, setThemeState] = useState(getTheme)
  const [syncState, setSyncState] = useState(getSurfaceSync)
  const [themesCfg, setThemesCfg] = useState(() => getConfig('theming') || {})

  useEffect(() => {
    const unsub = themeState.subscribe(s => setThemeState(s.theme))
    return unsub
  }, [])

  useEffect(() => {
    const unsub = surfaceSyncState.subscribe(s => setSyncState({ ...s }))
    return unsub
  }, [])

  useEffect(() => {
    // Re-derive registry on config HMR (e.g. user edits storyboard.config.json)
    const unsub = subscribeToConfig(() => setThemesCfg(getConfig('theming') || {}))
    return unsub
  }, [])

  useEffect(() => {
    function handleCanvasMounted() { setCanvasActive(true) }
    function handleCanvasUnmounted() { setCanvasActive(false) }
    function handleOpenSettings() {
      setMenuOpen(true)
      setSettingsOpen(true)
    }
    document.addEventListener('storyboard:canvas:mounted', handleCanvasMounted)
    document.addEventListener('storyboard:canvas:unmounted', handleCanvasUnmounted)
    document.addEventListener('storyboard:open-theme-settings', handleOpenSettings)

    const state = window.__storyboardCanvasBridgeState
    const active = state?.active === true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCanvasActive(active)
    if (!active) {
      document.dispatchEvent(new CustomEvent('storyboard:canvas:status-request'))
    }

    return () => {
      document.removeEventListener('storyboard:canvas:mounted', handleCanvasMounted)
      document.removeEventListener('storyboard:canvas:unmounted', handleCanvasUnmounted)
      document.removeEventListener('storyboard:open-theme-settings', handleOpenSettings)
    }
  }, [])

  function handleMenuOpenChange(open) {
    setMenuOpen(open)
    if (!open) setSettingsOpen(false)
  }

  function handleSelect(value) {
    setTheme(value)
    setMenuOpen(false)
  }

  function handleSyncToggle(e, target) {
    e.preventDefault()
    setSurfaceSync(target, !syncState[target])
  }

  // Theme list — config-driven. "system" is a synthetic top entry not in
  // the registry; surface it explicitly above the configured themes.
  const themeEntries = Object.entries(themesCfg.themes || {})
  const themeOptions = [
    { value: 'system', label: 'System' },
    ...themeEntries.map(([value, def]) => ({ value, label: def?.label || value })),
  ]

  // Surface list — config-driven. The "Apply theme to" sub-menu renders one
  // checkbox per configured surface. The Canvas↔Prototype swap stays —
  // when a canvas is mounted we show Canvas instead of Prototype so the
  // user only sees the surface they're currently looking at.
  const surfaces = themesCfg.surfaces || {}
  const surfaceIds = Object.keys(surfaces)
  const canvasShown = canvasActive && surfaceIds.includes('canvas')
  const visibleSurfaces = surfaceIds.filter((id) => {
    if (id === 'canvas') return canvasShown
    if (id === 'prototype') return !canvasShown
    return true
  })

  return (
    <DropdownMenu.Root open={menuOpen} onOpenChange={handleMenuOpenChange}>
      <DropdownMenu.Trigger>
          <TriggerButton
            active={menuOpen}
            size="icon-xl"
            aria-label={config.ariaLabel || 'Theme'}
            tabIndex={tabindex}
          >
            <Icon name={config.icon || 'primer/sun'} size={16} {...(config.meta || {})} />
          </TriggerButton>
      </DropdownMenu.Trigger>

      <DropdownMenu.Content
        side="top"
        align="end"
        sideOffset={16}
        style={config.menuWidth ? { minWidth: config.menuWidth } : undefined}
        className="min-w-[200px]"
      >
        {config.label && <DropdownMenu.Label>{config.label}</DropdownMenu.Label>}

        <DropdownMenu.RadioGroup value={theme}>
          {themeOptions.map((option) => (
            <DropdownMenu.RadioItem
              key={option.value}
              value={option.value}
              onClick={() => handleSelect(option.value)}
            >
              {option.label}
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>

        <DropdownMenu.Separator />

        <DropdownMenu.Sub open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DropdownMenu.SubTrigger>Theme settings</DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent className="min-w-[180px]">
            <DropdownMenu.Label>Apply theme to</DropdownMenu.Label>
            {visibleSurfaces.map((id) => (
              <DropdownMenu.CheckboxItem
                key={id}
                checked={!!syncState[id]}
                onSelect={(e) => handleSyncToggle(e, id)}
              >
                {surfaces[id]?.label || id}
              </DropdownMenu.CheckboxItem>
            ))}
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  )
}

