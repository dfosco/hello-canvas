import { describe, expect, it, vi } from 'vitest'
import { runSystemCommand } from './system.js'

describe('Core system CLI mapping', () => {
  it.each(['select-directory', 'select-file', 'import-file'])('maps %s to its Core API route', async (operation) => {
    const post = vi.fn().mockResolvedValue({ path: '/tmp/selected' })
    await expect(runSystemCommand([operation], { post })).resolves.toEqual({ path: '/tmp/selected' })
    expect(post).toHaveBeenCalledWith(`/_storyboard/system/${operation}`, {})
  })

  it('maps an explicit directory purpose into the Core picker request', async () => {
    const post = vi.fn().mockResolvedValue({ path: '/tmp/site' })
    await expect(runSystemCommand(['select-directory', '--purpose', 'site'], { post })).resolves.toEqual({ path: '/tmp/site' })
    expect(post).toHaveBeenCalledWith('/_storyboard/system/select-directory', { purpose: 'site' })
  })

  it('maps diagnostics to the Core snapshot route', async () => {
    const get = vi.fn().mockResolvedValue({ core: { pid: 42 } })
    await expect(runSystemCommand(['diagnostics'], { get })).resolves.toEqual({ core: { pid: 42 } })
    expect(get).toHaveBeenCalledWith('/_storyboard/diagnostics')
  })

  it('rejects unsupported directory purposes', async () => {
    await expect(runSystemCommand(['select-directory', '--purpose', 'global'], { post: vi.fn() }))
      .rejects.toThrow(/Usage: storyboard system/)
  })
})
