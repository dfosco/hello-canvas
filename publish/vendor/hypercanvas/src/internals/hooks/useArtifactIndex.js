import { useEffect, useMemo, useState } from 'react'
import { fetchArtifactIndex } from '../../core/data/artifactIndex.js'

function isLocalDev() {
  return typeof window !== 'undefined' && window.__SB_LOCAL_DEV__ === true
}

export function useArtifactIndex(basePath) {
  const normalizedBasePath = useMemo(() => basePath || '/', [basePath])
  const localDev = isLocalDev()
  const [state, setState] = useState(() => ({ artifactIndex: null, loading: !localDev }))

  useEffect(() => {
    if (localDev) return undefined

    let cancelled = false

    fetchArtifactIndex(normalizedBasePath)
      .then(index => {
        if (!cancelled) setState({ artifactIndex: index, loading: false })
      })
      .catch(() => {
        if (!cancelled) setState({ artifactIndex: null, loading: false })
      })

    return () => { cancelled = true }
  }, [localDev, normalizedBasePath])

  if (localDev) return { artifactIndex: null, loading: false }
  return state
}
