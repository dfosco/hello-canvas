import { useState, useEffect, useCallback } from 'react'
import { TriggerButton } from '../lib/components/ui/trigger-button/index.js'
import * as DropdownMenu from '../lib/components/ui/dropdown-menu/index.js'
import Icon from './Icon.jsx'
import { getActionChildren, subscribeToCommandActions } from '../index.js'

export default function ActionMenuButton({ config = {}, data: _data, localOnly: _localOnly, tabindex = -1 }) {
  void _data
  void _localOnly
  const [menuOpen, setMenuOpen] = useState(false)
  const [_actionsVersion, setActionsVersion] = useState(0)
  void _actionsVersion

  useEffect(() => {
    const unsub = subscribeToCommandActions(() => { setActionsVersion((v) => v + 1) })
    return unsub
  }, [])

  // Allow external callers (e.g. command palette) to open this menu
  useEffect(() => {
    const actionId = config.action
    if (!actionId) return
    function onTrigger(e) {
      if (e.detail?.action === actionId) setMenuOpen(true)
    }
    window.addEventListener('storyboard:open-tool-menu', onTrigger)
    return () => window.removeEventListener('storyboard:open-tool-menu', onTrigger)
  }, [config.action])

  const children = config.action ? getActionChildren(config.action) : []
  const hasRadio = children.some((c) => c.type === 'radio')
  const activeValue = children.find((c) => c.type === 'radio' && c.active)?.id || ''

  const handleOpenChange = useCallback((open) => {
    setMenuOpen(open)
    if (open) setActionsVersion((v) => v + 1)
  }, [])

  if (children.length === 0) return null

  return (
    <DropdownMenu.Root open={menuOpen} onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger>
          <TriggerButton
            active={menuOpen}
            size="icon-xl"
            aria-label={config.ariaLabel || config.label || 'Menu'}
            tabIndex={tabindex}
          >
            <Icon name={config.icon || 'primer/gear'} size={16} {...(config.meta || {})} />
          </TriggerButton>
      </DropdownMenu.Trigger>

      <DropdownMenu.Content
        side="top"
        align="end"
        sideOffset={16}
        style={config.menuWidth ? { minWidth: config.menuWidth } : undefined}
        className={config.menuWidth ? '' : 'min-w-[200px]'}
      >
        {config.label && <DropdownMenu.Label>{config.label}</DropdownMenu.Label>}

        {hasRadio ? (
          <DropdownMenu.RadioGroup value={activeValue}>
            {children.map((child) => {
              if (child.type !== 'radio') return null
              return (
                <DropdownMenu.RadioItem
                  key={child.id || child.label}
                  value={child.id}
                  onClick={(e) => {
                    if (child.href && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault(); window.open(child.href, '_blank'); setMenuOpen(false); return
                    }
                    if (child.execute) child.execute(); setMenuOpen(false)
                  }}
                >
                  {child.label}
                </DropdownMenu.RadioItem>
              )
            })}
          </DropdownMenu.RadioGroup>
        ) : (
          children.map((child) => {
            if (child.type === 'toggle') {
              return (
                <DropdownMenu.CheckboxItem
                  key={child.id || child.label}
                  checked={child.active}
                  closeOnSelect={false}
                  onSelect={() => { if (child.execute) child.execute(); setActionsVersion((v) => v + 1) }}
                >
                  {child.label}
                </DropdownMenu.CheckboxItem>
              )
            }
            return (
              <DropdownMenu.Item
                key={child.id || child.label}
                onClick={(e) => {
                  if (child.href && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault(); window.open(child.href, '_blank'); setMenuOpen(false); return
                  }
                  if (child.execute) child.execute(); setMenuOpen(false)
                }}
              >
                {child.label}
              </DropdownMenu.Item>
            )
          })
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  )
}
