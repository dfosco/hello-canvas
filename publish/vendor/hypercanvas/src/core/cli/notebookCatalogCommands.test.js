import { describe, expect, it, vi } from 'vitest'
import { runNotebookCatalogCommand } from './notebookCatalogCommands.js'

describe('Notebook catalog CLI commands', () => {
  it('reads the live page catalog', async () => {
    const request = { get: vi.fn(async () => ({ pages: [] })) }
    await expect(runNotebookCatalogCommand(['pages', '--json'], request)).resolves.toEqual({ pages: [] })
    expect(request.get).toHaveBeenCalledWith('/_storyboard/notebook/pages')
  })

  it('reads the active saved navigation', async () => {
    const request = { get: vi.fn(async () => ({ navigation: {} })) }
    await runNotebookCatalogCommand(['navigation', 'read'], request)
    expect(request.get).toHaveBeenCalledWith('/_storyboard/notebook/navigation')
  })

  it('maps every guarded write field from flags to the API request', async () => {
    const request = { post: vi.fn(async (_route, body) => body) }
    const result = await runNotebookCatalogCommand([
      'navigation', 'update',
      '--notebook-id', 'nb-123',
      '--generation', '9',
      '--expected-revision', 'abc123',
      '--operation', '{"type":"setMode","mode":"files"}',
    ], request)
    expect(request.post).toHaveBeenCalledWith('/_storyboard/notebook/navigation', {
      notebookId: 'nb-123', generation: 9, expectedRevision: 'abc123',
      operation: { type: 'setMode', mode: 'files' },
    })
    expect(result.generation).toBe(9)
  })

  it('rejects missing scope or malformed operation JSON', async () => {
    await expect(runNotebookCatalogCommand(['navigation', 'update', '--operation', '{}'])).rejects.toThrow(/storyboard notebook/)
    await expect(runNotebookCatalogCommand(['navigation', 'update', '--notebook-id', 'n', '--generation', '1', '--expected-revision', 'r', '--operation', '{'])).rejects.toThrow(/valid JSON/)
  })
})
