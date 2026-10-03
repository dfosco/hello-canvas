import { describe, expect, it, vi } from 'vitest'
import { runNotebookRuntimeCommand } from './notebookRuntimeCommands.js'

describe('Notebook runtime CLI/API parity', () => {
  it('maps recent to the running Core recent endpoint', async () => {
    const get = vi.fn().mockResolvedValue({ notebooks: [] })
    await expect(runNotebookRuntimeCommand(['recent'], { get })).resolves.toEqual({ notebooks: [] })
    expect(get).toHaveBeenCalledWith('/_storyboard/notebook-runtime/recent')
  })

  it('maps open path to the matching root API field', async () => {
    const post = vi.fn().mockResolvedValue({ restarting: true })
    await runNotebookRuntimeCommand(['open', 'notebook with spaces'], { post })
    expect(post).toHaveBeenCalledWith('/_storyboard/notebook-runtime/open', { root: expect.stringMatching(/notebook with spaces$/) })
  })

  it('maps close to the running Core close endpoint', async () => {
    const post = vi.fn().mockResolvedValue({ active: false, restarting: true })
    await runNotebookRuntimeCommand(['close'], { post })
    expect(post).toHaveBeenCalledWith('/_storyboard/notebook-runtime/close', {})
  })

  it('maps create title and id fields to the Core API', async () => {
    const post = vi.fn().mockResolvedValue({ restarting: true })
    await runNotebookRuntimeCommand(['create', 'new notebook', '--title', 'Research', '--id', 'research-1'], { post })
    expect(post).toHaveBeenCalledWith('/_storyboard/notebook-runtime/create', {
      root: expect.stringMatching(/new notebook$/), title: 'Research', id: 'research-1',
    })
  })

  it('rejects missing and unexpected positional arguments', async () => {
    await expect(runNotebookRuntimeCommand(['open'])).rejects.toThrow(/Usage:/)
    await expect(runNotebookRuntimeCommand(['close', 'extra'])).rejects.toThrow(/Usage:/)
  })
})
