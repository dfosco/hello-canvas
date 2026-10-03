import { useEffect } from 'react'

/**
 * Backward-compatible entry alias: /viewfinder → Notebook entry resolver.
 */
export default function ViewfinderRedirect() {
  useEffect(() => {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')
    window.location.replace(`${base}/${window.location.search}${window.location.hash}`)
  }, [])
  return null
}
