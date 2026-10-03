import { afterEach, expect, it, vi } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import SiteForm from './SiteForm.jsx'

vi.mock('../DirectoryPicker/DirectoryPicker.jsx', () => ({
  default: ({ onChange, label = 'Choose directory' }) => <button type="button" onClick={() => onChange('/projects/my-site')}>{label}</button>,
  directoryName: directory => directory.split('/').pop(),
  validateDirectory: vi.fn().mockResolvedValue(undefined),
}))

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

it('prefills the Site name, infers a command, and opens the new stopped Site', async () => {
  const onSaved = vi.fn()
  const fetcher = vi.fn(url => Promise.resolve(url.includes('/detect')
    ? { ok: true, json: async () => ({ detection: { findings: [
      { kind: 'start-command', value: 'pnpm run dev' },
      { kind: 'local-url', value: 'http://127.0.0.1:4173/' },
    ] } }) }
    : { ok: true, json: async () => ({ site: { id: 'my-site', binding: { status: 'stopped' } } }) }))
  vi.stubGlobal('fetch', fetcher)
  const { container, getByRole, queryByText } = render(<SiteForm onSaved={onSaved} />)
  expect(queryByText('Copy a project folder into this Notebook')).toBeNull()
  expect(container.querySelector('[data-dropzone]')).toBeNull()
  fireEvent.click(getByRole('button', { name: 'Choose external folder' }))
  await waitFor(() => expect(getByRole('textbox', { name: 'Run command' }).value).toBe('pnpm run dev'))
  expect(getByRole('textbox', { name: 'Local URL' }).value).toBe('http://127.0.0.1:4173/')
  expect(getByRole('textbox', { name: 'Site name *' }).value).toBe('My Site')
  fireEvent.change(getByRole('textbox', { name: 'Deploy URL' }), { target: { value: 'https://docs.example.com' } })
  fireEvent.change(getByRole('textbox', { name: 'Description' }), { target: { value: 'Project docs' } })
  fireEvent.click(getByRole('button', { name: 'Create Site' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'my-site' })))
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
    root: '/projects/my-site',
    title: 'My Site',
    description: 'Project docs',
    developmentBaseUrl: 'http://127.0.0.1:4173/',
    productionBaseUrl: 'https://docs.example.com',
    startCommand: 'pnpm run dev',
  })
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/file/upload'))).toBe(false)
})

it('keeps a pasted Site URL prefilled when the selected directory has no local URL finding', async () => {
  const fetcher = vi.fn(url => Promise.resolve(url.includes('/detect')
    ? { ok: true, json: async () => ({ detection: { findings: [] } }) }
    : { ok: true, json: async () => ({ site: { id: 'docs' } }) }))
  vi.stubGlobal('fetch', fetcher)
  const { getByRole } = render(<SiteForm initialValues={{ title: 'Docs', developmentBaseUrl: 'http://localhost:4188/' }} onSaved={vi.fn()} />)

  fireEvent.click(getByRole('button', { name: 'Choose external folder' }))

  await waitFor(() => expect(getByRole('textbox', { name: 'Run command' }).value).toBe('npm run dev'))
  expect(getByRole('textbox', { name: 'Site name *' }).value).toBe('Docs')
  expect(getByRole('textbox', { name: 'Local URL' }).value).toBe('http://localhost:4188/')
})

it('requires a newly selected directory during metadata rebinding', () => {
  const { getByRole } = render(<SiteForm mode="rebind" site={{ id: 'old-id', title: 'Old Site', binding: { root: '/old', startCommand: 'npm run dev' } }} />)
  expect(getByRole('button', { name: 'Rebind directory' }).disabled).toBe(true)
})

it('re-infers an editable fallback during rebind without changing the Site ID', async () => {
  const onSaved = vi.fn()
  const fetcher = vi.fn(url => Promise.resolve(url.includes('/detect')
    ? { ok: true, json: async () => ({ detection: { findings: [] } }) }
    : { ok: true, json: async () => ({ site: { id: 'old-id' } }) }))
  vi.stubGlobal('fetch', fetcher)
  const { getByRole } = render(<SiteForm mode="rebind" site={{ id: 'old-id', title: 'Old Site', binding: { startCommand: 'old command' } }} onSaved={onSaved} />)
  fireEvent.click(getByRole('button', { name: 'Choose directory' }))
  await waitFor(() => expect(getByRole('textbox', { name: 'Run command' }).value).toBe('npm run dev'))
  fireEvent.change(getByRole('textbox', { name: 'Run command' }), { target: { value: 'node dev.js' } })
  fireEvent.click(getByRole('button', { name: 'Rebind directory' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalled())
  expect(fetcher.mock.calls[1][0]).toContain('/old-id/metadata')
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ root: '/projects/my-site', startCommand: 'node dev.js' })
})

it('edits Site metadata without requesting a new directory or changing its ID', async () => {
  const onSaved = vi.fn()
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ site: { id: 'old-id', title: 'Updated Site' } }) }))
  vi.stubGlobal('fetch', fetcher)
  const { getByRole, queryByRole } = render(<SiteForm site={{
    id: 'old-id',
    title: 'Old Site',
    description: 'Old description',
    deployments: { production: { baseUrl: 'https://old.example.com/' } },
    binding: { root: '/existing', developmentBaseUrl: 'http://localhost:5173/', startCommand: 'npm run dev' },
  }} onSaved={onSaved} />)
  expect(queryByRole('button', { name: 'Choose directory' })).toBeNull()
  fireEvent.change(getByRole('textbox', { name: 'Site name *' }), { target: { value: 'Updated Site' } })
  fireEvent.change(getByRole('textbox', { name: 'Local URL' }), { target: { value: 'http://localhost:5174/' } })
  fireEvent.change(getByRole('textbox', { name: 'Run command' }), { target: { value: 'npm run preview' } })
  fireEvent.change(getByRole('textbox', { name: 'Deploy URL' }), { target: { value: 'https://new.example.com/' } })
  fireEvent.change(getByRole('textbox', { name: 'Description' }), { target: { value: 'Updated description' } })
  fireEvent.click(getByRole('button', { name: 'Save Site' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalled())
  expect(fetcher.mock.calls[0][0]).toContain('/old-id/metadata')
  expect(fetcher.mock.calls[0][1].method).toBe('PATCH')
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    title: 'Updated Site',
    description: 'Updated description',
    developmentBaseUrl: 'http://localhost:5174/',
    productionBaseUrl: 'https://new.example.com/',
    startCommand: 'npm run preview',
  })
})
