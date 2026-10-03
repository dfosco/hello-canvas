import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import FilePicker from '../FilePicker.jsx'
import FilePickerController from '../FilePickerController.jsx'

// The server responds with `{ tree: [...rootChildren] }` — an array of the
// repo root's top-level entries, NOT a single root node.
const MOCK_TREE_RESPONSE = {
  tree: [
    {
      name: 'src',
      path: 'src',
      kind: 'dir',
      children: [
        { name: 'index.js', path: 'src/index.js', kind: 'file' },
        { name: 'utils.js', path: 'src/utils.js', kind: 'file' },
        {
          name: 'components',
          path: 'src/components',
          kind: 'dir',
          children: [
            { name: 'Button.jsx', path: 'src/components/Button.jsx', kind: 'file' },
          ],
        },
      ],
    },
    { name: 'README.md', path: 'README.md', kind: 'file' },
  ],
}

function mockFetchSuccess() {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(MOCK_TREE_RESPONSE),
    }),
  )
}

function mockFetchError() {
  global.fetch = vi.fn(() => Promise.reject(new Error('Network error')))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FilePicker', () => {
  describe('loading and tree rendering', () => {
    it('shows loading state then renders the tree', async () => {
      mockFetchSuccess()
      render(<FilePicker isOpen onSelect={() => {}} onCancel={() => {}} />)

      expect(screen.getByText('Loading…')).toBeTruthy()

      await waitFor(() => {
        expect(screen.getByText('src')).toBeTruthy()
        expect(screen.getByText('README.md')).toBeTruthy()
      })
    })

    it('does not render when isOpen is false', () => {
      mockFetchSuccess()
      const { container } = render(<FilePicker isOpen={false} onSelect={() => {}} onCancel={() => {}} />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe('directory expand/collapse', () => {
    it('expanding a directory shows its children', async () => {
      mockFetchSuccess()
      render(<FilePicker isOpen onSelect={() => {}} onCancel={() => {}} />)

      await waitFor(() => screen.getByText('src'))

      // Children not visible yet
      expect(screen.queryByText('index.js')).toBeNull()

      // Click to expand
      fireEvent.click(screen.getByText('src'))

      expect(screen.getByText('index.js')).toBeTruthy()
      expect(screen.getByText('utils.js')).toBeTruthy()
    })

    it('collapsing a directory hides its children again', async () => {
      mockFetchSuccess()
      render(<FilePicker isOpen onSelect={() => {}} onCancel={() => {}} />)

      await waitFor(() => screen.getByText('src'))
      fireEvent.click(screen.getByText('src')) // expand
      expect(screen.getByText('index.js')).toBeTruthy()

      fireEvent.click(screen.getByText('src')) // collapse
      expect(screen.queryByText('index.js')).toBeNull()
    })
  })

  describe('file selection', () => {
    it('selecting a file enables the Select button', async () => {
      mockFetchSuccess()
      render(<FilePicker isOpen onSelect={() => {}} onCancel={() => {}} />)

      await waitFor(() => screen.getByText('README.md'))

      const selectBtn = screen.getByRole('button', { name: 'Select' })
      expect(selectBtn.disabled).toBe(true)

      fireEvent.click(screen.getByText('README.md'))
      expect(selectBtn.disabled).toBe(false)
    })

    it('clicking Select calls onSelect with the chosen path', async () => {
      mockFetchSuccess()
      const onSelect = vi.fn()
      render(<FilePicker isOpen onSelect={onSelect} onCancel={() => {}} />)

      await waitFor(() => screen.getByText('README.md'))

      fireEvent.click(screen.getByText('README.md'))
      fireEvent.click(screen.getByRole('button', { name: 'Select' }))

      expect(onSelect).toHaveBeenCalledOnce()
      expect(onSelect).toHaveBeenCalledWith('README.md')
    })

    it('clicking a file inside an expanded directory selects it', async () => {
      mockFetchSuccess()
      const onSelect = vi.fn()
      render(<FilePicker isOpen onSelect={onSelect} onCancel={() => {}} />)

      await waitFor(() => screen.getByText('src'))
      fireEvent.click(screen.getByText('src'))
      fireEvent.click(screen.getByText('index.js'))
      fireEvent.click(screen.getByRole('button', { name: 'Select' }))

      expect(onSelect).toHaveBeenCalledWith('src/index.js')
    })
  })

  describe('Cancel button', () => {
    it('calls onCancel when Cancel is clicked', async () => {
      mockFetchSuccess()
      const onCancel = vi.fn()
      render(<FilePicker isOpen onSelect={() => {}} onCancel={onCancel} />)

      await waitFor(() => screen.getByText('README.md'))

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(onCancel).toHaveBeenCalledOnce()
    })
  })

  describe('filter input', () => {
    it('filters to matching files and hides directory structure', async () => {
      mockFetchSuccess()
      render(<FilePicker isOpen onSelect={() => {}} onCancel={() => {}} />)

      await waitFor(() => screen.getByText('src'))

      const input = screen.getByPlaceholderText('Filter files…')
      fireEvent.change(input, { target: { value: 'utils' } })

      // Only utils.js path should be visible; no directory nodes
      expect(screen.getByText('src/utils.js')).toBeTruthy()
      expect(screen.queryByText('src/index.js')).toBeNull()
      expect(screen.queryByText('README.md')).toBeNull()
    })

    it('shows a "no matches" message when nothing matches', async () => {
      mockFetchSuccess()
      render(<FilePicker isOpen onSelect={() => {}} onCancel={() => {}} />)

      await waitFor(() => screen.getByText('src'))

      const input = screen.getByPlaceholderText('Filter files…')
      fireEvent.change(input, { target: { value: 'zzznonexistent' } })

      expect(screen.getByText(/No files match/)).toBeTruthy()
    })

    it('filter is case-insensitive', async () => {
      mockFetchSuccess()
      render(<FilePicker isOpen onSelect={() => {}} onCancel={() => {}} />)

      await waitFor(() => screen.getByText('src'))

      const input = screen.getByPlaceholderText('Filter files…')
      fireEvent.change(input, { target: { value: 'README' } })

      expect(screen.getByText('README.md')).toBeTruthy()
    })
  })

  describe('error state', () => {
    it('shows an error message and retry button on fetch failure', async () => {
      mockFetchError()
      render(<FilePicker isOpen onSelect={() => {}} onCancel={() => {}} />)

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
      })
    })

    it('shows a Core import failure without closing the picker', async () => {
      mockFetchSuccess()
      const onImport = vi.fn().mockRejectedValue(new Error('No active Notebook'))
      render(<FilePicker isOpen onSelect={() => {}} onCancel={() => {}} onImport={onImport} />)

      await waitFor(() => screen.getByText('README.md'))
      fireEvent.click(screen.getByRole('button', { name: 'Import from computer…' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('No active Notebook')
      expect(screen.getByText('Pick a file')).toBeTruthy()
    })

    it('clicking Retry re-fetches the tree', async () => {
      mockFetchError()
      render(<FilePicker isOpen onSelect={() => {}} onCancel={() => {}} />)

      await waitFor(() => screen.getByRole('button', { name: 'Retry' }))

      // Switch to success
      mockFetchSuccess()
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      await waitFor(() => {
        expect(screen.getByText('src')).toBeTruthy()
      })
    })
  })
})

describe('FilePickerController', () => {
  beforeEach(() => {
    mockFetchSuccess()
  })

  it('is not visible before any event', () => {
    const { container } = render(<FilePickerController />)
    // FilePicker renders null when closed
    expect(container.firstChild).toBeNull()
  })

  it('opens when storyboard:canvas:open-file-picker event fires', async () => {
    render(<FilePickerController />)

    act(() => {
      document.dispatchEvent(
        new CustomEvent('storyboard:canvas:open-file-picker', { detail: {} }),
      )
    })

    await waitFor(() => {
      expect(screen.getByText('Pick a file')).toBeTruthy()
    })
  })

  it('dispatches update-widget when widgetId is provided', async () => {
    render(<FilePickerController />)

    const dispatched = []
    document.addEventListener('storyboard:canvas:update-widget', (e) => dispatched.push(e.detail))

    act(() => {
      document.dispatchEvent(
        new CustomEvent('storyboard:canvas:open-file-picker', {
          detail: { widgetId: 'widget-abc' },
        }),
      )
    })

    await waitFor(() => screen.getByText('README.md'))

    fireEvent.click(screen.getByText('README.md'))
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))

    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]).toEqual({ widgetId: 'widget-abc', updates: { path: 'README.md' } })
  })

  it('calls onSelect callback when provided in detail', async () => {
    render(<FilePickerController />)
    const onSelect = vi.fn()

    act(() => {
      document.dispatchEvent(
        new CustomEvent('storyboard:canvas:open-file-picker', {
          detail: { onSelect },
        }),
      )
    })

    await waitFor(() => screen.getByText('README.md'))

    fireEvent.click(screen.getByText('README.md'))
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))

    expect(onSelect).toHaveBeenCalledWith('README.md')
  })

  it('dispatches add-widget when no widgetId or onSelect is provided', async () => {
    render(<FilePickerController />)

    const dispatched = []
    document.addEventListener('storyboard:canvas:add-widget', (e) => dispatched.push(e.detail))

    act(() => {
      document.dispatchEvent(
        new CustomEvent('storyboard:canvas:open-file-picker', { detail: {} }),
      )
    })

    await waitFor(() => screen.getByText('README.md'))

    fireEvent.click(screen.getByText('README.md'))
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))

    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]).toEqual({ type: 'file', props: { path: 'README.md' } })
  })

  it('imports a file through Core and selects the returned Notebook-relative path', async () => {
    const requests = []
    global.fetch = vi.fn((url, options) => {
      requests.push({ url: String(url), options })
      if (String(url).includes('/_storyboard/file/tree')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_TREE_RESPONSE) })
      }
      if (String(url).includes('/_storyboard/system/import-file')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ path: 'assets/files/diagram.png', cancelled: false }) })
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    const added = vi.fn()
    document.addEventListener('storyboard:canvas:add-widget', added)
    render(<FilePickerController />)

    act(() => {
      document.dispatchEvent(new CustomEvent('storyboard:canvas:open-file-picker', { detail: {} }))
    })
    await waitFor(() => screen.getByText('README.md'))
    fireEvent.click(screen.getByRole('button', { name: 'Import from computer…' }))

    await waitFor(() => expect(added).toHaveBeenCalledOnce())
    expect(added.mock.calls[0][0].detail).toEqual({
      type: 'file',
      props: { path: 'assets/files/diagram.png' },
    })
    expect(requests.find(({ url }) => url.includes('/_storyboard/system/import-file'))?.options).toMatchObject({ method: 'POST' })
    expect(screen.queryByText('Pick a file')).toBeNull()
    document.removeEventListener('storyboard:canvas:add-widget', added)
  })

  it('closes when Cancel is clicked', async () => {
    render(<FilePickerController />)

    act(() => {
      document.dispatchEvent(
        new CustomEvent('storyboard:canvas:open-file-picker', { detail: {} }),
      )
    })

    await waitFor(() => screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByText('Pick a file')).toBeNull()
    })
  })
})
