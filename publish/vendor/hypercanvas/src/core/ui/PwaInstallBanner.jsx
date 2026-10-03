/**
 * PwaInstallBanner — mobile-only "Add to Home Screen" prompt.
 *
 * Listens for the `beforeinstallprompt` event (Chrome/Edge) and shows a
 * dismissible banner. Never shows on desktop or when already installed.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import './PwaInstallBanner.css'
import { isMobile, isTouchDevice, subscribeToMobile } from '../utils/mobileViewport.js'

const DISMISS_KEY = 'sb-pwa-install-dismissed'

function isStandalone() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

function isDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
}

const bannerStyle = {
  position: 'fixed',
  bottom: '5rem',
  left: '1rem',
  right: '1rem',
  zIndex: 10000,
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.75rem 1rem',
  background: 'var(--color-background, #0d1117)',
  color: 'var(--color-foreground, #e6edf3)',
  border: '1px solid var(--color-border, #30363d)',
  borderRadius: '0.75rem',
  fontFamily: '"Mona Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
  fontSize: '0.8125rem',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
}

const btnBase = {
  border: 'none',
  borderRadius: '0.375rem',
  padding: '0.375rem 0.75rem',
  fontSize: '0.8125rem',
  cursor: 'pointer',
  fontWeight: 500,
}

const installBtnStyle = {
  ...btnBase,
  background: 'var(--color-background-success-emphasis, #238636)',
  color: '#fff',
}

const dismissBtnStyle = {
  ...btnBase,
  background: 'transparent',
  color: 'var(--color-foreground-muted, #8d96a0)',
  padding: '0.375rem',
}

export default function PwaInstallBanner() {
  const [showBanner, setShowBanner] = useState(false)
  const deferredPromptRef = useRef(null)

  const handleBeforeInstallPrompt = useCallback((e) => {
    e.preventDefault()
    deferredPromptRef.current = e
    if (isMobile() && isTouchDevice() && !isStandalone() && !isDismissed()) {
      setShowBanner(true)
    }
  }, [])

  const handleInstall = useCallback(async () => {
    const prompt = deferredPromptRef.current
    if (!prompt) return
    prompt.prompt()
    const { outcome } = await prompt.userChoice
    deferredPromptRef.current = null
    setShowBanner(false)
    if (outcome === 'dismissed') {
      try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* empty */ }
    }
  }, [])

  const handleDismiss = useCallback(() => {
    setShowBanner(false)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* empty */ }
  }, [])

  useEffect(() => {
    const handleInstalled = () => setShowBanner(false)
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)

    const unsubMobile = subscribeToMobile((mobile) => {
      if (!mobile) setShowBanner(false)
      else if (deferredPromptRef.current && isTouchDevice() && !isStandalone() && !isDismissed()) {
        setShowBanner(true)
      }
    })

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
      if (unsubMobile) unsubMobile()
    }
  }, [handleBeforeInstallPrompt])

  if (!showBanner) return null

  return (
    <div style={bannerStyle} role="alert">
      <span style={{ flex: 1 }}>Add Storyboard to your home screen</span>
      <button style={installBtnStyle} onClick={handleInstall}>Install</button>
      <button style={dismissBtnStyle} onClick={handleDismiss} aria-label="Dismiss">✕</button>
    </div>
  )
}
