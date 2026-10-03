/**
 * AuthModal — PAT entry modal for comments authentication.
 * Uses shadcn Button, Input, Label, Alert, Avatar.
 */

import { useState, useEffect, useRef } from 'react'
import { setToken, validateToken } from '../auth.js'
import { getCommentsConfig } from '../config.js'
import { Button } from '../../lib/components/ui/button/index.js'
import { Input } from '../../lib/components/ui/input/index.js'
import { Label } from '../../lib/components/ui/label/index.js'
import * as Alert from '../../lib/components/ui/alert/index.js'
import * as Avatar from '../../lib/components/ui/avatar/index.js'

export default function AuthModal({ onDone, onClose, initialError = null }) {
  const [token, setTokenValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [user, setUser] = useState(null)
  const inputRef = useRef(null)

  const commentsConfig = getCommentsConfig()
  const repoOwner = commentsConfig?.repo?.owner || 'github'
  const repoName = commentsConfig?.repo?.name || 'storyboard'
  const repoSlug = `${repoOwner}/${repoName}`
  const tokenTemplateName = 'Storyboard Comments'
  const tokenTemplateDescription =
    `Token for enabling comments on ${repoSlug} prototype. Configure as:\n\n` +
    `Owner: ${repoOwner}\n` +
    'Expiration: 366 days (recommended)\n' +
    `Repository access: Only select repositories > ${repoSlug}\n` +
    'Permissions: Repositories > Discussions > Access: Read and Write'
  const tokenCreateUrl =
    `https://github.com/settings/personal-access-tokens/new?` +
    new URLSearchParams({
      name: tokenTemplateName,
      description: tokenTemplateDescription,
    }).toString()

  useEffect(() => {
    setError(initialError)
    inputRef.current?.focus()
  }, [])

  async function submit() {
    const val = token.trim()
    if (!val) return
    setSubmitting(true); setError(null)
    try { const result = await validateToken(val); setToken(val); setUser(result) }
    catch (err) { setError(err.message) }
    finally { setSubmitting(false) }
  }

  function done() { if (user) onDone?.(user) }

  function handleKeydown(e) {
    if (e.key === 'Enter' && !user) submit()
  }

  return (
    <div className="bg-popover text-popover-foreground border border-border rounded-lg shadow-lg overflow-hidden max-w-[600px] w-full font-sans">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-medium font-semibold">Sign in for comments</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="h-7 w-7 text-muted-foreground">&#215;</Button>
      </div>
      <div className="p-4 space-y-3">
        {error && <Alert.Root variant="destructive"><Alert.Description>{error}</Alert.Description></Alert.Root>}
        <p className="text-sm text-muted-foreground leading-relaxed">
          Leave comments for other users to see and respond, and react to! Storyboard comments use Discussions as a back-end and require a GitHub PAT to be enabled.
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Create a <a className="text-primary underline" href={tokenCreateUrl} target="_blank" rel="noopener">GitHub Fine-Grained Personal Access Token</a> with the settings below to get started:
        </p>
        <div className="px-3 py-2 bg-muted border border-border rounded text-xs text-muted-foreground leading-relaxed">
          <div className="mb-1"><strong className="text-foreground">Fine-grained Personal Access Token</strong></div>
          <div>Owner: <code className="px-1 bg-background rounded font-mono text-foreground">{repoOwner}</code></div>
          <div>Expiration: <code className="px-1 bg-background rounded font-mono text-foreground">366 days</code> (recommended)</div>
          <div>Repository access: <code className="px-1 bg-background rounded font-mono text-foreground">Only select repositories &gt; {repoSlug}</code></div>
          <div>Permissions: <code className="px-1 bg-background rounded font-mono text-foreground">Repositories &gt; Discussions &gt; Access: Read and Write</code></div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sb-auth-token-input">Personal Access Token</Label>
          <Input
            id="sb-auth-token-input"
            type="password"
            placeholder="github_pat_… or ghp_…"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            value={token}
            onChange={(e) => setTokenValue(e.target.value)}
            ref={inputRef}
            onKeyDown={handleKeydown}
          />
        </div>
        {user && (
          <div className="flex items-center py-1 gap-3">
            <Avatar.Root className="h-10 w-10"><Avatar.Image src={user.avatarUrl} alt={user.login} /><Avatar.Fallback>{user.login[0]?.toUpperCase()}</Avatar.Fallback></Avatar.Root>
            <div className="text-sm"><span className="text-foreground">{user.login}</span><span className="block text-xs text-success mt-0.5">&#10003; Signed in</span></div>
          </div>
        )}
        <Alert.Root variant="warning" className="bg-amber-100 border-amber-300">
          <Alert.Description className="text-amber-700">
            ⚠️ Comments are an experimental feature and may be unstable.
          </Alert.Description>
        </Alert.Root>
      </div>
      <div className="flex items-center justify-end px-4 py-3 border-t border-border gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={submitting} onClick={user ? done : submit}>{user ? 'Done' : (submitting ? 'Validating\u2026' : 'Sign in')}</Button>
      </div>
    </div>
  )
}
