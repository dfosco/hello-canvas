import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { validateDirectory } from './DirectoryPicker.jsx'
import { invoke } from '../../core/notebook/tauri-bridge.js'
import DirectoryPicker from './DirectoryPicker.jsx'

vi.mock('../../core/notebook/tauri-bridge.js', () => ({ invoke: vi.fn(), isTauriAvailable: () => true }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

it('rejects both Notebook and Site directory registrations', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => String(url).includes('notebook-runtime/recent')
    ? { ok: true, json: async () => ({ notebooks: [{ root: '/projects/notebook' }] }) }
    : { ok: true, json: async () => ({ sites: [{ id: 'site', binding: { root: '/projects/site' } }] }) }))
  await expect(validateDirectory('/projects/notebook/')).rejects.toThrow('Notebook')
  await expect(validateDirectory('/projects/site')).rejects.toThrow('Site')
  await expect(validateDirectory('/projects/site', { excludeSiteId: 'site' })).resolves.toBeUndefined()
})

it('uses the Core/FS bridge directory picker and validates the chosen path', async () => {
  vi.mocked(invoke).mockResolvedValue('/projects/new-notebook')
  vi.stubGlobal('fetch', vi.fn(async url => String(url).includes('notebook-runtime/recent')
    ? { ok: true, json: async () => ({ notebooks: [] }) }
    : { ok: true, json: async () => ({ sites: [] }) }))
  const onChange = vi.fn()
  render(<DirectoryPicker onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: 'Select folder' }))
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('/projects/new-notebook'))
  expect(invoke).toHaveBeenCalledWith('pick_notebook_folder')
})

it('allows a missing recent Notebook folder to be selected again for recovery', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => String(url).includes('notebook-runtime/recent')
    ? { ok: true, json: async () => ({ notebooks: [{ root: '/projects/restored', available: false }] }) }
    : { ok: true, json: async () => ({ sites: [] }) }))
  await expect(validateDirectory('/projects/restored')).resolves.toBeUndefined()
})
