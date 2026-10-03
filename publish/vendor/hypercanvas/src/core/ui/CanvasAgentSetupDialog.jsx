import { useEffect, useRef, useState } from 'react'
import * as Dialog from '../lib/components/ui/dialog/index.js'
import styles from './CanvasAgentSetupDialog.module.css'

export const SETUP_AGENTS = Object.freeze([
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude' },
  { id: 'copilot', label: 'Copilot' },
  { id: 'opencode', label: 'OpenCode' },
])

const TERMINAL_OPERATION_STATUSES = new Set(['succeeded', 'failed', 'cancelled'])

function errorMessage(error) {
  return error?.message || 'The host-tools request failed. Try again.'
}

function baselineLabel(preflight) {
  const status = preflight?.baseline?.status
  if (preflight?.status === 'unsupported' || status === 'unsupported') return 'Setup supports macOS on Apple silicon only.'
  if (status === 'valid') return 'Host Node and npm passed verification.'
  if (status === 'outdated') return 'Host Node is below the supported baseline and will be updated.'
  if (status === 'partial') return 'Host Node and npm are incomplete or failed verification.'
  if (status === 'missing') return 'Host Node and npm are missing.'
  return 'Host Node and npm status is unavailable.'
}

function agentStatusLabel(tool) {
  if (tool?.status === 'installed' && typeof tool.path === 'string' && tool.path.startsWith('/')) {
    return tool.version ? `Installed, ${tool.version}` : 'Installed and verified'
  }
  if (tool?.status === 'missing') return 'Not installed'
  if (tool?.status === 'failed_verification' || tool?.status === 'installed') return 'Verification failed'
  if (tool?.status === 'unsupported') return 'Unsupported on this host'
  return 'Status unavailable'
}

function authenticationLabel(disclosure) {
  if (disclosure?.authentication === 'macos-terminal-user-managed') {
    return 'Authorization: macOS approval, if required, stays in the visible Terminal window.'
  }
  if (disclosure?.authentication === 'user-managed') {
    return 'Authentication: sign-in happens later inside the agent CLI, not during setup.'
  }
  return 'Authentication: this step does not sign in to an agent service.'
}

function profileLabel(disclosure) {
  if (disclosure?.modifiesShellProfile === true) return 'Shell profile: the vendor installer may update its own shell integration.'
  if (disclosure?.modifiesShellProfile === false) return 'Shell profile: no profile change is planned.'
  return 'Shell profile: Hypercanvas does not edit shell startup files for this step.'
}

function OperationProgress({ operation }) {
  const phases = Array.isArray(operation?.phases) ? operation.phases : []
  const output = Array.isArray(operation?.output) ? operation.output : []
  const partialSuccess = operation?.result?.partialSuccess === true

  return (
    <>
      {operation?.status === 'succeeded' && (
        <p className={styles.success} role="status">Setup finished and selected agents passed verification.</p>
      )}
      {operation?.status === 'failed' && (
        <p className={styles.error} role="alert">{operation?.error?.message || 'Setup did not finish successfully.'}</p>
      )}
      {operation?.status === 'cancelled' && (
        <p className={styles.notice} role="status">Setup was cancelled. Completed changes were left in place.</p>
      )}
      {partialSuccess && operation?.status !== 'succeeded' && (
        <p className={styles.notice}>Some steps completed successfully. Retry preserves them and checks the host again.</p>
      )}

      <section className={styles.section} aria-labelledby="agent-setup-progress-heading">
        <h3 className={styles.sectionTitle} id="agent-setup-progress-heading">Setup progress</h3>
        <ol className={styles.phaseList}>
          {phases.map((phase, index) => (
            <li className={styles.phase} key={phase?.id || index}>
              <span>{String(phase?.id || 'Host step').replaceAll('-', ' ')}</span>
              <span className={styles.tag}>{phase?.status || 'pending'}</span>
            </li>
          ))}
        </ol>
      </section>

      {output.length > 0 && (
        <section className={styles.section} aria-labelledby="agent-setup-output-heading">
          <h3 className={styles.sectionTitle} id="agent-setup-output-heading">Installer output</h3>
          <pre className={styles.output} aria-label="Installation output">
            {output.map((entry) => entry?.text).filter(Boolean).join('\n')}
            {operation?.outputTruncated ? '\n[output truncated]' : ''}
          </pre>
        </section>
      )}
    </>
  )
}

