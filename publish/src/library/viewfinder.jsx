import { useEffect } from 'react'

/**
 * Backward-compat redirect: /viewfinder → /workspace
 * Kept for one release cycle so existing bookmarks and links still work.
 */
export default function ViewfinderRedirect() {
  useEffect(() => {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')
    window.location.replace(`${base}/workspace${window.location.hash}`)
  }, [])
  return null
}
