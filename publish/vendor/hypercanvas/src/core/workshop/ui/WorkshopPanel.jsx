import { useState, useMemo, useEffect, useCallback } from 'react'

export default function WorkshopPanel({ features = [] }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeOverlay, setActiveOverlay] = useState(null)
  const [visible, setVisible] = useState(true)

  const activeFeature = useMemo(
    () => (activeOverlay ? features.find((f) => f.overlayId === activeOverlay) ?? null : null),
    [activeOverlay, features]
  )

  const showOverlay = useCallback((id) => {
    setActiveOverlay(id)
    setMenuOpen(false)
  }, [])

  const closeOverlay = useCallback(() => setActiveOverlay(null), [])

  const handleKeydown = useCallback(
    (e) => {
      if (e.key === '.' && (e.metaKey || e.ctrlKey)) {
        setVisible((v) => !v)
        return
      }
      if (e.key === 'Escape') {
        setActiveOverlay((cur) => {
          if (cur) return null
          setMenuOpen(false)
          return cur
        })
      }
    },
    []
  )

  const handleClickOutside = useCallback((e) => {
    if (!e.target.closest('[data-workshop-panel]')) {
      setMenuOpen(false)
    }
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', handleKeydown)
    document.addEventListener('click', handleClickOutside)
    return () => {
      window.removeEventListener('keydown', handleKeydown)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [handleKeydown, handleClickOutside])

  if (!visible) return null

  const ActiveOverlay = activeFeature?.overlay

  return (
    <div data-workshop-panel className="fixed bottom-6 right-[76px] z-[9999] font-sans">
      <button
        className="flex items-center p-3 bg-popover text-muted-foreground border border-border rounded-full cursor-pointer shadow-lg hover:scale-105 active:scale-95 transition-transform select-none"
        aria-label="Workshop"
        onClick={() => setMenuOpen((o) => !o)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
          <path d="M5.433 2.304A4.494 4.494 0 0 0 3.5 6c0 1.598.832 3.002 2.09 3.802.518.328.929.923.902 1.64v.008l-.164 3.337a.75.75 0 1 1-1.498-.073l.163-3.34c.007-.14-.1-.313-.36-.465A5.986 5.986 0 0 1 2 6a5.994 5.994 0 0 1 2.567-4.92 1.482 1.482 0 0 1 1.673-.04c.462.296.76.827.76 1.423v2.076c0 .332.214.572.491.572.268 0 .492-.24.492-.572V2.463c0-.596.298-1.127.76-1.423a1.482 1.482 0 0 1 1.673.04A5.994 5.994 0 0 1 13 6a5.986 5.986 0 0 1-2.633 4.909c-.26.152-.367.325-.36.465l.164 3.34a.75.75 0 1 1-1.498.073l-.164-3.337v-.008c-.027-.717.384-1.312.902-1.64A4.494 4.494 0 0 0 11.5 6a4.494 4.494 0 0 0-1.933-3.696c-.024.017-.067.067-.067.159v2.076c0 1.074-.84 2.072-1.991 2.072-1.161 0-2.009-.998-2.009-2.072V2.463c0-.092-.043-.142-.067-.16Z" />
        </svg>
      </button>

      {menuOpen && (
        <div className="absolute bottom-14 right-0 min-w-[200px] bg-popover text-popover-foreground border border-border rounded-xl shadow-lg overflow-hidden">
          <div className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Workshop</div>
          <div className="h-px bg-border" />
          {features.map((f) => (
            <button
              key={f.overlayId}
              className="flex items-center gap-2 w-full px-4 py-2 text-sm bg-transparent border-none cursor-pointer text-left hover:bg-accent transition-colors"
              onClick={() => showOverlay(f.overlayId)}
            >
              <span className="text-sm">{f.icon || ''}</span> {f.label}
            </button>
          ))}
          <div className="h-px bg-border" />
          <div className="px-4 py-1.5 text-[11px] text-muted-foreground">Dev-only tools</div>
        </div>
      )}

      {ActiveOverlay && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50"
          onClick={(e) => { if (e.target === e.currentTarget) closeOverlay() }}
        >
          <div className="w-full max-w-[480px]">
            <ActiveOverlay onClose={closeOverlay} />
          </div>
        </div>
      )}
    </div>
  )
}
