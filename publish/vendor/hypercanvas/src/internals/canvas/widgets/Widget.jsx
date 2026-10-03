import {
  createElement,
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { getWidgetComponent } from './index.js'
import styles from './Widget.module.css'

/**
 * `<Widget>` — render any registered canvas widget inside a normal React page.
 *
 * Canvas widgets follow a stable contract: they resolve from a `type` string
 * (via `getWidgetComponent`), read their fields from a flat `props` object, and
 * render chrome-less (the canvas applies toolbar/anchors/selection externally).
 * This component reproduces that contract off-canvas so any widget can be used
 * as a first-class element in a page:
 *
 *   <Widget type="markdown" content="# Hi" className="prose" />
 *   <Widget type="prototype" src="StartupSignup" width={900} height={600} />
 *   <Widget type="sticky-note" text="Note" color="yellow" draggable resizable />
 *
 * Prop mapping
 * ------------
 * Reserved props configure the wrapper / contract and are NOT forwarded into
 * the widget's `props` object:
 *   type, id, className, style, onUpdate, widgetRef, children,
 *   draggable, resizable, chrome
 * Every OTHER prop is spread into the widget `props` object, so all widget
 * fields (content, settings, size — unique or not) are passable as props.
 *
 * onUpdate
 * --------
 * Defaults to internal local state (uncontrolled): widgets that self-heal or
 * edit through `onUpdate(partial)` keep working, and resize/drag persist for
 * the lifetime of the element. Pass your own `onUpdate` for controlled mode —
 * it receives the same partial-merge object and you own the props.
 *
 * chrome
 * ------
 * `chrome` (default true) renders the canvas-style selection outline and the
 * drag/select handle (the trigger dot that reveals a grab handle on hover),
 * matching how widgets look on the canvas — minus the action menu. Set
 * `chrome={false}` for a bare widget with no selection affordance.
 *
 * draggable / resizable
 * ---------------------
 * `resizable` (default false) is forwarded to the widget, which renders its own
 * ResizeHandle and persists width/height through `onUpdate`. `draggable`
 * (default false) is a page-level affordance: the widget body and the select
 * handle become pointer-draggable and the offset is applied as a CSS translate.
 */

const RESERVED = new Set([
  'type',
  'id',
  'className',
  'style',
  'onUpdate',
  'widgetRef',
  'children',
  'draggable',
  'resizable',
  'chrome',
])

const DRAG_THRESHOLD = 3

function isForwardRef(Component) {
  return Component != null && Component.$$typeof === Symbol.for('react.forward_ref')
}

function Widget(
  {
    type,
    id,
    className,
    style,
    onUpdate,
    draggable = false,
    resizable = false,
    chrome = true,
    ...rest
  },
  ref,
) {
  const autoId = useId()
  const widgetId = id || `widget-${type || 'unknown'}-${autoId}`

  // Collect every non-reserved prop into the flat widget props object.
  const incomingProps = useMemo(() => {
    const out = {}
    for (const key of Object.keys(rest)) {
      if (!RESERVED.has(key)) out[key] = rest[key]
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(rest)])

  // Local override state powers the default (uncontrolled) onUpdate so that
  // self-healing widgets, resizing, and editing all persist without a canvas.
  const [overrides, setOverrides] = useState(null)

  const handleUpdate = useCallback(
    (partial) => {
      if (!partial || typeof partial !== 'object') return
      if (typeof onUpdate === 'function') {
        onUpdate(partial)
        return
      }
      setOverrides((prev) => ({ ...(prev || {}), ...partial }))
    },
    [onUpdate],
  )

  const effectiveProps = useMemo(
    () => (overrides ? { ...incomingProps, ...overrides } : incomingProps),
    [incomingProps, overrides],
  )

  // Selection + drag offset (canvas-style chrome affordances).
  const [selected, setSelected] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const offsetRef = useRef(offset)
  offsetRef.current = offset
  const containerRef = useRef(null)

  const selectWidget = useCallback(() => setSelected(true), [])

  // Click anywhere outside the widget deselects it.
  useEffect(() => {
    if (!chrome || !selected) return undefined
    const onDocPointerDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setSelected(false)
      }
    }
    document.addEventListener('pointerdown', onDocPointerDown)
    return () => document.removeEventListener('pointerdown', onDocPointerDown)
  }, [chrome, selected])

  // Shared drag/click handler. `fromHandle` distinguishes a click on the select
  // handle (selects when no drag occurs) from a body drag.
  const beginPointer = useCallback(
    (e, fromHandle) => {
      // Let interactive controls (inputs, links, resize handle…) keep working.
      if (
        !fromHandle &&
        e.target.closest(
          'input, textarea, select, button, a, [contenteditable="true"], [data-widget-resize-handle]',
        )
      ) {
        return
      }
      if (fromHandle) e.stopPropagation()
      if (!draggable && !fromHandle) return

      const startX = e.clientX
      const startY = e.clientY
      const start = offsetRef.current
      let moved = false

      const move = (ev) => {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        moved = true
        if (draggable) setOffset({ x: start.x + dx, y: start.y + dy })
      }
      const up = () => {
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', up)
        if (fromHandle && !moved) selectWidget()
      }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
    },
    [draggable, selectWidget],
  )

  const Component = getWidgetComponent(type)
  if (!Component) {
    if (typeof console !== 'undefined') {
      console.warn(`[storyboard] <Widget>: unknown widget type "${type}"`)
    }
    return null
  }

  const elementProps = {
    id: widgetId,
    props: effectiveProps,
    onUpdate: handleUpdate,
    resizable: !!resizable,
    selected: chrome ? selected : false,
    onSelect: chrome ? selectWidget : () => {},
  }
  if (isForwardRef(Component)) {
    elementProps.ref = ref
  }

  const containerStyle = {
    ...style,
    ...(draggable
      ? {
          transform: `translate(${offset.x}px, ${offset.y}px)`,
          touchAction: 'none',
        }
      : null),
  }

  const showHandle = chrome && (hovered || selected)

  return (
    <div
      ref={containerRef}
      className={[
        styles.widget,
        chrome ? styles.chromeContainer : '',
        draggable ? styles.draggable : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={containerStyle}
      data-widget-type={type}
      data-widget-selected={chrome && selected ? '' : undefined}
      onPointerDown={draggable ? (e) => beginPointer(e, false) : undefined}
      onClick={chrome ? selectWidget : undefined}
      onMouseEnter={chrome ? () => setHovered(true) : undefined}
      onMouseLeave={chrome ? () => setHovered(false) : undefined}
    >
      <div
        className={[styles.widgetSlot, chrome && selected ? styles.widgetSlotSelected : '']
          .filter(Boolean)
          .join(' ')}
      >
        {createElement(Component, elementProps)}
      </div>

      {chrome && (
        <div className={styles.toolbar}>
          <span
            className={`${styles.triggerDot} ${showHandle ? styles.triggerDotHidden : ''}`}
            aria-hidden="true"
          />
          <div className={`${styles.toolbarContent} ${showHandle ? styles.toolbarContentVisible : ''}`}>
            <button
              type="button"
              className={`${styles.selectHandle} ${selected ? styles.selectHandleActive : ''} ${
                draggable ? styles.selectHandleDraggable : ''
              }`}
              onPointerDown={(e) => beginPointer(e, true)}
              aria-label={
                selected ? (draggable ? 'Drag to move widget' : 'Widget selected') : 'Select widget'
              }
              aria-pressed={selected}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default forwardRef(Widget)
