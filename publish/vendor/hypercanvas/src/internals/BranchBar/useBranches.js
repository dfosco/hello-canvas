/**
 * useBranches — shared hook for branch data across BranchBar and BranchDropdown.
 * Fetches live branch list from /_storyboard/worktrees API on mount.
 */
import { useState, useEffect, useCallback } from 'react'

const isLocalDev = typeof window !== 'undefined' && window.__SB_LOCAL_DEV__ === true

export function useBranches(basePath) {
  const [branches, setBranches] = useState(() => {
    if (typeof window !== 'undefined' && Array.isArray(window.__SB_BRANCHES__)) {
      return window.__SB_BRANCHES__
    }
    return null
  })

  const [gitUser, setGitUser] = useState(null)
  const [currentBranch, setCurrentBranch] = useState(() => {
    if (typeof window !== 'undefined' && typeof window.__SB_CURRENT_BRANCH__ === 'string') {
      return window.__SB_CURRENT_BRANCH__
    }
    // Legacy fallback: parse /branch--<name>/ from BASE_URL (prod branch deploys).
    const m = (basePath || '').match(/\/branch--([^/]+)\/?$/)
    return m ? m[1] : 'main'
  })
  const branchBasePath = (basePath || '/').replace(/\/branch--[^/]*\/?$/, '/')

  useEffect(() => {
    const apiBase = (basePath || '/').replace(/\/$/, '')
    const branchManifestUrl = `${branchBasePath.replace(/\/$/, '')}/branches.json`

    fetch(`${apiBase}/_storyboard/git-user`).then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.name) setGitUser(data.name) })
      .catch(() => {})

    // Source of truth for current branch in dev: ask the server (`git
    // branch --show-current`). Falls through to the SSR-injected
    // window.__SB_CURRENT_BRANCH__ or the URL-derived fallback.
    fetch(`${apiBase}/_storyboard/current-branch`).then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.branch) setCurrentBranch(data.branch) })
      .catch(() => {})

    // Keep dev behavior: prefer live branch list from server API.
    // On static deployments (GitHub Pages), fallback to branches.json.
    fetch(`${apiBase}/_storyboard/worktrees`).then(r => r.ok ? r.json() : null)
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setBranches(data)
          return true
        }
        return false
      })
      .catch(() => false)
      .then((hasLiveData) => {
        if (hasLiveData || isLocalDev) return
        return fetch(branchManifestUrl)
          .then(r => r.ok ? r.json() : null)
          .then(data => { if (Array.isArray(data) && data.length > 0) setBranches(data) })
          .catch(() => {})
      })
  }, [basePath, branchBasePath])

  return { branches, currentBranch, branchBasePath, gitUser }
}

export function useSwitchBranch(basePath, branchBasePath) {
  const [switching, setSwitching] = useState(null)
  const [switchError, setSwitchError] = useState(null)

  const switchBranch = useCallback(async (branch, folder, url) => {
    if (switching) return
    setSwitching(branch)
    setSwitchError(null)

    // Dev: target is already running on its own port — navigate directly.
    if (isLocalDev && url) {
      window.location.href = url
      return
    }

    // Prod / static deploy: branch builds share an origin under /branch--<name>/.
    if (!isLocalDev) {
      window.location.href = `${branchBasePath}${folder || (branch === 'main' ? '' : `branch--${branch}/`)}`
      return
    }

    // Dev fallback: ask the server to spawn a Vite for the requested worktree.
    const apiBase = (basePath || '/').replace(/\/$/, '')
    try {
      const res = await fetch(`${apiBase}/_storyboard/switch-branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch }),
      })
      const data = await res.json()
      if (res.ok && data.url) {
        window.location.href = data.url
        return
      }
      setSwitchError(data.error || `Failed to start "${branch}"`)
    } catch (e) {
      setSwitchError(e.message || 'Server not reachable')
    }
    setSwitching(null)
  }, [basePath, branchBasePath, switching])

  return { switching, switchError, switchBranch }
}
