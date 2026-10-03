/**
 * SidePanel — push-style panel for Documentation and Inspector views.
 *
 * Can dock to the right edge (side) or bottom edge of the viewport.
 * When open, pushes #root content via CSS classes on <html>.
 * Background color follows the active mode's collar color.
 * Resizable by dragging the panel edge.
 * Position preference (side/bottom) is persisted in localStorage.
 *
 * Mounted lazily from CoreUIBar when a side panel trigger is clicked.
 */

import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import octicons from '@primer/octicons'
import { sidePanelState, closePanel } from '../stores/sidePanelStore.js'
import './sidepanel.css'
import RunningSitesPanel from './RunningSitesPanel.jsx'

const MIN_WIDTH = 300
const MAX_WIDTH = 900
const MIN_HEIGHT = 200
const MAX_HEIGHT = 600

const LazyInspectorPanel = lazy(() => import('./InspectorPanel.jsx'))
const LazyPublishPanel = lazy(() => import('./PublishControl.jsx').then(module => ({ default: module.PublishPanel })))

function OcticonSvg({ name, size = 16 }) {
  const icon = octicons[name]
  if (!icon) return null
  const svg = icon.toSVG({ width: size, height: size }).replace('<svg ', '<svg fill="currentColor" ')
  return <span style={{ display: 'inline-flex', alignItems: 'center' }} dangerouslySetInnerHTML={{ __html: svg }} />
}

