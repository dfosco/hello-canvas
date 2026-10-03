import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import RunningSitesTrigger from './RunningSitesTrigger.jsx'
import { NOTEBOOK_SIDEBAR_EVENT } from '../notebook/browserBridge.js'

describe('RunningSitesTrigger', () => {
  beforeEach(() => {})
  afterEach(() => vi.restoreAllMocks())

  it('opens the Notebook sidebar focused on Sites', () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    render(<RunningSitesTrigger />)
    const button = screen.getByRole('button', { name: 'Sites' })

    fireEvent.click(button)
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: NOTEBOOK_SIDEBAR_EVENT,
      detail: { focusType: 'site' },
    }))
  })
})
