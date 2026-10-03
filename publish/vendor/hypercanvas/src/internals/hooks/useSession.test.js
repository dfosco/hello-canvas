import { useSession } from './useSession.js'
import { useOverride } from './useOverride.js'

describe('useSession', () => {
  it('is the same function as useOverride', () => {
    expect(useSession).toBe(useOverride)
  })
})
