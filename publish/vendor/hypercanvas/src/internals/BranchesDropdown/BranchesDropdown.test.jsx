import { describe, it, expect, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import BranchesDropdown from './BranchesDropdown.jsx'

beforeEach(() => {
  cleanup()
  // BranchesDropdown bails out when window.__SB_LOCAL_DEV__ === true.
  if (typeof window !== 'undefined') {
    delete window.__SB_LOCAL_DEV__
  }
})

const branches = [
  { branch: 'main', folder: 'demos', route: '/Signup' },
  { branch: 'feature-x', folder: 'demos', route: '/Signup' },
]

describe('BranchesDropdown', () => {
  it('renders the trigger when other branches have the prototype', () => {
    const { container } = render(
      <BranchesDropdown branches={branches} branchBasePath="/" currentBranch="main" />,
    )
    const trigger = container.querySelector('button')
    expect(trigger).toBeTruthy()
    expect(trigger.getAttribute('aria-label')).toBe('See branches')
  })

  it('applies the accent class and re-labels when isBranchOnly is true', () => {
    const { container } = render(
      <BranchesDropdown
        branches={branches}
        branchBasePath="/"
        currentBranch="main"
        isBranchOnly
      />,
    )
    const trigger = container.querySelector('button')
    expect(trigger).toBeTruthy()
    // CSS Modules hash class names — assert by suffix match.
    expect(trigger.className).toMatch(/iconBtnAccent/)
    expect(trigger.getAttribute('aria-label')).toBe('Open on another branch')
  })

  it('does NOT apply the accent class when isBranchOnly is false', () => {
    const { container } = render(
      <BranchesDropdown branches={branches} branchBasePath="/" currentBranch="main" />,
    )
    const trigger = container.querySelector('button')
    expect(trigger.className).not.toMatch(/iconBtnAccent/)
  })

  it('returns null when only the current branch has the prototype', () => {
    const { container } = render(
      <BranchesDropdown
        branches={[{ branch: 'main', folder: 'demos', route: '/Signup' }]}
        branchBasePath="/"
        currentBranch="main"
      />,
    )
    expect(container.querySelector('button')).toBeNull()
  })
})
