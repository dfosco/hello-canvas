/**
 * AuthModal — Global PAT entry dialog for comments authentication.
 * Mounted at app root, triggered by:
 *   - CoreUIBar (comments tool / "C" shortcut) via 'storyboard:open-auth-modal' event
 *   - ViewfinderNew sidebar login button via same event
 */
import { useState, useEffect, useCallback } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import css from './AuthModal.module.css'

const COMMENTS_TOKEN_KEY = 'sb-comments-token'

function getRepoInfo() {
  try {
    // eslint-disable-next-line no-undef
    const cfg = typeof __STORYBOARD_CONFIG__ !== 'undefined' ? __STORYBOARD_CONFIG__ : null
    const repo = cfg?.repository
    if (repo?.owner && repo?.name) return repo
  } catch { /* ignore */ }
  return { owner: 'github', name: 'storyboard' }
}

export default function AuthModal() {
  const [open, setOpen] = useState(false)
  const [tokenValue, setTokenValue] = useState('')

  useEffect(() => {
    function handleOpen() { setOpen(true) }
    document.addEventListener('storyboard:open-auth-modal', handleOpen)
    return () => document.removeEventListener('storyboard:open-auth-modal', handleOpen)
  }, [])

  const handleSignIn = useCallback(() => {
    const trimmed = tokenValue.trim()
    if (!trimmed) return

    try { localStorage.setItem(COMMENTS_TOKEN_KEY, trimmed) } catch { /* ignore */ }

    try {
      import('../../core/comments/index.js').then(({ setToken, validateToken }) => {
        setToken(trimmed)
        // Validate to cache user info (login + avatar), then notify Viewfinder
        validateToken(trimmed)
          .then(() => document.dispatchEvent(new CustomEvent('storyboard:auth-changed')))
          .catch(() => document.dispatchEvent(new CustomEvent('storyboard:auth-changed')))
      }).catch(() => {})
    } catch { /* comments module may not be initialized */ }

    setTokenValue('')
    setOpen(false)
  }, [tokenValue])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') handleSignIn()
  }, [handleSignIn])

  const repo = getRepoInfo()

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className={css.backdrop} />
        <div className={css.popupWrap}>
          <Dialog.Popup className={css.popup}>
            <Dialog.Title className={css.title}>Sign in with GitHub</Dialog.Title>
            <Dialog.Description className={css.desc}>
              Leave comments for other users to see and respond, and react to! Storyboard
              comments use Discussions as a back-end and require a GitHub PAT to be enabled.
            </Dialog.Description>
            <Dialog.Close className={css.closeBtn} aria-label="Close">×</Dialog.Close>

            <hr className={css.separator} />

            <div className={css.tokenCard}>
              <p className={css.tokenCardTitle}>Fine-grained Personal Access Token</p>
              <div className={css.tokenCardRow}>
                <span className={css.tokenCardLabel}>Owner:</span>
                <code className={css.tokenCardCode}>{repo.owner}</code>
              </div>
              <div className={css.tokenCardRow}>
                <span className={css.tokenCardLabel}>Expiration:</span>
                <code className={css.tokenCardCode}>366 days</code>
                <span className={css.tokenCardHint}>(recommended)</span>
              </div>
              <div className={css.tokenCardRow}>
                <span className={css.tokenCardLabel}>Repository access:</span>
                <code className={css.tokenCardCode}>Only select repositories &gt; {repo.owner}/{repo.name}</code>
              </div>
              <div className={css.tokenCardRow}>
                <span className={css.tokenCardLabel}>Permissions:</span>
                <code className={css.tokenCardCode}>Repositories &gt; Discussions &gt; Access: Read and Write</code>
              </div>
            </div>

            <a
              className={css.tokenLink}
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noopener noreferrer"
            >
              Create a GitHub Fine-Grained Personal Access Token ↗
            </a>

            <hr className={css.separator} />

            <label className={css.label} htmlFor="auth-modal-token">Personal Access Token</label>
            <input
              id="auth-modal-token"
              className={css.input}
              placeholder="github_pat_… or ghp_…"
              type="password"
              autoFocus
              value={tokenValue}
              onChange={e => setTokenValue(e.target.value)}
              onKeyDown={handleKeyDown}
            />

            <div className={css.warning}>
              <span className={css.warningIcon}>⚠️</span>
              <span>Comments are an experimental feature and may be unstable.</span>
            </div>

            <div className={css.actions}>
              <Dialog.Close className={css.btnSecondary}>Cancel</Dialog.Close>
              <button className={css.btnPrimary} onClick={handleSignIn}>Sign in</button>
            </div>
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
