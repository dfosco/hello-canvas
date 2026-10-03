import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_KNOB_COLOR,
  installKnobsHighlight,
  resolveKnobColor,
  uninstallKnobsHighlight,
} from './highlight.js'
import { initKnobs } from './discovery.js'
import { openKnobsPanel, closeKnobsPanel } from '../ui/knobsPanelState.js'

describe('resolveKnobColor', () => {
  it('returns the default Primer blue when knobMeta is missing', () => {
    expect(resolveKnobColor({ id: 'foo' })).toBe(DEFAULT_KNOB_COLOR)
    expect(resolveKnobColor({ id: 'foo', knobMeta: {} })).toBe(DEFAULT_KNOB_COLOR)
    expect(resolveKnobColor(null)).toBe(DEFAULT_KNOB_COLOR)
  })

  it('returns valid hex colors as-is (trimmed)', () => {
    expect(resolveKnobColor({ knobMeta: { color: '#ff8800' } })).toBe('#ff8800')
    expect(resolveKnobColor({ knobMeta: { color: '  #ABC ' } })).toBe('#ABC')
    expect(resolveKnobColor({ knobMeta: { color: '#1234' } })).toBe('#1234')
    expect(resolveKnobColor({ knobMeta: { color: '#12345678' } })).toBe('#12345678')
  })

  it('falls back to default for malformed values', () => {
    expect(resolveKnobColor({ knobMeta: { color: 'red' } })).toBe(DEFAULT_KNOB_COLOR)
    expect(resolveKnobColor({ knobMeta: { color: '#xyz' } })).toBe(DEFAULT_KNOB_COLOR)
    expect(resolveKnobColor({ knobMeta: { color: 'rgb(255, 0, 0)' } })).toBe(DEFAULT_KNOB_COLOR)
    expect(resolveKnobColor({ knobMeta: { color: '#12345' } })).toBe(DEFAULT_KNOB_COLOR)
    expect(resolveKnobColor({ knobMeta: { color: 42 } })).toBe(DEFAULT_KNOB_COLOR)
  })
})

