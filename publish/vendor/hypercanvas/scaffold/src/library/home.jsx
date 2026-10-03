/** DO NOT EDIT — compatibility alias for the former home surface. */
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export default function HomeCompatibilityRoute() {
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    navigate(`/${location.search || ''}${location.hash || ''}`, { replace: true })
  }, [location.hash, location.search, navigate])
  return null
}