export default function SidePanel({ resizable = true, onClose, basePath = '/' }) {
  const [panelState, setPanelState] = useState({ open: false, activeTab: 'inspector' })
  const [panelWidth, setPanelWidth] = useState(420)
  const [panelHeight, setPanelHeight] = useState(300)
  const [panelPosition, setPanelPosition] = useState('side')
  const [dragging, setDragging] = useState(false)
  const closeBtnRef = useRef(null)

  const isFixedSideTab = panelState.activeTab === 'sites' || panelState.activeTab === 'publish'
  const isBottom = panelPosition === 'bottom' && !isFixedSideTab

  // Subscribe to the framework-agnostic store
  useEffect(() => {
    return sidePanelState.subscribe(setPanelState)
  }, [])

  // Sync panel width to CSS custom property
  useEffect(() => {
    document.documentElement.style.setProperty('--sb--sidepanel-width', `${panelWidth}px`)
  }, [panelWidth])

  // Sync panel height to CSS custom property
  useEffect(() => {
    document.documentElement.style.setProperty('--sb--sidepanel-height', `${panelHeight}px`)
  }, [panelHeight])

  // Sync position class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('sb-sidepanel-bottom', isBottom)
    return () => document.documentElement.classList.remove('sb-sidepanel-bottom')
  }, [isBottom])

  // Auto-focus close button when panel opens
  useEffect(() => {
    if (panelState.open && closeBtnRef.current) {
      requestAnimationFrame(() => closeBtnRef.current?.focus())
    }
  }, [panelState.open])

  // Restore dimensions and position from localStorage
  useEffect(() => {
    const savedWidth = localStorage.getItem('sb-sidepanel-width')
    if (savedWidth) {
      const w = parseInt(savedWidth, 10)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (w >= MIN_WIDTH && w <= MAX_WIDTH) setPanelWidth(w)
    }

    const savedHeight = localStorage.getItem('sb-sidepanel-height')
    if (savedHeight) {
      const h = parseInt(savedHeight, 10)
      if (h >= MIN_HEIGHT && h <= MAX_HEIGHT) setPanelHeight(h)
    }

    const savedPos = localStorage.getItem('sb-sidepanel-position')
    if (savedPos === 'side' || savedPos === 'bottom') setPanelPosition(savedPos)
  }, [])

  // Persist width
  useEffect(() => {
    localStorage.setItem('sb-sidepanel-width', String(panelWidth))
  }, [panelWidth])

  // Persist height
  useEffect(() => {
    localStorage.setItem('sb-sidepanel-height', String(panelHeight))
  }, [panelHeight])

  // Persist position
  useEffect(() => {
    localStorage.setItem('sb-sidepanel-position', panelPosition)
  }, [panelPosition])

  // Escape key handler
  useEffect(() => {
    function handleKeydown(e) {
      if (e.key === 'Escape' && panelState.open) {
        e.preventDefault()
        closePanel()
        onClose?.()
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [panelState.open, onClose])

  function togglePosition() {
    setPanelPosition(prev => prev === 'bottom' ? 'side' : 'bottom')
  }

  // Drag resize (side mode — horizontal)
  function startDragSide(e) {
    if (!resizable) return
    e.preventDefault()
    setDragging(true)

    const startX = e.clientX
    const startWidth = panelWidth

    function onMove(ev) {
      const delta = startX - ev.clientX
      setPanelWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta)))
    }

    function onUp() {
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Drag resize (bottom mode — vertical)
  function startDragBottom(e) {
    if (!resizable) return
    e.preventDefault()
    setDragging(true)

    const startY = e.clientY
    const startHeight = panelHeight

    function onMove(ev) {
      const delta = startY - ev.clientY
      setPanelHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + delta)))
    }

    function onUp() {
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function handleClose() {
    closePanel()
    onClose?.()
  }

  if (!panelState.open) return null

  const panelClassName = [
    'sb-sidepanel',
    isBottom && 'sb-sidepanel--bottom',
    dragging && 'sb-sidepanel-dragging',
  ].filter(Boolean).join(' ')

  const panelStyle = isBottom
    ? { height: `${panelHeight}px` }
    : { width: `${panelWidth}px` }

  const loading = (
    <div className="sb-sidepanel-loading">
      <span className="sb-sidepanel-spinner" />
    </div>
  )

  return (
    <div
      className={panelClassName}
      data-sidepanel=""
      data-sidepanel-tab={panelState.activeTab}
      role="complementary"
      aria-label={isBottom ? 'Bottom panel' : 'Side panel'}
      style={panelStyle}
    >
      {/* Drag handle */}
      {resizable && (
        <div
          className="sb-sidepanel-drag-handle"
          onPointerDown={isBottom ? startDragBottom : startDragSide}
          role="separator"
          aria-orientation={isBottom ? 'horizontal' : 'vertical'}
          aria-label="Resize panel"
        >
          <svg className="sb-sidepanel-grabber" width="4" height="16" viewBox="0 0 4 16" fill="currentColor">
            <circle cx="1" cy="2" r="1" /><circle cx="3" cy="2" r="1" />
            <circle cx="1" cy="6" r="1" /><circle cx="3" cy="6" r="1" />
            <circle cx="1" cy="10" r="1" /><circle cx="3" cy="10" r="1" />
            <circle cx="1" cy="14" r="1" /><circle cx="3" cy="14" r="1" />
          </svg>
        </div>
      )}

      {/* Header */}
      <div className="sb-sidepanel-header">
        <span className="sb-sidepanel-title">
          {panelState.activeTab === 'inspector' ? 'Inspector' : panelState.activeTab === 'sites' ? 'Sites' : panelState.activeTab === 'publish' ? 'Publish' : ''}
        </span>
        <div className="sb-sidepanel-actions">
          {!isFixedSideTab && (
            <button
              className="sb-sidepanel-action-btn"
              onClick={togglePosition}
              aria-label={isBottom ? 'Dock to side' : 'Dock to bottom'}
              title={isBottom ? 'Dock to side' : 'Dock to bottom'}
            >
              {isBottom ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                  <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" />
                  <line x1="9" y1="1.5" x2="9" y2="12.5" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                  <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" />
                  <line x1="1.5" y1="9" x2="12.5" y2="9" />
                </svg>
              )}
            </button>
          )}
          <button
            className="sb-sidepanel-action-btn"
            onClick={handleClose}
            aria-label="Close panel"
            ref={closeBtnRef}
          >
            <OcticonSvg name="x" size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="sb-sidepanel-body">
        <Suspense fallback={loading}>
          {panelState.activeTab === 'inspector' && <LazyInspectorPanel />}
          {panelState.activeTab === 'sites' && <RunningSitesPanel basePath={basePath} />}
          {panelState.activeTab === 'publish' && <LazyPublishPanel />}
        </Suspense>
      </div>
    </div>
  )
}
