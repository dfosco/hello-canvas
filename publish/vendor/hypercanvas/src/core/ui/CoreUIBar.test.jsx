import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import CoreUIBar from './CoreUIBar.jsx'
import { _resetSidePanel } from '../stores/sidePanelStore.js'
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
    _resetSidePanel()
    _resetToolbarConfig()
    vi.stubGlobal('requestAnimationFrame', callback => {
      callback()
      return 1
    })
  })

  afterEach(() => {
    cleanup()
    _resetSidePanel()
    _resetToolbarConfig()
    vi.unstubAllGlobals()
  })

  it('mounts the Sites panel when a tool opens it even without sidepanel menu metadata', async () => {
    render(<CoreUIBar toolbarConfig={toolbarConfig} />)

    expect(screen.queryByRole('complementary', { name: 'Side panel' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Sites' }))

    expect(await screen.findByRole('complementary', { name: 'Side panel' })).toBeTruthy()
    expect(screen.getByTestId('running-sites-panel')).toBeTruthy()
  })
})
