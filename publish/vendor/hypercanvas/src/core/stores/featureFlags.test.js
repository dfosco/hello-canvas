import { afterEach, expect, it } from 'vitest'
import { getAllFlags, getFlag, getFlagKeys, initFeatureFlags, setFlag, toggleFlag } from './featureFlags.js'
import { getLocal, setLocal } from '../session/localStorage.js'

afterEach(() => {
  localStorage.clear()
  initFeatureFlags()
})

it('excludes startup daemon policy from browser-local flags, including stale overrides', () => {
  setLocal('flag.usePaseoApp', 'false')
  initFeatureFlags({ usePaseoApp: true, 'live-example': true })

  expect(getLocal('flag.usePaseoApp')).toBeNull()
  expect(getFlagKeys()).not.toContain('usePaseoApp')
  expect(getAllFlags()).not.toHaveProperty('usePaseoApp')
  setFlag('usePaseoApp', true)
  toggleFlag('usePaseoApp')
  expect(getLocal('flag.usePaseoApp')).toBeNull()

  setFlag('live-example', false)
  expect(getFlag('live-example')).toBe(false)
  expect(getLocal('flag.live-example')).toBe('false')
})
