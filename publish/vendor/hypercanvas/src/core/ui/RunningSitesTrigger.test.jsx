import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import RunningSitesTrigger from './RunningSitesTrigger.jsx'
import { _resetSidePanel, openPanel, sidePanelState } from '../stores/sidePanelStore.js'

function getPanelState() {
  let current
  const unsubscribe = sidePanelState.subscribe(state => { current = state })
  unsubscribe()
  return current
}

describe('RunningSitesTrigger', () => {
  beforeEach(() => _resetSidePanel())
  afterEach(() => _resetSidePanel())

  it('opens Sites, closes it on a second click, and switches to Sites from another tab', () => {
    render(<RunningSitesTrigger />)
    const button = screen.getByRole('button', { name: 'Sites' })

    fireEvent.click(button)
    expect(getPanelState()).toEqual({ open: true, activeTab: 'sites' })
    expect(document.documentElement.classList.contains('sb-sidepanel-open')).toBe(true)

    fireEvent.click(button)
    expect(getPanelState()).toEqual({ open: false, activeTab: 'sites' })
    expect(document.documentElement.classList.contains('sb-sidepanel-open')).toBe(false)

    openPanel('inspector')
    fireEvent.click(button)
    expect(getPanelState()).toEqual({ open: true, activeTab: 'sites' })
  })
})
