import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  registerWidget,
  _resetWidgetRegistry,
} from '../../../core/stores/widgetRegistry.js'
import { initFeatureFlags, resetFlags, setFlag, getFlag } from '../../../core/stores/featureFlags.js'
import {
  getWidgetMeta,
  isResizable,
  isExpandable,
  isMovable,
  isSplitScreenCapable,
  getInteractGate,
  getMenuWidgetTypes,
  isWidgetFlagEnabled,
  getChromeOptions,
  getInteractionOptions,
  getFeatures,
  getConnectorConfig,
  schemas,
} from './widgetConfig.js'

describe('widgetConfig — merged consumer + built-in registry', () => {
  beforeEach(() => {
    _resetWidgetRegistry()
  })

  it('falls back to built-in widgets when nothing registered', () => {
    expect(getWidgetMeta('sticky-note')?.label).toBeTruthy()
    expect(getChromeOptions('sticky-note').enabled).toBe(true)
    expect(getInteractionOptions('sticky-note').selectable).toBe(true)
    expect(getInteractionOptions('sticky-note').movable).toBe(true)
  })

  it('consumer-registered widget exposes label/icon via getWidgetMeta', () => {
    registerWidget('my-thing', { label: 'My Thing', icon: 'sparkle-fill' })
    expect(getWidgetMeta('my-thing')).toEqual({ label: 'My Thing', icon: 'sparkle-fill' })
  })

  it('chrome.enabled defaults to true, overrideable to false', () => {
    registerWidget('invisible', { label: 'Invisible', chrome: { enabled: false } })
    expect(getChromeOptions('invisible').enabled).toBe(false)
    registerWidget('visible', { label: 'Visible', chrome: { enabled: true } })
    expect(getChromeOptions('visible').enabled).toBe(true)
    registerWidget('default', { label: 'Default' })
    expect(getChromeOptions('default').enabled).toBe(true)
  })

  it('interaction.selectable/movable default to true, overrideable to false', () => {
    registerWidget('pinned', { label: 'Pinned', interaction: { movable: false } })
    expect(getInteractionOptions('pinned').movable).toBe(false)
    expect(getInteractionOptions('pinned').selectable).toBe(true)

    registerWidget('decorative', { label: 'Deco', interaction: { selectable: false } })
    expect(getInteractionOptions('decorative').selectable).toBe(false)
    expect(getInteractionOptions('decorative').movable).toBe(true)
  })

  it('isMovable() returns dev-only for the boolean shape (back-compat)', () => {
    // Default sticky-note has no interaction.movable → boolean true semantic.
    // Vitest runs in dev mode by default (import.meta.env.PROD = false),
    // so isMovable returns true.
    expect(isMovable('sticky-note')).toBe(true)
    registerWidget('locked', { label: 'Locked', interaction: { movable: false } })
    expect(isMovable('locked')).toBe(false)
  })

  it('isMovable() honors the { enabled, prod } object shape', () => {
    registerWidget('alwaysDraggable', {
      label: 'Always',
      interaction: { movable: { enabled: true, prod: true } },
    })
    // enabled: true → movable in dev (PROD branch is irrelevant under vitest)
    expect(isMovable('alwaysDraggable')).toBe(true)
    // Object form is preserved on getInteractionOptions for downstream readers
    expect(getInteractionOptions('alwaysDraggable').movable).toEqual({ enabled: true, prod: true })

    registerWidget('explicitlyOff', {
      label: 'Off',
      interaction: { movable: { enabled: false } },
    })
    expect(isMovable('explicitlyOff')).toBe(false)
  })

  it('interaction.resize/expandable/splitScreen flow through to legacy getters', () => {
    registerWidget('big', {
      label: 'Big',
      interaction: {
        resize: { enabled: true, prod: true },
        expandable: true,
        splitScreen: true,
        interactGate: true,
        interactGateLabel: 'Tap to interact',
      },
    })
    expect(isResizable('big')).toBe(true)
    expect(isExpandable('big')).toBe(true)
    expect(isSplitScreenCapable('big')).toBe(true)
    expect(getInteractGate('big')).toEqual({ enabled: true, label: 'Tap to interact' })
  })

  it('legacy top-level keys still work as back-compat (widgets.config.json shape)', () => {
    // No nested `interaction` block — the widgets.config.json baseline
    // should keep working when consumer omits the block.
    registerWidget('legacy', {
      label: 'Legacy',
      resize: { enabled: true, prod: false },
      expandable: true,
      splitScreen: true,
      interactGate: true,
      interactGateLabel: 'Old gate',
    })
    expect(isResizable('legacy')).toBe(true)
    expect(isExpandable('legacy')).toBe(true)
    expect(isSplitScreenCapable('legacy')).toBe(true)
    expect(getInteractGate('legacy').enabled).toBe(true)
    expect(getInteractGate('legacy').label).toBe('Old gate')
  })

  it('getMenuWidgetTypes includes consumer entries and excludes unlisted', () => {
    registerWidget('shown', { label: 'Shown', icon: 'star' })
    registerWidget('hidden', { label: 'Hidden', unlisted: true })
    const types = getMenuWidgetTypes()
    expect(types.some((t) => t.type === 'shown')).toBe(true)
    expect(types.some((t) => t.type === 'hidden')).toBe(false)
  })

  it('getMenuWidgetTypes excludes unflagged-off widgets and includes them once enabled', () => {
    registerWidget('gated', { label: 'Gated', icon: 'star', flag: 'gated-widget' })
    registerWidget('open', { label: 'Open', icon: 'star' })
    initFeatureFlags()
    try {
      expect(getFlag('gated-widget')).toBe(false)
      expect(isWidgetFlagEnabled('gated')).toBe(false)
      expect(isWidgetFlagEnabled('open')).toBe(true)
      let types = getMenuWidgetTypes()
      expect(types.some((t) => t.type === 'gated')).toBe(false)
      expect(types.some((t) => t.type === 'open')).toBe(true)

      setFlag('gated-widget', true)
      expect(isWidgetFlagEnabled('gated')).toBe(true)
      types = getMenuWidgetTypes()
      expect(types.some((t) => t.type === 'gated')).toBe(true)
    } finally {
      resetFlags()
    }
  })

  it('builtin Prompt and Agent Chat widgets are hidden by default and enabled by their flags', () => {
    initFeatureFlags()
    try {
      expect(getFlag('prompt-widget')).toBe(false)
      expect(getFlag('agent-chat-widget')).toBe(false)
      expect(isWidgetFlagEnabled('prompt')).toBe(false)
      expect(isWidgetFlagEnabled('agent-chat')).toBe(false)
      expect(getMenuWidgetTypes().some((t) => t.type === 'prompt')).toBe(false)
      expect(getMenuWidgetTypes().some((t) => t.type === 'agent-chat')).toBe(false)

      setFlag('prompt-widget', true)
      setFlag('agent-chat-widget', true)
      expect(isWidgetFlagEnabled('prompt')).toBe(true)
      expect(isWidgetFlagEnabled('agent-chat')).toBe(true)
      expect(getMenuWidgetTypes().some((t) => t.type === 'prompt')).toBe(true)
      expect(getMenuWidgetTypes().some((t) => t.type === 'agent-chat')).toBe(true)
    } finally {
      resetFlags()
    }
  })

  it('consumer features flow through getFeatures', () => {
    registerWidget('withFeat', {
      label: 'With',
      features: [
        { id: 'foo', type: 'action', action: 'foo', label: 'Foo', icon: 'star', prod: true },
      ],
    })
    const feats = getFeatures('withFeat', { isLocalDev: true })
    expect(feats.length).toBe(1)
    expect(feats[0].action).toBe('foo')
  })

  it('consumer connector config flows through getConnectorConfig', () => {
    registerWidget('lockedConn', {
      label: 'Locked',
      connectors: { anchors: { top: 'unavailable', bottom: 'disabled', left: 'available', right: 'available' }, accept: ['sticky-note'] },
    })
    const cfg = getConnectorConfig('lockedConn')
    expect(cfg.anchors.top).toBe('unavailable')
    expect(cfg.anchors.bottom).toBe('disabled')
    expect(cfg.accept).toEqual(['sticky-note'])
  })

  it('consumer schemas are exposed via the schemas proxy', () => {
    registerWidget('withProps', {
      label: 'WithProps',
      props: {
        title: { type: 'text', label: 'Title', default: 'Hi' },
        width: { type: 'number', label: 'Width', default: 320 },
      },
    })
    expect(schemas['withProps']).toEqual({
      title: { type: 'text', label: 'Title', category: undefined, defaultValue: 'Hi' },
      width: { type: 'number', label: 'Width', category: undefined, defaultValue: 320 },
    })
  })

  it('consumer registration overrides core widget for same type', () => {
    // sticky-note is movable by default
    expect(getInteractionOptions('sticky-note').movable).toBe(true)
    registerWidget('sticky-note', { label: 'Sticky', interaction: { movable: false } })
    expect(getInteractionOptions('sticky-note').movable).toBe(false)
    // After unregister via re-init the core entry returns
    vi.clearAllMocks()
  })
})
