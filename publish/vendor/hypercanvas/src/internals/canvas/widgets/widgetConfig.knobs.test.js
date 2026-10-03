import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerWidget,
  _resetWidgetRegistry,
} from '../../../core/stores/widgetRegistry.js'
import { getWidgetKnobs, widgetTypes } from './widgetConfig.js'

describe('getWidgetKnobs', () => {
  beforeEach(() => {
    _resetWidgetRegistry()
  })

  it('returns the declared knob schema for a widget definition', () => {
    const knobs = [
      {
        id: 'accentColor',
        type: 'color',
        label: 'Accent color',
        default: '#0969da',
      },
    ]

    registerWidget('knob-fixture', {
      label: 'Knob Fixture',
      icon: 'sparkle-fill',
      knobs,
    })

    expect(widgetTypes['knob-fixture'].knobs).toEqual(knobs)
    expect(getWidgetKnobs('knob-fixture')).toEqual(knobs)
  })

  it('returns an empty array when a widget declares no knobs', () => {
    registerWidget('without-knobs', {
      label: 'Without Knobs',
      icon: 'sparkle-fill',
    })

    expect(getWidgetKnobs('without-knobs')).toEqual([])
    expect(getWidgetKnobs('missing-widget')).toEqual([])
  })
})
