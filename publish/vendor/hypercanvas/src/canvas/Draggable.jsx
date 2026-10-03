import { useRef, useEffect, useState } from 'react';
import { useDraggable } from '@neodrag/react';
import { saveDrag } from './utils';

const TRANSLATION_MS = 250;
const PERSIST_DEADZONE_PX = 4;

/** Minimum hold time (ms) before drag can start.
 *  Quick clicks (release before this) never trigger drag. */
const DRAG_DELAY_MS = 150;

/** Minimum pointer travel (px) from the initial pointerdown position
 *  before drag can start. Computed from the raw clientX/Y delta —
 *  not from neodrag's translate-offset-based calculation (which is
 *  broken for positioned elements). */
const DRAG_DISTANCE_PX = 8;

function Draggable({ children, dragId, initialPosition, onDragStart: onDragStartProp, onDrag: onDragProp, onDragEnd, handle, snapGrid, locked = false, boundaryPad = 0, layout = 'absolute', wrapperClassName }) {
  const draggableRef = useRef(null);
  const isFlow = layout === 'flow';
  // In flow mode, the widget lives in document flow. A saved position
  // still serves as a drag-offset (so users can nudge a widget away from
  // its natural flow slot) but the initial offset is 0/0 unless one was
  // explicitly persisted.
  const initialSavedPosition = initialPosition || { x: 0, y: 0 };
  const dragStartRef = useRef(initialSavedPosition);
  const hasMovedRef = useRef(false);

  // Gate ref for our drag threshold
  const gateRef = useRef({
    timer: null,
    startX: 0,
    startY: 0,
    delayMet: false,
    distanceMet: false,
    active: false,
    lastEvent: null,
  });

  const [position, setPosition] = useState(initialSavedPosition);
  const [prevInitial, setPrevInitial] = useState(initialSavedPosition);

  // Sync position from parent when it changes externally (undo/redo)
  if (initialPosition &&
      (initialPosition.x !== prevInitial.x || initialPosition.y !== prevInitial.y)) {
    setPrevInitial(initialPosition);
    setPosition(initialPosition);
  }

  // Animate elements with saved positions on mount
  useEffect(() => {
    const el = draggableRef.current;
    if (
      el &&
      dragId &&
      (initialSavedPosition.x !== 0 || initialSavedPosition.y !== 0)
    ) {
      el.classList.add('tc-on-translation');

      const timer = setTimeout(() => {
        el.classList.remove('tc-on-translation');
      }, TRANSLATION_MS * 4);

      return () => {
        clearTimeout(timer);
      };
    }
  }, [dragId, initialSavedPosition.x, initialSavedPosition.y]);

  // Gate neodrag: intercept pointerdown on the handle via delegation.
  // We listen on the article element and check if the event target is
  // inside the handle. stopPropagation in bubble phase prevents neodrag
  // (which also listens on the article in bubble phase) from seeing it.
  //
  // After both delay and distance thresholds are met, we re-dispatch a
  // synthetic pointerdown from the original target — it bubbles up to
  // the article and neodrag picks it up.
  //
  // React 18 captures events at the root container during capture phase,
  // so React handlers (onPointerDown/onPointerUp) still fire normally.
  useEffect(() => {
    const el = draggableRef.current;
    if (!el || !handle || locked) return;

    const g = gateRef.current;
    let synthEvent = null;

    function isHandleEvent(e) {
      if (!(e.target instanceof Element)) return false;
      const match = e.target.closest(handle);
      return match != null && el.contains(match);
    }

    function onArticlePointerDownCapture(e) {
      // Let synthetic re-dispatched events pass through to neodrag
      if (e === synthEvent) {
        synthEvent = null;
        return;
      }
      if (!isHandleEvent(e)) return;
      // stopImmediatePropagation prevents neodrag's bubble listener
      // on this same article from seeing the event
      e.stopImmediatePropagation();
      g.active = true;
      g.delayMet = false;
      g.distanceMet = false;
      g.startX = e.clientX;
      g.startY = e.clientY;
      g.target = e.target;
      g.pointerId = e.pointerId;
      g.button = e.button;
      g.pointerType = e.pointerType;
      clearTimeout(g.timer);
      g.timer = setTimeout(() => {
        g.delayMet = true;
        tryEnable();
      }, DRAG_DELAY_MS);
    }

    function tryEnable() {
      if (g.delayMet && g.distanceMet && g.active && g.target) {
        const synth = new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          pointerId: g.pointerId,
          clientX: g.startX,
          clientY: g.startY,
          button: g.button,
          pointerType: g.pointerType,
        });
        synthEvent = synth;
        g.target.dispatchEvent(synth);
        g.target = null;
      }
    }

    function onDocPointerMove(e) {
      if (!g.active || g.distanceMet) return;
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (Math.hypot(dx, dy) >= DRAG_DISTANCE_PX) {
        g.distanceMet = true;
        tryEnable();
      }
    }

    function resetGate() {
      clearTimeout(g.timer);
      g.active = false;
      g.target = null;
    }

    el.addEventListener('pointerdown', onArticlePointerDownCapture, true);
    document.addEventListener('pointermove', onDocPointerMove);
    document.addEventListener('pointerup', resetGate);
    document.addEventListener('pointercancel', resetGate);
    return () => {
      el.removeEventListener('pointerdown', onArticlePointerDownCapture, true);
      document.removeEventListener('pointermove', onDocPointerMove);
      document.removeEventListener('pointerup', resetGate);
      document.removeEventListener('pointercancel', resetGate);
      clearTimeout(g.timer);
    };
  }, [handle, locked]);

  const { isDragging } = useDraggable(draggableRef, {
    axis: 'both',
    grid: snapGrid,
    defaultClass: 'tc-drag',
    defaultClassDragging: 'tc-on',
    defaultClassDragged: 'tc-off',
    applyUserSelectHack: true,
    disabled: locked,
    ...(handle ? { handle } : {}),
    position: { x: position.x, y: position.y },
    // Clamp in the transform callback so neodrag never paints a
    // negative position — avoids the one-frame flicker that happens
    // when clamping only in onDrag (React re-render lag).
    //
    // In flow mode the widget already sits in normal flow at its
    // natural offset; transforms add a delta only (no boundaryPad
    // clamping, no minimum coordinates).
    transform: ({ offsetX, offsetY }) => {
      if (isFlow) {
        return `translate3d(${offsetX}px, ${offsetY}px, 0)`
      }
      const x = Math.max(boundaryPad, offsetX)
      const y = Math.max(boundaryPad, offsetY)
      return `translate3d(${x}px, ${y}px, 0)`
    },
    onDragStart: () => {
      dragStartRef.current = position;
      hasMovedRef.current = false;
      onDragStartProp?.(dragId, position);
    },
    onDrag: ({ offsetX, offsetY }) => {
      const dx = offsetX - dragStartRef.current.x;
      const dy = offsetY - dragStartRef.current.y;
      const distance = Math.hypot(dx, dy);
      if (!hasMovedRef.current && distance >= PERSIST_DEADZONE_PX) {
        hasMovedRef.current = true;
      }
      const clamped = isFlow
        ? { x: offsetX, y: offsetY }
        : { x: Math.max(boundaryPad, offsetX), y: Math.max(boundaryPad, offsetY) };
      setPosition(clamped);
      onDragProp?.(dragId, clamped);
    },
    onDragEnd: (data) => {
      const clampedX = isFlow ? data.offsetX : Math.max(boundaryPad, data.offsetX);
      const clampedY = isFlow ? data.offsetY : Math.max(boundaryPad, data.offsetY);
      setPosition({ x: clampedX, y: clampedY });
      const dx = clampedX - dragStartRef.current.x;
      const dy = clampedY - dragStartRef.current.y;
      const movedEnough = hasMovedRef.current || Math.hypot(dx, dy) >= PERSIST_DEADZONE_PX;
      if (!movedEnough) return;

      if (dragId) {
        saveDrag(dragId, clampedX, clampedY);
      }
      onDragEnd?.(dragId, { x: clampedX, y: clampedY });
    },
  });

  // When locked, no drag cursor. When a handle is set, only the handle
  // shows grab cursor (via its own CSS). Otherwise the whole article is
  // the drag surface.
  const articleCursor = locked
    ? undefined
    : handle
      ? (isDragging ? 'grabbing' : undefined)
      : (isDragging ? 'grabbing' : 'grab');

  return (
    <article
      ref={draggableRef}
      className={wrapperClassName || undefined}
      data-layout={layout}
      style={{
        cursor: articleCursor,
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
      }}
    >
      <div className="tc-draggable-inner">
        {children}
      </div>
    </article>
  );
}

export default Draggable;
