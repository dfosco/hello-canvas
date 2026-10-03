import { initKnobs, getPrototypeKnobs, getComponentKnobs, resolveKnobDef } from './discovery.js'

beforeEach(() => {
  initKnobs()
})

describe('knob discovery', () => {
  it('reads and flattens prototype knobs from prototype meta', () => {
    initKnobs({
      prototypeKnobs: {
        Signup: {
          meta: {
            knobs: [
              { id: 'variant', type: 'select', options: ['small', 'large'] },
              {
                id: 'theme',
                type: 'object',
                knobs: [{ id: 'primary', type: 'text' }],
              },
            ],
          },
        },
      },
    })

    expect(getPrototypeKnobs('Signup').map(def => def.id)).toEqual([
      'variant',
      'theme',
      'theme.primary',
    ])
  })

  it('reads component knobs from top-level component config', () => {
    initKnobs({
      componentKnobs: {
        Button: {
          knobs: [{ id: 'size', type: 'radio', options: ['sm', 'lg'] }],
        },
      },
    })

    expect(getComponentKnobs('Button')).toEqual([
      { id: 'size', type: 'radio', options: ['sm', 'lg'] },
    ])
  })

  it('resolves matching unscoped and route-scoped definitions', () => {
    const knobs = [
      { id: 'variant', type: 'text' },
      { id: 'variant', type: 'select', scope: '/Branding', options: ['hero'] },
    ]

    expect(resolveKnobDef('variant', { knobs })?.type).toBe('text')
    expect(resolveKnobDef('variant', { route: '/Branding', knobs })?.type).toBe('select')
    expect(resolveKnobDef('variant', { route: '/Other', knobs })).toBeUndefined()
  })

  it('inherits object scope for nested child knobs', () => {
    const knobs = [{
      id: 'theme',
      type: 'object',
      scope: '/Branding',
      knobs: [{ id: 'primary', type: 'text' }],
    }]

    const def = resolveKnobDef('theme.primary', { route: '/Branding', knobs })
    expect(def).toMatchObject({ id: 'theme.primary', type: 'text', scope: '/Branding' })
  })

  it('preserves knobMeta through flatten + registry round-trip', () => {
    initKnobs({
      prototypeKnobs: {
        Signup: {
          meta: {
            knobs: [
              {
                id: 'view',
                type: 'select',
                options: ['a', 'b'],
                knobMeta: { color: '#ff8800' },
              },
            ],
          },
        },
      },
    })

    const [def] = getPrototypeKnobs('Signup')
    expect(def.knobMeta).toEqual({ color: '#ff8800' })
  })
})
