import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import SidePanel from './SidePanel.jsx'
import { _resetSidePanel, openPanel } from '../stores/sidePanelStore.js'

vi.mock('./RunningSitesPanel.jsx', () => ({ default: () => <div>Sites panel content</div> }))
vi.mock('./PublishControl.jsx', () => ({ PublishPanel: () => <div>Publish panel content</div> }))

describe('SidePanel', () => {
  beforeEach(() => {
    _resetSidePanel()
    vi.stubGlobal('requestAnimationFrame', callback => {
      callback()
      return 1
    })
  })

  afterEach(() => {
    cleanup()
    _resetSidePanel()
    localStorage.removeItem('sb-sidepanel-position')
    vi.unstubAllGlobals()
  })

  it('identifies the active Sites tab for chrome visibility styling and preserves it while hidden', () => {
    openPanel('sites')
    render(<SidePanel />)

    const panel = screen.getByRole('complementary', { name: 'Side panel' })
    expect(panel.getAttribute('data-sidepanel-tab')).toBe('sites')

    document.documentElement.classList.add('storyboard-chrome-hidden')
    expect(panel.getAttribute('data-sidepanel-tab')).toBe('sites')
    document.documentElement.classList.remove('storyboard-chrome-hidden')
    expect(panel.getAttribute('data-sidepanel-tab')).toBe('sites')
  })

  it('keeps the Sites panel on the side and hides the dock toggle when bottom docking was saved', async () => {
    localStorage.setItem('sb-sidepanel-position', 'bottom')
    openPanel('sites')
    render(<SidePanel />)

    const panel = screen.getByRole('complementary', { name: 'Side panel' })
    await waitFor(() => expect(panel.classList.contains('sb-sidepanel--bottom')).toBe(false))
    expect(panel.getAttribute('data-sidepanel-tab')).toBe('sites')
    expect(document.documentElement.classList.contains('sb-sidepanel-bottom')).toBe(false)
    expect(screen.queryByRole('button', { name: 'Dock to bottom' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Dock to side' })).toBeNull()
  })

  it('hosts Publish in the same fixed side panel as Sites', async () => {
    localStorage.setItem('sb-sidepanel-position', 'bottom')
    openPanel('publish')
    render(<SidePanel />)

    const panel = screen.getByRole('complementary', { name: 'Side panel' })
    await waitFor(() => expect(screen.getByText('Publish panel content')).toBeTruthy())
    expect(panel.getAttribute('data-sidepanel-tab')).toBe('publish')
    expect(panel.classList.contains('sb-sidepanel--bottom')).toBe(false)
    expect(screen.queryByRole('button', { name: 'Dock to bottom' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Dock to side' })).toBeNull()
  })
})
