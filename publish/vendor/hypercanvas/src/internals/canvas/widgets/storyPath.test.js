import { describe, it, expect, vi, beforeEach } from 'vitest'

// Reset module between tests so the module-level cache is cleared
beforeEach(() => {
  vi.resetModules()
})

describe('getStoryPathByName', () => {
  it('returns the path for a known story name', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        stories: [
          { name: 'Button', path: 'src/components/Button/button.story.jsx' },
          { name: 'TextInput', path: 'src/components/TextInput/textInput.story.jsx' },
        ],
      }),
    })

    const { getStoryPathByName } = await import('./storyPath.js')
    await expect(getStoryPathByName('Button')).resolves.toBe('src/components/Button/button.story.jsx')
    await expect(getStoryPathByName('TextInput')).resolves.toBe('src/components/TextInput/textInput.story.jsx')
  })

  it('returns null for an unknown story name', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ stories: [{ name: 'Button', path: 'src/components/Button/button.story.jsx' }] }),
    })

    const { getStoryPathByName } = await import('./storyPath.js')
    await expect(getStoryPathByName('Unknown')).resolves.toBeNull()
  })

  it('returns null when the fetch fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'))

    const { getStoryPathByName } = await import('./storyPath.js')
    await expect(getStoryPathByName('Button')).resolves.toBeNull()
  })

  it('returns null when stories array is missing', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({}),
    })

    const { getStoryPathByName } = await import('./storyPath.js')
    await expect(getStoryPathByName('Button')).resolves.toBeNull()
  })

  it('fetches the endpoint only once across multiple calls', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ stories: [{ name: 'Button', path: 'src/components/Button/button.story.jsx' }] }),
    })

    const { getStoryPathByName } = await import('./storyPath.js')
    await getStoryPathByName('Button')
    await getStoryPathByName('Button')
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})
