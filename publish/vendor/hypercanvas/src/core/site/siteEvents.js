export function notifySiteStarted(siteId, developmentBaseUrl = null) {
  if (!siteId || typeof document === 'undefined') return
  document.dispatchEvent(new CustomEvent('storyboard:site-started', { detail: { siteId, developmentBaseUrl } }))
  document.dispatchEvent(new CustomEvent('storyboard:sites-changed'))
}

export function notifySiteFailed(siteId) {
  if (!siteId || typeof document === 'undefined') return
  document.dispatchEvent(new CustomEvent('storyboard:site-failed', { detail: { siteId } }))
  document.dispatchEvent(new CustomEvent('storyboard:sites-changed'))
}
