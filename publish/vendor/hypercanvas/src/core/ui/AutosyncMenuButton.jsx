import './AutosyncMenuButton.css';
import { useState, useEffect, useRef, useCallback } from 'react'
import { TriggerButton } from '../lib/components/ui/trigger-button/index.js'
import * as DropdownMenu from '../lib/components/ui/dropdown-menu/index.js'
import Icon from './Icon.jsx'
import BranchSelect from './BranchSelect.jsx'

export default function AutosyncMenuButton({ config = {}, basePath = '/', tabindex = -1 }) {
  const apiBase = (basePath === '/' ? '' : basePath.replace(/\/$/, '')) + '/_storyboard/autosync'

  const [menuOpen, setMenuOpen] = useState(false)
  const [branches, setBranches] = useState([])
  const [_currentBranch, setCurrentBranch] = useState('')
  void _currentBranch
  const [selectedBranch, setSelectedBranch] = useState('')
  const [enabledScopes, setEnabledScopes] = useState({ canvas: false, prototype: false })
  const [lastSyncTime, setLastSyncTime] = useState(null)
  const [lastError, setLastError] = useState(null)
  const [lastErrorByScope, setLastErrorByScope] = useState({ canvas: null, prototype: null })
  const [syncing, setSyncing] = useState(false)
  const [syncingScope, setSyncingScope] = useState(null)
  const [loading, setLoading] = useState(false)

  const pollRef = useRef(null)
  const enabledScopesRef = useRef(enabledScopes)
  enabledScopesRef.current = enabledScopes

  function isProtectedBranch(name) {
    const normalized = String(name || '').toLowerCase()
    return normalized === 'main' || normalized === 'master'
  }

  function hasEnabled(scopes) {
    return scopes?.canvas || scopes?.prototype
  }

  const applyStatus = useCallback((data) => {
    const incomingScopes = data.enabledScopes
    let newScopes
    if (incomingScopes && typeof incomingScopes === 'object') {
      newScopes = { canvas: incomingScopes.canvas === true, prototype: incomingScopes.prototype === true }
    } else {
      newScopes = {
        canvas: data.enabled === true && data.scope === 'canvas',
        prototype: data.enabled === true && data.scope === 'prototype',
      }
    }
    setEnabledScopes(newScopes)

    if (data.branch) setCurrentBranch(data.branch)
    if (data.targetBranch) setSelectedBranch(data.targetBranch)
    setLastSyncTime(data.lastSyncTime || null)
    setLastError(data.lastError || null)
    setSyncing(data.syncing === true)
    setSyncingScope(
      data.syncingScope === 'prototype' || data.syncingScope === 'canvas' ? data.syncingScope : null,
    )

    const incomingErrorByScope = data.lastErrorByScope
    if (incomingErrorByScope && typeof incomingErrorByScope === 'object') {
      setLastErrorByScope({ canvas: incomingErrorByScope.canvas || null, prototype: incomingErrorByScope.prototype || null })
    }
  }, [])

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/status`)
      const data = await res.json()
      applyStatus(data)
    } catch { /* ignore */ }
  }, [apiBase, applyStatus])

  function startPolling() {
    if (pollRef.current) return
    pollRef.current = setInterval(fetchStatus, 5000)
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  async function fetchBranches() {
    try {
      const res = await fetch(`${apiBase}/branches`)
      const data = await res.json()
      const branchList = data.branches || []
      const current = data.current || ''
      setBranches(branchList)
      setCurrentBranch(current)
      setSelectedBranch((prev) => {
        if (!prev || isProtectedBranch(prev) || !branchList.includes(prev)) {
          return branchList.includes(current) ? current : (branchList[0] || '')
        }
        return prev
      })
    } catch { /* ignore */ }
  }

  async function setAutosyncScope(scope, shouldEnable, e) {
    e.preventDefault()
    setLoading(true)
    setLastError(null)
    try {
      if (shouldEnable && !selectedBranch) {
        setLastError('Select a non-main branch first')
        return
      }
      const res = await fetch(
        shouldEnable ? `${apiBase}/enable` : `${apiBase}/disable`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(shouldEnable ? { branch: selectedBranch, scope } : { scope }),
        },
      )
      const data = await res.json()
      if (!res.ok) {
        setLastError(data.error || (shouldEnable ? 'Failed to enable' : 'Failed to disable'))
      } else {
        applyStatus(data)
      }
    } catch (err) {
      setLastError(err.message || 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  const branchSelectRef = useRef(null)

  function handleOpenChange(open) {
    setMenuOpen(open)
    if (open) {
      fetchBranches()
      fetchStatus()
      startPolling()
      // Focus the branch selector after the menu mounts
      requestAnimationFrame(() => branchSelectRef.current?.focus())
    } else if (!hasEnabled(enabledScopesRef.current)) {
      stopPolling()
    }
  }

  // Allow command palette to open this menu via custom event
  useEffect(() => {
    const open = () => handleOpenChange(true)
    document.addEventListener('storyboard:open-autosync', open)
    return () => document.removeEventListener('storyboard:open-autosync', open)
  }, [])

  function formatSyncTime(iso) {
    if (!iso) return ''
    try {
      return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    } catch { return iso }
  }

  useEffect(() => {
    fetchStatus()
    return () => stopPolling()
  }, [fetchStatus])

  const isScopeEnabled = (target) => enabledScopes[target] === true
  const showStatus = hasEnabled(enabledScopes) || lastError || lastSyncTime || lastErrorByScope.canvas || lastErrorByScope.prototype

  return (
    <DropdownMenu.Root open={menuOpen} onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger>
          <TriggerButton
            active={menuOpen || hasEnabled(enabledScopes)}
            size="icon-xl"
            aria-label={config.ariaLabel || 'Autosync'}
            tabIndex={tabindex}
          >
            <Icon name={config.icon || 'primer/sync'} size={16} {...(config.meta || {})} />
          </TriggerButton>
      </DropdownMenu.Trigger>

      <DropdownMenu.Content
        side="top"
        align="end"
        sideOffset={16}
        style={config.menuWidth ? { minWidth: config.menuWidth } : undefined}
        className="min-w-[280px]"
      >
        <p className="menuTitle">{config.label || 'Autosync'}</p>
        <p className="description">Automatically commit and push changes every 30s</p>

        <DropdownMenu.Separator />

        {/* Branch selector */}
        <div className="branchRow">
          <label className="branchLabel" htmlFor="autosync-branch">Branch</label>
          <BranchSelect
            id="autosync-branch"
            ref={branchSelectRef}
            branches={branches}
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            disabled={hasEnabled(enabledScopes) || loading}
            placeholder="No non-main branches available"
          />
        </div>

        <DropdownMenu.Separator />

        <DropdownMenu.CheckboxItem
          checked={isScopeEnabled('canvas')}
          onSelect={(e) => setAutosyncScope('canvas', !isScopeEnabled('canvas'), e)}
          disabled={loading || (!isScopeEnabled('canvas') && !selectedBranch)}
        >
          {isScopeEnabled('canvas') ? 'Disable autosync for canvas changes' : 'Enable autosync for canvas changes'}
        </DropdownMenu.CheckboxItem>
        <DropdownMenu.CheckboxItem
          checked={isScopeEnabled('prototype')}
          onSelect={(e) => setAutosyncScope('prototype', !isScopeEnabled('prototype'), e)}
          disabled={loading || (!isScopeEnabled('prototype') && !selectedBranch)}
        >
          {isScopeEnabled('prototype') ? 'Disable autosync for prototype changes' : 'Enable autosync for prototype changes'}
        </DropdownMenu.CheckboxItem>

        {showStatus && (
          <>
            <DropdownMenu.Separator />
            <div className="statusRow">
              {syncing && syncingScope && (
                <p className="scopeHint">Syncing <strong>{syncingScope}</strong> changes</p>
              )}
              {lastError && <span className="statusError">⚠ {lastError}</span>}
              {lastErrorByScope.canvas && <span className="statusError">⚠ Canvas: {lastErrorByScope.canvas}</span>}
              {lastErrorByScope.prototype && <span className="statusError">⚠ Prototype: {lastErrorByScope.prototype}</span>}
              {!syncing && lastSyncTime && <span className="statusOk">Last sync: {formatSyncTime(lastSyncTime)}</span>}
            </div>
          </>
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  )
}
