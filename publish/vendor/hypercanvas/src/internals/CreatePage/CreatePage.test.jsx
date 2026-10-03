import { afterEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import CreatePage from './CreatePage.jsx'

vi.mock('../../core/notebook/tauri-bridge.js', () => ({
  isTauriAvailable: () => false,
}))

vi.mock('../CommandPalette/CreateArtifactForm.jsx', () => ({
  default: () => <form aria-label="Shared artifact creation form">Artifact form</form>,
}))

afterEach(() => { delete window.__HYPERCANVAS_CORE_MODE__ })

it('renders the shared artifact form in browser Core mode', () => {
  window.__HYPERCANVAS_CORE_MODE__ = true
  render(<CreatePage basePath="/branch--feature/" />)

  expect(screen.getByRole('form', { name: 'Shared artifact creation form' })).toBeTruthy()
})

it('explains that standalone artifact creation needs an active Core session', () => {
  render(<CreatePage />)

  expect(screen.getByText(/requires a running Hypercanvas Core session/)).toBeTruthy()
})
