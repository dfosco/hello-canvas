import { useState, useRef, useEffect, useCallback } from 'react'
import { getMenuWidgetTypes } from './widgets/widgetConfig.js'
import { listStories, getStoryData } from '../../core/index.js'
import styles from './CanvasControls.module.css'

const WIDGET_TYPES = getMenuWidgetTypes()

/**
 * Focused canvas toolbar — bottom-left add-widget control.
 */
export default function CanvasControls({ onAddWidget }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [storyPicker, setStoryPicker] = useState(false)
  const menuRef = useRef(null)

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    function handlePointerDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
        setStoryPicker(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [menuOpen])

  const handleAddWidget = useCallback((type) => {
    onAddWidget(type)
    setMenuOpen(false)
    setStoryPicker(false)
  }, [onAddWidget])

  const handleAddStory = useCallback((storyId) => {
    document.dispatchEvent(new CustomEvent('storyboard:canvas:add-story-widget', { detail: { storyId } }))
    setMenuOpen(false)
    setStoryPicker(false)
  }, [])

  const storyNames = storyPicker ? listStories() : []

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Canvas controls">
      <div ref={menuRef} className={styles.createGroup}>
        <button
          className={styles.btn}
          onClick={() => { setMenuOpen((v) => !v); setStoryPicker(false) }}
          aria-label="Add widget"
          aria-expanded={menuOpen}
          title="Add widget"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
          </svg>
        </button>
        {menuOpen && !storyPicker && (
          <div className={styles.menu} role="menu">
            <div className={styles.menuLabel}>Add to canvas</div>
            {WIDGET_TYPES.map((wt) => (
              <button
                key={wt.type}
                className={styles.menuItem}
                role="menuitem"
                onClick={() => handleAddWidget(wt.type)}
              >
                {wt.label}
              </button>
            ))}
            <div className={styles.menuDivider} />
            <button
              className={styles.menuItem}
              role="menuitem"
              onClick={() => setStoryPicker(true)}
            >
              📖 Component
            </button>
          </div>
        )}
        {menuOpen && storyPicker && (
          <div className={styles.menu} role="menu">
            <div className={styles.menuLabel}>
              <button
                className={styles.backBtn}
                onClick={() => setStoryPicker(false)}
                aria-label="Back"
              >←</button>
              Select component
            </div>
            {storyNames.length === 0 && (
              <div className={styles.menuEmpty}>No stories found</div>
            )}
            {storyNames.map((name) => {
              const story = getStoryData(name)
              return (
                <button
                  key={name}
                  className={styles.menuItem}
                  role="menuitem"
                  onClick={() => handleAddStory(name)}
                >
                  {name}
                  {story?._route && <span className={styles.menuHint}>{story._route}</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
