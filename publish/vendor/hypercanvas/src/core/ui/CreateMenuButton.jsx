import { useState, useMemo } from 'react'
import { TriggerButton } from '../lib/components/ui/trigger-button/index.js'
import * as DropdownMenu from '../lib/components/ui/dropdown-menu/index.js'
import Icon from './Icon.jsx'
import { isExcludedByRoute } from '../index.js'
import { isTauriAvailable } from '../notebook/tauri-bridge.js'

const CREATE_TYPES = { createCanvas: 'Canvas', createPrototype: 'Prototype', createSite: 'Site' }
const VISIBLE_TYPES = new Set(Object.values(CREATE_TYPES))

export default function CreateMenuButton({ features: featuresProp = [], data, config = { label: 'Create' }, localOnly: _localOnly, tabindex }) {
  const features = featuresProp.length > 0 ? featuresProp : (data?.features || [])
  void _localOnly
  const menuWidth = config.menuWidth || null

  const [menuOpen, setMenuOpen] = useState(false)

  const featuresByName = useMemo(
    () => Object.fromEntries(features.map((f) => [f.name, f])),
    [features],
  )

  const resolvedActions = useMemo(() => {
    const actions = config.actions
    if (!Array.isArray(actions)) {
      return [
        { type: 'header', label: config.label, _key: 'header' },
        ...features.filter(f => CREATE_TYPES[f.name]).map((f) => ({ type: 'default', label: f.label, artifactType: CREATE_TYPES[f.name], _key: f.overlayId })),
      ]
    }
    return actions
      .map((a, i) => {
        if (a.feature) {
          const feat = featuresByName[a.feature]
          const artifactType = a.artifactType || CREATE_TYPES[a.feature]
          if (!VISIBLE_TYPES.has(artifactType) || (a.feature && !feat && !a.artifactType)) return null
          return { ...a, artifactType, _key: a.id || `action-${i}` }
        }
        return { ...a, _key: a.id || `${a.type}-${i}` }
      })
      .filter(Boolean)
  }, [config, features, featuresByName])

  function showCreateDialog(action) {
    setMenuOpen(false)
    document.dispatchEvent(new CustomEvent('storyboard:create-artifact', { detail: { type: action.artifactType } }))
  }

  if (!isTauriAvailable()) return null

  return (
    <>
      <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger>
            <TriggerButton
              active={menuOpen}
              size="icon-xl"
              aria-label={config.ariaLabel || config.label}
              tabIndex={tabindex}
            >
              {config.icon ? (
                <Icon name={config.icon} size={16} {...(config.meta || {})} />
              ) : config.character ? (
                config.character
              ) : (
                '+'
              )}
            </TriggerButton>
        </DropdownMenu.Trigger>

        <DropdownMenu.Content
          side="top"
          align="end"
          sideOffset={16}
          className="min-w-[180px]"
          style={menuWidth ? { width: menuWidth } : undefined}
        >
          {resolvedActions.map((action) => {
            if (isExcludedByRoute(action)) return null
            if (action.type === 'header') {
              return <DropdownMenu.Label key={action._key}>{action.label}</DropdownMenu.Label>
            }
            if (action.type === 'separator') {
              return <DropdownMenu.Separator key={action._key} />
            }
            if (action.artifactType) {
              return (
                <DropdownMenu.Item key={action._key} onClick={() => showCreateDialog(action)}>
                  {action.label || action.artifactType}
                </DropdownMenu.Item>
              )
            }
            return null
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </>
  )
}
