import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import CoreUIBar from './CoreUIBar.jsx'
import { _resetToolbarConfig } from '../stores/toolbarConfigStore.js'

vi.mock('./RunningSitesPanel.jsx', () => ({ default: () => <div data-testid="running-sites-panel" /> }))

const toolbarConfig = {
  tools: {
    'running-sites': {
      label: 'Sites',
      ariaLabel: 'Sites',
      icon: 'iconoir/globe',
      render: 'button',
      surface: 'command-toolbar',
      handler: 'core:running-sites',
      modes: ['*'],
      prod: true,
      alwaysVisible: true,
    },
  },
}

describe('CoreUIBar side panel mounting', () => {
  beforeEach(() => {
    _resetToolbarConfig()
    vi.stubGlobal('requestAnimationFrame', callback => {
      callback()
      return 1
    })
  })

  afterEach(() => {
    cleanup()
    _resetToolbarConfig()
    vi.unstubAllGlobals()
  })

  it('opens and focuses the Notebook sidebar from the Sites tool', async () => {
    const onOpenSidebar = vi.fn()
    window.addEventListener('storyboard:open-notebook-sidebar', onOpenSidebar)
    render(<CoreUIBar toolbarConfig={toolbarConfig} />)

    expect(screen.queryByRole('complementary', { name: 'Side panel' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Sites' }))

    expect(onOpenSidebar).toHaveBeenCalledTimes(1)
    expect(onOpenSidebar.mock.calls[0][0].detail).toEqual({ focusType: 'site' })
    expect(screen.queryByTestId('running-sites-panel')).toBeNull()
    window.removeEventListener('storyboard:open-notebook-sidebar', onOpenSidebar)
  })
})
