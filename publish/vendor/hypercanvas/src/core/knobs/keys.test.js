import { buildKnobKey, pascal } from './keys.js'

describe('pascal', () => {
  it('strips separators and uppercases each word', () => {
    expect(pascal('/Branding')).toBe('Branding')
    expect(pascal('show-avatar')).toBe('ShowAvatar')
    expect(pascal('theme.primary')).toBe('ThemePrimary')
  })

  it('returns an empty string for blank values', () => {
    expect(pascal('')).toBe('')
    expect(pascal(null)).toBe('')
  })
})

describe('buildKnobKey', () => {
  it('builds prototype-scoped keys', () => {
    expect(buildKnobKey('variant')).toBe('knobVariant')
  })

  it('builds route-scoped keys', () => {
    expect(buildKnobKey('variant', { route: '/Branding' })).toBe('knobBrandingVariant')
  })

  it('treats nested ids as separators', () => {
    expect(buildKnobKey('theme.primary')).toBe('knobThemePrimary')
  })
})