export default function CanvasAgentSetupDialog({
  open,
  onOpenChange,
  initialSelectedAgentIds = [],
  pendingLaunchAgentId = null,
  preflight,
  onPreflight,
  onAgentReady,
  client,
  pollInterval = 750,
}) {
  const [selectedAgentIds, setSelectedAgentIds] = useState([])
  const [plan, setPlan] = useState(null)
  const [operation, setOperation] = useState(null)
  const [view, setView] = useState('select')
  const [consent, setConsent] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  const continuedAgentRef = useRef(null)
  const initialSelectionKey = initialSelectedAgentIds.join(',')

  useEffect(() => {
    if (!open) return
    setSelectedAgentIds(initialSelectedAgentIds.filter((id) => SETUP_AGENTS.some((agent) => agent.id === id)))
    setPlan(null)
    setOperation(null)
    setView('select')
    setConsent(false)
    setRequestError('')
    setBusy(false)
    setCancelBusy(false)
    continuedAgentRef.current = null
  }, [open, initialSelectionKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const operationId = operation?.id
    if (!open || !operationId || TERMINAL_OPERATION_STATUSES.has(operation?.status) || view !== 'progress') return
    let active = true
    let timer

    async function poll() {
      try {
        const nextOperation = await client.operation(operationId)
        if (!active) return
        setOperation(nextOperation)
        if (!TERMINAL_OPERATION_STATUSES.has(nextOperation?.status)) {
          timer = window.setTimeout(poll, pollInterval)
        }
      } catch (error) {
        if (!active) return
        setRequestError(errorMessage(error))
        setView('operation-error')
      }
    }

    timer = window.setTimeout(poll, pollInterval)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [client, open, operation?.id, operation?.status, pollInterval, view])

  useEffect(() => {
    if (
      operation?.status !== 'succeeded'
      || !pendingLaunchAgentId
      || continuedAgentRef.current === pendingLaunchAgentId
    ) return
    const result = operation?.result?.agents?.[pendingLaunchAgentId]
    if (result?.status !== 'succeeded' && result?.status !== 'skipped') return
    continuedAgentRef.current = pendingLaunchAgentId
    onAgentReady?.(pendingLaunchAgentId)
  }, [onAgentReady, operation, pendingLaunchAgentId])

  const unsupported = preflight?.status === 'unsupported' || preflight?.support?.status === 'unsupported'
  const selectedSet = new Set(selectedAgentIds)

  function toggleAgent(agentId) {
    setSelectedAgentIds((current) => current.includes(agentId)
      ? current.filter((id) => id !== agentId)
      : [...current, agentId])
    setPlan(null)
    setConsent(false)
    setRequestError('')
    setView('select')
  }

  async function requestPlan({ refreshPreflight = false } = {}) {
    setBusy(true)
    setRequestError('')
    try {
      if (refreshPreflight) {
        const freshPreflight = await client.preflight()
        onPreflight?.(freshPreflight)
        if (freshPreflight?.status === 'unsupported') {
          setView('select')
          return
        }
      }
      const nextPlan = await client.plan(selectedAgentIds)
      setPlan(nextPlan)
      setConsent(false)
      setOperation(null)
      setView('review')
    } catch (error) {
      setRequestError(errorMessage(error))
      setView('error')
    } finally {
      setBusy(false)
    }
  }

  async function startInstall() {
    if (!consent || !plan?.id) return
    setBusy(true)
    setRequestError('')
    try {
      const nextOperation = await client.install(plan.id)
      setOperation(nextOperation)
      setView('progress')
    } catch (error) {
      setRequestError(errorMessage(error))
      setView('error')
    } finally {
      setBusy(false)
    }
  }

  async function cancelOperation() {
    if (
      !operation?.id
      || operation?.cancellation?.available !== true
      || operation?.cancellation?.requested === true
    ) return
    setCancelBusy(true)
    setRequestError('')
    try {
      setOperation(await client.cancel(operation.id))
    } catch (error) {
      setRequestError(errorMessage(error))
    } finally {
      setCancelBusy(false)
    }
  }

  const planSteps = Array.isArray(plan?.steps) ? plan.steps : []
  const disclosures = Array.isArray(plan?.disclosures) ? plan.disclosures : []
  const operationSettled = TERMINAL_OPERATION_STATUSES.has(operation?.status)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        className={styles.dialog}
        width="large"
        height="auto"
        aria-labelledby="agent-setup-title"
        aria-describedby="agent-setup-description"
      >
        <header className={styles.header}>
          <div className={styles.heading}>
            <h2 className={styles.title} id="agent-setup-title">Set up agent CLIs</h2>
            <p className={styles.subtitle} id="agent-setup-description">
              Inspect every host change before anything is installed.
            </p>
          </div>
          <button className={styles.closeButton} type="button" onClick={() => onOpenChange(false)}>
            Close
          </button>
        </header>

        <main className={styles.body}>
          <p className={styles.summary}>{baselineLabel(preflight)}</p>
          {requestError && <p className={styles.error} role="alert">{requestError}</p>}

          {(view === 'select' || view === 'error') && (
            <section className={styles.section} aria-labelledby="agent-selection-heading">
              <h3 className={styles.sectionTitle} id="agent-selection-heading">Choose agent CLIs</h3>
              <fieldset className={styles.agentGrid} disabled={unsupported || busy}>
                <legend className="sr-only">Agent CLIs to install or repair</legend>
                {SETUP_AGENTS.map((agent) => (
                  <label className={styles.agentChoice} key={agent.id}>
                    <input
                      type="checkbox"
                      checked={selectedSet.has(agent.id)}
                      onChange={() => toggleAgent(agent.id)}
                    />
                    <span className={styles.agentText}>
                      <span className={styles.agentName}>{agent.label}</span>
                      <span className={styles.agentStatus}>{agentStatusLabel(preflight?.agents?.[agent.id])}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </section>
          )}

          {view === 'review' && (
            <>
              <section className={styles.section} aria-labelledby="agent-plan-heading">
                <h3 className={styles.sectionTitle} id="agent-plan-heading">Exact setup plan</h3>
                <ol className={styles.stepList}>
                  {planSteps.map((step, index) => (
                    <li className={styles.step} key={step?.id || index}>
                      <span>{step?.label || 'Host setup step'}</span>
                      <span className={styles.tag}>{step?.action || 'review'}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <section className={styles.section} aria-labelledby="agent-disclosures-heading">
                <h3 className={styles.sectionTitle} id="agent-disclosures-heading">Downloads and host changes</h3>
                <ul className={styles.disclosureList}>
                  {disclosures.map((disclosure, index) => (
                    <li className={styles.disclosure} key={disclosure?.id || index}>
                      <h4>{disclosure?.title || 'Host change'}</h4>
                      {disclosure?.detail && <p className={styles.meta}>{disclosure.detail}</p>}
                      {disclosure?.origin && (
                        <p className={styles.meta}>Download origin: <a href={disclosure.origin} target="_blank" rel="noreferrer">{disclosure.origin}</a></p>
                      )}
                      {disclosure?.destination && <p className={styles.meta}>Destination: <code>{disclosure.destination}</code></p>}
                      {disclosure?.executable && <p className={styles.meta}>Executable: <code>{disclosure.executable}</code></p>}
                      {disclosure?.formula && <p className={styles.meta}>Formula: <code>{disclosure.formula}</code></p>}
                      {disclosure?.firstEntry && <p className={styles.meta}>PATH priority: <code>{disclosure.firstEntry}</code></p>}
                      <p className={styles.meta}>{profileLabel(disclosure)}</p>
                      {disclosure?.profileControl && <p className={styles.meta}>{disclosure.profileControl}</p>}
                      <p className={styles.meta}>{authenticationLabel(disclosure)}</p>
                    </li>
                  ))}
                </ul>
              </section>

              <p className={styles.boundary}>
                Hypercanvas never asks for passwords, tokens, API keys, or agent credentials. Installation does not authenticate an agent; sign-in remains inside each CLI after launch.
              </p>

              <label className={styles.consent}>
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                <span>I reviewed this exact plan and authorize the listed host changes.</span>
              </label>
            </>
          )}

          {(view === 'progress' || view === 'operation-error') && <OperationProgress operation={operation} />}
        </main>

        <footer className={styles.footer}>
          {(view === 'select' || view === 'error') && (
            <button
              className={styles.primaryButton}
              type="button"
              disabled={unsupported || busy || selectedAgentIds.length === 0}
              onClick={() => requestPlan({ refreshPreflight: view === 'error' })}
            >
              {busy ? 'Checking host...' : view === 'error' ? 'Retry with fresh check' : 'Review setup plan'}
            </button>
          )}
          {view === 'review' && (
            <>
              <button className={styles.secondaryButton} type="button" onClick={() => setView('select')}>Change selection</button>
              <button className={styles.primaryButton} type="button" disabled={!consent || busy} onClick={startInstall}>
                {busy ? 'Starting...' : 'Install selected CLIs'}
              </button>
            </>
          )}
          {view === 'progress'
            && operation?.cancellation?.available === true
            && operation?.cancellation?.requested !== true
            && !operationSettled && (
            <button className={styles.dangerButton} type="button" disabled={cancelBusy} onClick={cancelOperation}>
              {cancelBusy ? 'Cancelling...' : 'Cancel setup'}
            </button>
          )}
          {(view === 'operation-error' || (view === 'progress' && operationSettled && operation?.status !== 'succeeded')) && (
            <button className={styles.primaryButton} type="button" disabled={busy} onClick={() => requestPlan({ refreshPreflight: true })}>
              {busy ? 'Checking host...' : 'Retry with fresh plan'}
            </button>
          )}
          {view === 'progress' && operation?.status === 'succeeded' && (
            <button className={styles.primaryButton} type="button" onClick={() => onOpenChange(false)}>Done</button>
          )}
        </footer>
      </Dialog.Content>
    </Dialog.Root>
  )
}
