import { useState } from 'react'
import { addWidget as addWidgetApi } from './canvasApi.js'
import { schemas, getDefaults } from './widgets/widgetProps.js'
import { getMenuWidgetTypes } from './widgets/widgetConfig.js'
import styles from './CanvasToolbar.module.css'

const WIDGET_TYPES = getMenuWidgetTypes()

/**
 * Floating toolbar for adding widgets to a canvas.
 */
export default function CanvasToolbar({ canvasId, onWidgetAdded }) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)

  async function handleAdd(type) {
    if (adding) return
    // File widget needs a file picker before creation
    if (type === 'file') {
      setOpen(false)
      document.dispatchEvent(new CustomEvent('storyboard:canvas:open-file-picker', { detail: {} }))
      return
    }
    setAdding(true)
    try {
      const defaultProps = schemas[type] ? getDefaults(schemas[type]) : {}
      const result = await addWidgetApi(canvasId, {
        type,
        props: defaultProps,
        position: { x: 0, y: 0 },
      })
      if (result.success) {
        onWidgetAdded?.(result.widget)
        setOpen(false)
      }
    } catch (err) {
      console.error('[canvas] Failed to add widget:', err)
    } finally {
      setAdding(false)
    }
  }

  return (
    <nav className={styles.toolbar}>
      {open ? (
        <div className={styles.menu}>
          <header className={styles.menuHeader}>
            <span>Add widget</span>
            <button
              className={styles.closeBtn}
              onClick={() => setOpen(false)}
              aria-label="Close"
            >×</button>
          </header>
          {WIDGET_TYPES.map(({ type, label, icon }) => (
            <button
              key={type}
              className={styles.menuItem}
              onClick={() => handleAdd(type)}
              disabled={adding}
            >
              <span className={styles.menuIcon}>{icon}</span>
              {label}
            </button>
          ))}
        </div>
      ) : (
        <button
          className={styles.addBtn}
          onClick={() => setOpen(true)}
          title="Add widget"
          aria-label="Add widget"
        >
          +
        </button>
      )}
    </nav>
  )
}
