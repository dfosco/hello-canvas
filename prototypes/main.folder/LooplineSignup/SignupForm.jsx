import { useEffect, useRef } from 'react'
import { useKnob, useOverride } from '@dfosco/storyboard'

function GoogleIcon({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.2 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.2 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.6l6.3 5.3C41.4 35.5 44 30.2 44 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  )
}

function GitHubIcon({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18.92-.26 1.91-.39 2.9-.39.99 0 1.98.13 2.9.39 2.21-1.49 3.18-1.18 3.18-1.18.62 1.59.23 2.76.11 3.05.73.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.41-5.25 5.69.41.36.77 1.06.77 2.14v3.17c0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  )
}

function deriveNameFromHandle(handle) {
  if (!handle) return ''
  const local = String(handle).split('@')[0].replace(/[._-]+/g, ' ').trim()
  if (!local) return ''
  return local
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

// --- Google OAuth modal -----------------------------------------------------

function GoogleOAuthModal({ step, identifier, password, onIdentifier, onPassword, onNext, onAuthorize, onCancel }) {
  const isCredentials = step === 'account' || step === 'password'
  const isConsent = step === 'consent'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-lg bg-card text-foreground shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-muted-foreground">
          <span className="font-mono">🔒 accounts.google.com</span>
          <button onClick={onCancel} className="rounded p-1 hover:bg-muted" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="px-10 py-8">
          <div className="mb-6 flex items-center gap-2">
            <span className="text-2xl font-medium tracking-tight text-[#4285F4]">G</span>
            <span className="text-2xl font-medium tracking-tight text-[#EA4335]">o</span>
            <span className="text-2xl font-medium tracking-tight text-[#FBBC05]">o</span>
            <span className="text-2xl font-medium tracking-tight text-[#4285F4]">g</span>
            <span className="text-2xl font-medium tracking-tight text-[#34A853]">l</span>
            <span className="text-2xl font-medium tracking-tight text-[#EA4335]">e</span>
          </div>

          {isCredentials && (
            <>
              <h2 className="mb-2 text-2xl text-foreground">Sign in</h2>
              <p className="mb-6 text-sm text-muted-foreground">to continue to Loopline</p>

              {step === 'account' && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (identifier.trim()) onNext()
                  }}
                >
                  <input
                    autoFocus
                    type="email"
                    value={identifier}
                    onChange={(e) => onIdentifier(e.target.value)}
                    placeholder="Email or phone"
                    className="block w-full rounded border border-border bg-background px-3 py-3 text-sm text-foreground focus:border-[#1a73e8] focus:outline-none focus:ring-1 focus:ring-[#1a73e8]"
                  />
                  <a href="#" className="mt-3 inline-block text-sm font-medium text-[#1a73e8]">
                    Forgot email?
                  </a>
                  <p className="mt-6 text-xs text-muted-foreground">
                    Not your computer? Use Guest mode to sign in privately.
                  </p>
                  <a href="#" className="mt-1 inline-block text-sm font-medium text-[#1a73e8]">
                    Learn more
                  </a>
                  <div className="mt-8 flex items-center justify-between">
                    <a href="#" className="text-sm font-medium text-[#1a73e8]">
                      Create account
                    </a>
                    <button
                      type="submit"
                      disabled={!identifier.trim()}
                      className="rounded bg-blue-600 dark:bg-blue-500 px-6 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Next
                    </button>
                  </div>
                </form>
              )}

              {step === 'password' && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (password.trim()) onNext()
                  }}
                >
                  <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm text-foreground">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                      {(identifier[0] || 'A').toUpperCase()}
                    </span>
                    {identifier}
                    <button type="button" onClick={() => onNext('back')} className="ml-1 text-muted-foreground hover:text-foreground">
                      ⌄
                    </button>
                  </div>
                  <input
                    autoFocus
                    type="password"
                    value={password}
                    onChange={(e) => onPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="block w-full rounded border border-border bg-background px-3 py-3 text-sm text-foreground focus:border-[#1a73e8] focus:outline-none focus:ring-1 focus:ring-[#1a73e8]"
                  />
                  <label className="mt-4 flex items-center gap-2 text-sm text-foreground">
                    <input type="checkbox" className="h-4 w-4 rounded border-border" />
                    Show password
                  </label>
                  <div className="mt-8 flex items-center justify-between">
                    <a href="#" className="text-sm font-medium text-[#1a73e8]">
                      Forgot password?
                    </a>
                    <button
                      type="submit"
                      disabled={!password.trim()}
                      className="rounded bg-blue-600 dark:bg-blue-500 px-6 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Next
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          {isConsent && (
            <>
              <div className="mb-5 flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-base font-bold text-white">
                  🔁
                </span>
                <h2 className="text-xl text-foreground">Loopline wants to access your Google Account</h2>
              </div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm text-foreground">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                  {(identifier[0] || 'A').toUpperCase()}
                </span>
                {identifier}
              </div>

              <p className="mb-2 text-sm font-medium text-foreground">This will allow Loopline to:</p>
              <ul className="mb-6 space-y-2 text-sm text-foreground">
                <li className="flex gap-2">
                  <span className="text-muted-foreground">·</span>
                  See your name, email address, and profile picture
                </li>
                <li className="flex gap-2">
                  <span className="text-muted-foreground">·</span>
                  Associate you with your personal info on Google
                </li>
              </ul>
              <p className="mb-6 text-xs text-muted-foreground">
                Make sure you trust Loopline. You can review or remove access in your Google Account.
              </p>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  className="rounded px-4 py-2 text-sm font-medium text-[#1a73e8] hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onAuthorize}
                  className="rounded bg-blue-600 dark:bg-blue-500 px-5 py-2 text-sm font-medium text-white hover:brightness-110"
                >
                  Allow
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// --- GitHub OAuth modal -----------------------------------------------------

function GitHubOAuthModal({ step, identifier, password, onIdentifier, onPassword, onNext, onAuthorize, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-md bg-background text-foreground shadow-2xl">
        <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2 text-xs text-muted-foreground">
          <span className="font-mono">🔒 github.com/login</span>
          <button onClick={onCancel} className="rounded p-1 hover:bg-muted" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex flex-col items-center bg-background px-8 py-8">
          <GitHubIcon className="mb-4 h-10 w-10 text-foreground" />

          {step !== 'consent' ? (
            <>
              <h2 className="mb-6 text-xl font-light text-foreground">Sign in to GitHub</h2>
              <form
                className="w-full rounded-md border border-border bg-card p-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (identifier.trim() && password.trim()) onNext()
                }}
              >
                <label className="block text-sm font-semibold text-foreground">
                  Username or email address
                </label>
                <input
                  autoFocus
                  type="text"
                  value={identifier}
                  onChange={(e) => onIdentifier(e.target.value)}
                  className="mt-1 mb-4 block w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-[#0969da] focus:outline-none focus:ring-2 focus:ring-[#0969da]/30"
                />
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-foreground">Password</label>
                  <a href="#" className="text-xs text-[#0969da]">
                    Forgot password?
                  </a>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => onPassword(e.target.value)}
                  className="mt-1 mb-4 block w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-[#0969da] focus:outline-none focus:ring-2 focus:ring-[#0969da]/30"
                />
                <button
                  type="submit"
                  disabled={!identifier.trim() || !password.trim()}
                  className="block w-full rounded-md bg-green-600 dark:bg-green-500 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Sign in
                </button>
              </form>
              <p className="mt-4 w-full rounded-md border border-border bg-card px-4 py-3 text-center text-sm text-foreground">
                New to GitHub?{' '}
                <a href="#" className="text-[#0969da]">
                  Create an account
                </a>
                .
              </p>
            </>
          ) : (
            <div className="w-full rounded-md border border-border bg-card">
              <div className="border-b border-border px-5 py-4">
                <h2 className="text-lg font-semibold text-foreground">Authorize Loopline</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Signed in as <span className="font-semibold">{identifier}</span>
                </p>
              </div>
              <div className="px-5 py-4">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 text-xl text-white">
                    🔁
                  </span>
                  <div className="text-sm text-foreground">
                    <div className="font-semibold text-foreground">Loopline by loopline-hq</div>
                    <div className="text-xs text-muted-foreground">wants to access your GitHub account</div>
                  </div>
                </div>
                <p className="mb-2 text-sm font-semibold text-foreground">This application will be able to:</p>
                <ul className="mb-4 space-y-2 rounded-md border border-border bg-muted p-3 text-sm text-foreground">
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-green-600">✓</span>
                    Read your profile info (name, email, avatar)
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-green-600">✓</span>
                    Read your public repositories
                  </li>
                </ul>
                <p className="mb-4 text-xs text-muted-foreground">
                  Authorizing will redirect to <span className="font-mono">loopline.app</span>
                </p>
                <button
                  type="button"
                  onClick={onAuthorize}
                  className="block w-full rounded-md bg-green-600 dark:bg-green-500 px-4 py-1.5 text-sm font-semibold text-white hover:brightness-110"
                >
                  Authorize loopline-hq
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  className="mt-2 block w-full rounded-md border border-border bg-card px-4 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// --- Main form --------------------------------------------------------------

export default function SignupForm() {
  const showSocial = useKnob('showSocial') ?? true
  const [fullName, setFullName] = useOverride('signup.fullName', '')
  const [email, setEmail] = useOverride('signup.email', '')
  const [company, setCompany] = useOverride('signup.company', '')
  const [password, setPassword] = useOverride('signup.password', '')
  const [agreedToTerms, setAgreedToTerms] = useOverride('signup.agreedToTerms', false)
  const [status, setStatus] = useOverride('signup.status', 'idle')
  const [oauthProvider, setOauthProvider] = useOverride('signup.oauthProvider', '')
  const [oauthStep, setOauthStep] = useOverride('signup.oauthStep', 'idle')
  const [oauthIdentifier, setOauthIdentifier] = useOverride('signup.oauthIdentifier', '')
  const [oauthPassword, setOauthPassword] = useOverride('signup.oauthPassword', '')

  const safeName = fullName ?? ''
  const safeEmail = email ?? ''
  const safeCompany = company ?? ''
  const safePassword = password ?? ''
  const safeAgreed = Boolean(agreedToTerms)
  const safeIdentifier = oauthIdentifier ?? ''
  const safeOauthPassword = oauthPassword ?? ''
  const shouldShowSocial = showSocial !== false

  const isSubmitting = status === 'submitting'
  const isSuccess = status === 'success'
  const oauthOpen = shouldShowSocial && oauthProvider && oauthStep !== 'idle' && !isSuccess

  const canSubmit =
    safeName.trim() &&
    safeEmail.trim() &&
    safeCompany.trim() &&
    safePassword.trim() &&
    safeAgreed &&
    !isSubmitting

  const userSubmittedRef = useRef(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!canSubmit) return
    userSubmittedRef.current = true
    setStatus('submitting')
  }

  useEffect(() => {
    if (status !== 'submitting' || !userSubmittedRef.current) return
    const t = setTimeout(() => setStatus('success'), 2500)
    return () => clearTimeout(t)
  }, [status, setStatus])

  const openOAuth = (provider) => {
    setOauthProvider(provider)
    setOauthIdentifier('')
    setOauthPassword('')
    setOauthStep(provider === 'google' ? 'account' : 'credentials')
  }

  const cancelOAuth = () => {
    setOauthProvider('')
    setOauthStep('idle')
    setOauthIdentifier('')
    setOauthPassword('')
  }

  const advanceOAuth = (action) => {
    if (oauthProvider === 'google') {
      if (oauthStep === 'account') setOauthStep('password')
      else if (oauthStep === 'password') {
        if (action === 'back') setOauthStep('account')
        else setOauthStep('consent')
      }
    } else if (oauthProvider === 'github') {
      if (oauthStep === 'credentials') setOauthStep('consent')
    }
  }

  const authorizeOAuth = () => {
    const id = safeIdentifier.trim()
    const derivedName = deriveNameFromHandle(id) || 'New User'
    const derivedEmail =
      oauthProvider === 'github' && !id.includes('@')
        ? `${id}@users.noreply.github.com`
        : id
    const derivedCompany =
      oauthProvider === 'github'
        ? `${id.split('@')[0]}-org`
        : (id.split('@')[1]?.split('.')[0]?.replace(/^./, (c) => c.toUpperCase()) || 'My Company')

    setFullName(derivedName)
    setEmail(derivedEmail)
    setCompany(derivedCompany)
    setPassword('oauth-no-password')
    setAgreedToTerms(true)
    setOauthStep('idle')
    setStatus('success')
  }

  const inputClass =
    'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30'

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center bg-background px-6 py-12 text-foreground">
      <div className="w-full max-w-md">
        {isSuccess ? (
          <div className="rounded-xl border border-green-200 dark:border-green-900 bg-neutral-50 dark:bg-neutral-900 p-6 text-center text-foreground shadow-lg shadow-black/20">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-600 dark:bg-green-500 text-2xl text-white">
              ✓
            </div>
            <h2 className="text-xl font-semibold text-foreground">You&apos;re in!</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Welcome aboard, {safeName || 'friend'}.{' '}
              {oauthProvider
                ? `Signed in with ${oauthProvider === 'google' ? 'Google' : 'GitHub'}.`
                : 'Check your inbox to verify your email.'}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Create your account
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Start closing the feedback loop in minutes. No credit card required.
              </p>
            </div>

            {shouldShowSocial && (
              <>
                <section data-knob-id="showSocial" className="mb-6 grid grid-cols-2 gap-3" aria-label="Social signup options">
                  <button
                    type="button"
                    onClick={() => openOAuth('google')}
                    disabled={isSubmitting}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-muted focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <GoogleIcon />
                    Continue with Google
                  </button>
                  <button
                    type="button"
                    onClick={() => openOAuth('github')}
                    disabled={isSubmitting}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-muted focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <GitHubIcon />
                    Continue with GitHub
                  </button>
                </section>

                <div className="relative mb-6">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-background px-2 text-xs uppercase tracking-wider text-muted-foreground">
                      or with email
                    </span>
                  </div>
                </div>
              </>
            )}

            <form className="space-y-4" onSubmit={handleSubmit} noValidate>
              <div>
                <label htmlFor="fullName" className="block text-sm font-medium text-foreground">
                  Full name
                </label>
                <input
                  id="fullName"
                  type="text"
                  autoComplete="name"
                  value={safeName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ada Lovelace"
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-foreground">
                  Work email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={safeEmail}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="company" className="block text-sm font-medium text-foreground">
                  Company
                </label>
                <input
                  id="company"
                  type="text"
                  autoComplete="organization"
                  value={safeCompany}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Analytical Engines"
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-foreground">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={safePassword}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className={inputClass}
                />
              </div>

              <div className="flex items-start gap-2 pt-1">
                <input
                  id="terms"
                  type="checkbox"
                  checked={safeAgreed}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="terms" className="text-sm text-muted-foreground">
                  I agree to the{' '}
                  <a href="#" className="font-medium text-indigo-600 hover:text-indigo-500">
                    Terms of Service
                  </a>{' '}
                  and{' '}
                  <a href="#" className="font-medium text-indigo-600 hover:text-indigo-500">
                    Privacy Policy
                  </a>
                  .
                </label>
              </div>

              <button
                type="submit"
                disabled={!canSubmit}
                className={`inline-flex w-full items-center justify-center rounded-md px-4 py-2.5 text-sm font-semibold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 focus:ring-offset-background ${
                  canSubmit
                    ? 'bg-blue-600 dark:bg-blue-500 text-white hover:brightness-110'
                    : 'cursor-not-allowed bg-muted text-muted-foreground'
                }`}
              >
                {isSubmitting ? 'Creating account…' : 'Create account'}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <a href="#" className="font-medium text-indigo-600 hover:text-indigo-500">
                Sign in
              </a>
            </p>
          </>
        )}
      </div>

      {oauthOpen && oauthProvider === 'google' && (
        <GoogleOAuthModal
          step={oauthStep}
          identifier={safeIdentifier}
          password={safeOauthPassword}
          onIdentifier={setOauthIdentifier}
          onPassword={setOauthPassword}
          onNext={advanceOAuth}
          onAuthorize={authorizeOAuth}
          onCancel={cancelOAuth}
        />
      )}

      {oauthOpen && oauthProvider === 'github' && (
        <GitHubOAuthModal
          step={oauthStep}
          identifier={safeIdentifier}
          password={safeOauthPassword}
          onIdentifier={setOauthIdentifier}
          onPassword={setOauthPassword}
          onNext={advanceOAuth}
          onAuthorize={authorizeOAuth}
          onCancel={cancelOAuth}
        />
      )}
    </div>
  )
}