describe('installKnobsHighlight', () => {
  beforeEach(() => {
    initKnobs()
    closeKnobsPanel()
    document.documentElement.removeAttribute('data-sb-knobs-active')
    document.body.innerHTML = ''
    // Pretend we're on the "Signup" prototype route.
    history.replaceState({}, '', '/Signup/Branding')
  })

  afterEach(() => {
    uninstallKnobsHighlight()
    closeKnobsPanel()
    history.replaceState({}, '', '/')
    document.documentElement.removeAttribute('data-sb-knobs-active')
    document.body.innerHTML = ''
  })

  it('stamps gate + label + color when a matching knob has highlight: true', async () => {
    initKnobs({
      prototypeKnobs: {
        Signup: {
          meta: {
            knobs: [
              {
                id: 'view',
                type: 'select',
                label: 'View',
                options: ['a', 'b'],
                knobMeta: { highlight: true, color: '#ff8800' },
              },
            ],
          },
        },
      },
    })

    const el = document.createElement('div')
    el.setAttribute('data-knob-id', 'view')
    document.body.appendChild(el)

    installKnobsHighlight({ basePath: '/' })
    openKnobsPanel()
    // paint() is scheduled via rAF — wait one frame.
    await new Promise(resolve => requestAnimationFrame(() => resolve()))

    expect(document.documentElement.getAttribute('data-sb-knobs-active')).toBe('')
    // The CSS gate (installer-owned) — CSS keys off THIS, not data-knob-id.
    expect(el.hasAttribute('data-knob-highlight')).toBe(true)
    expect(el.style.getPropertyValue('--sb-knob-color')).toBe('#ff8800')
    expect(el.getAttribute('data-knob-label')).toBe('View')
  })

  it('falls back to the default color when knobMeta.color is absent', async () => {
    initKnobs({
      prototypeKnobs: {
        Signup: {
          meta: {
            knobs: [{ id: 'view', type: 'text', label: 'View', knobMeta: { highlight: true } }],
          },
        },
      },
    })

    const el = document.createElement('div')
    el.setAttribute('data-knob-id', 'view')
    document.body.appendChild(el)

    installKnobsHighlight({ basePath: '/' })
    openKnobsPanel()
    await new Promise(resolve => requestAnimationFrame(() => resolve()))

    expect(el.hasAttribute('data-knob-highlight')).toBe(true)
    expect(el.style.getPropertyValue('--sb-knob-color')).toBe(DEFAULT_KNOB_COLOR)
    expect(el.getAttribute('data-knob-label')).toBe('View')
  })

  it('stays silent when the knob has no knobMeta.highlight opt-in', async () => {
    initKnobs({
      prototypeKnobs: {
        Signup: {
          meta: {
            // No knobMeta at all → no opt-in.
            knobs: [{ id: 'view', type: 'text', label: 'View' }],
          },
        },
      },
    })

    const el = document.createElement('div')
    el.setAttribute('data-knob-id', 'view')
    document.body.appendChild(el)

    installKnobsHighlight({ basePath: '/' })
    openKnobsPanel()
    await new Promise(resolve => requestAnimationFrame(() => resolve()))

    // Root activates (panel IS open) — but the page element gets no gate.
    expect(document.documentElement.getAttribute('data-sb-knobs-active')).toBe('')
    expect(el.hasAttribute('data-knob-highlight')).toBe(false)
    expect(el.getAttribute('data-knob-label')).toBe(null)
    expect(el.style.getPropertyValue('--sb-knob-color')).toBe('')
  })

  it('stays silent when knobMeta is present but highlight is not true', async () => {
    initKnobs({
      prototypeKnobs: {
        Signup: {
          meta: {
            // Color present, but no `highlight: true` → still no opt-in.
            knobs: [{ id: 'view', type: 'text', label: 'View', knobMeta: { color: '#ff8800' } }],
          },
        },
      },
    })

    const el = document.createElement('div')
    el.setAttribute('data-knob-id', 'view')
    document.body.appendChild(el)

    installKnobsHighlight({ basePath: '/' })
    openKnobsPanel()
    await new Promise(resolve => requestAnimationFrame(() => resolve()))

    expect(el.hasAttribute('data-knob-highlight')).toBe(false)
  })

  it('clears stamps and root attr when the panel closes', async () => {
    initKnobs({
      prototypeKnobs: {
        Signup: { meta: { knobs: [{ id: 'view', type: 'text', label: 'View', knobMeta: { highlight: true } }] } },
      },
    })
    const el = document.createElement('div')
    el.setAttribute('data-knob-id', 'view')
    document.body.appendChild(el)

    installKnobsHighlight({ basePath: '/' })
    openKnobsPanel()
    await new Promise(resolve => requestAnimationFrame(() => resolve()))
    expect(el.hasAttribute('data-knob-highlight')).toBe(true)

    closeKnobsPanel()
    await new Promise(resolve => requestAnimationFrame(() => resolve()))

    expect(document.documentElement.hasAttribute('data-sb-knobs-active')).toBe(false)
    expect(el.hasAttribute('data-knob-highlight')).toBe(false)
    expect(el.style.getPropertyValue('--sb-knob-color')).toBe('')
    expect(el.getAttribute('data-knob-label')).toBe(null)
  })

  it('ignores `data-knob-id` values that do not match a current-prototype knob', async () => {
    initKnobs({
      prototypeKnobs: {
        Signup: { meta: { knobs: [{ id: 'view', type: 'text', knobMeta: { highlight: true } }] } },
      },
    })
    const el = document.createElement('div')
    el.setAttribute('data-knob-id', 'doesNotExist')
    document.body.appendChild(el)

    installKnobsHighlight({ basePath: '/' })
    openKnobsPanel()
    await new Promise(resolve => requestAnimationFrame(() => resolve()))

    expect(document.documentElement.getAttribute('data-sb-knobs-active')).toBe('')
    expect(el.hasAttribute('data-knob-highlight')).toBe(false)
  })

  it('activates when the URL carries ?sb_knobs=1 even with the panel closed', async () => {
    initKnobs({
      prototypeKnobs: {
        Signup: { meta: { knobs: [{ id: 'view', type: 'text', label: 'View', knobMeta: { highlight: true } }] } },
      },
    })
    const el = document.createElement('div')
    el.setAttribute('data-knob-id', 'view')
    document.body.appendChild(el)

    // Simulate the iframe context: PrototypeEmbed appended ?sb_knobs=1
    // to the iframe src when a Knobs widget was connected. Panel itself
    // is closed (it lives in the parent canvas frame).
    history.replaceState({}, '', '/Signup/Branding?sb_knobs=1')

    installKnobsHighlight({ basePath: '/' })
    await new Promise(resolve => requestAnimationFrame(() => resolve()))

    expect(document.documentElement.getAttribute('data-sb-knobs-active')).toBe('')
    expect(el.hasAttribute('data-knob-highlight')).toBe(true)
    expect(el.getAttribute('data-knob-label')).toBe('View')
  })

  it('does not outline elements that live inside the knobs panel itself', async () => {
    initKnobs({
      prototypeKnobs: {
        Signup: { meta: { knobs: [{ id: 'view', type: 'text', label: 'View', knobMeta: { highlight: true } }] } },
      },
    })

    // Simulate the toolbar Knobs panel surface: `<section data-knobs-panel>`
    // contains its own Field rendered with `data-knob-id="view"` (used by
    // hooks/tests). That row should NEVER be outlined — the highlight is
    // meant for the page's own elements.
    const panel = document.createElement('section')
    panel.setAttribute('data-knobs-panel', '')
    const panelField = document.createElement('div')
    panelField.setAttribute('data-knob-id', 'view')
    panel.appendChild(panelField)
    document.body.appendChild(panel)

    // A genuine in-page element with the same id (so the lookup succeeds).
    const pageEl = document.createElement('div')
    pageEl.setAttribute('data-knob-id', 'view')
    document.body.appendChild(pageEl)

    installKnobsHighlight({ basePath: '/' })
    openKnobsPanel()
    await new Promise(resolve => requestAnimationFrame(() => resolve()))

    // Page element gets the gate stamped:
    expect(pageEl.hasAttribute('data-knob-highlight')).toBe(true)
    expect(pageEl.getAttribute('data-knob-label')).toBe('View')

    // Panel field is left untouched:
    expect(panelField.hasAttribute('data-knob-highlight')).toBe(false)
    expect(panelField.getAttribute('data-knob-label')).toBe(null)
  })

  it('does not outline elements that live inside a canvas Knobs widget', async () => {
    initKnobs({
      prototypeKnobs: {
        Signup: { meta: { knobs: [{ id: 'view', type: 'text', label: 'View', knobMeta: { highlight: true } }] } },
      },
    })

    // Simulate the canvas Knobs widget: <article data-knobs-widget>
    // wraps a KnobsForm that ends up rendering its own data-knob-id
    // Field rows. Those rows must not be highlighted (mirror of the
    // panel skip), because the highlight overlay is meant for the
    // *page* DOM that the canvas widget controls, not the widget UI.
    // This also prevents the highlight repaint cascade from churning
    // the canvas widget's subtree while its dropdowns are open, which
    // was causing the Select popup to auto-close in 0.11.0.
    const widget = document.createElement('article')
    widget.setAttribute('data-knobs-widget', '')
    const widgetField = document.createElement('div')
    widgetField.setAttribute('data-knob-id', 'view')
    widget.appendChild(widgetField)
    document.body.appendChild(widget)

    installKnobsHighlight({ basePath: '/' })
    openKnobsPanel()
    await new Promise(resolve => requestAnimationFrame(() => resolve()))

    expect(widgetField.hasAttribute('data-knob-highlight')).toBe(false)
    expect(widgetField.getAttribute('data-knob-label')).toBe(null)
  })
})
